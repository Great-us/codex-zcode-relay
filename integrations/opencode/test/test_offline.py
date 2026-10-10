"""Offline stdlib unittest checks. Never launches OpenCode or network calls."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
INSTALL = HERE / "install-opencode.py"
RUNNER = HERE / "run-opencode.py"
PROBE = HERE / "probe-opencode.py"
TEST_ROOT = HERE.parents[1] / "runtime" / "test" / "opencode"


def setUpModule():
    TEST_ROOT.mkdir(parents=True, exist_ok=True)


def runner_path():
    return str(RUNNER)


def load_probe():
    spec = importlib.util.spec_from_file_location("probe_opencode", PROBE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def marker_for(probe, key, effort):
    return f"OPENCODE_GLM_OK|{key}|{effort}|323"


def good_stdout(probe, key, effort):
    return json.dumps({"type": "text", "part": {"text": marker_for(probe, key, effort)}}) + "\n" \
        + json.dumps({"type": "step_finish", "part": {"reason": "stop"}}) + "\n"


def wire(model, effort, status=200):
    return [{"model": model, "reasoning_effort": effort, "http_status": status}]


class ProbePureFunctionTests(unittest.TestCase):
    def setUp(self):
        self.probe = load_probe()

    def test_error_event_does_not_crash_and_fails_combo(self):
        stdout = json.dumps({"type": "error", "error": {"name": "ProviderError"}}) + "\n" \
            + json.dumps({"type": "text", "part": {"text": marker_for(self.probe, "flash", "low")}}) + "\n" \
            + json.dumps({"type": "step_finish", "part": {"reason": "stop"}}) + "\n"
        result = self.probe.combo_result("glm-5.3-flash", "low", marker_for(self.probe, "flash", "low"),
                                         0, stdout, wire("glm-5.3-flash", "low"))
        self.assertEqual(result["errorTypes"], ["ProviderError"])
        self.assertFalse(result["passed"])

    def test_wrong_effort_wire_request_fails_combo(self):
        stdout = good_stdout(self.probe, "flash", "low")
        result = self.probe.combo_result("glm-5.3-flash", "low", marker_for(self.probe, "flash", "low"),
                                         0, stdout, wire("glm-5.3-flash", "high"))
        self.assertFalse(result["wireModelObserved"])
        self.assertFalse(result["passed"])

    def test_non_200_wire_request_fails_combo(self):
        stdout = good_stdout(self.probe, "flash", "low")
        result = self.probe.combo_result("glm-5.3-flash", "low", marker_for(self.probe, "flash", "low"),
                                         0, stdout, wire("glm-5.3-flash", "low", status=401))
        self.assertFalse(result["wireModelObserved"])
        self.assertFalse(result["passed"])

    def test_no_matching_wire_request_fails_combo(self):
        result = self.probe.combo_result("glm-5.3-flash", "low", marker_for(self.probe, "flash", "low"),
                                         0, good_stdout(self.probe, "flash", "low"), [])
        self.assertFalse(result["wireModelObserved"])
        self.assertFalse(result["passed"])

    def test_correct_combo_passes(self):
        result = self.probe.combo_result("glm-5.3-flash", "low", marker_for(self.probe, "flash", "low"),
                                         0, good_stdout(self.probe, "flash", "low"),
                                         wire("glm-5.3-flash", "low"))
        self.assertTrue(result["passed"])
        self.assertNotIn("sessionIDs", result)

    def test_incomplete_combos_cannot_be_all_passed(self):
        pairs = [("flash", "low"), ("flash", "high"), ("flash", "max"),
                 ("full", "low"), ("full", "high")]
        results = [self.probe.combo_result(self.probe.MODELS[key], effort,
                                           marker_for(self.probe, key, effort), 0,
                                           good_stdout(self.probe, key, effort),
                                           wire(self.probe.MODELS[key], effort))
                   for key, effort in pairs]
        records = [r for key, effort in pairs for r in wire(self.probe.MODELS[key], effort)]
        self.assertFalse(self.probe.overall_passed(results, records))

    def test_correct_six_combos_all_passed(self):
        pairs = self.probe.EXPECTED_COMBOS
        results = [self.probe.combo_result(self.probe.MODELS[key], effort,
                                           marker_for(self.probe, key, effort), 0,
                                           good_stdout(self.probe, key, effort),
                                           wire(self.probe.MODELS[key], effort))
                   for key, effort in pairs]
        records = [r for key, effort in pairs for r in wire(self.probe.MODELS[key], effort)]
        self.assertTrue(self.probe.overall_passed(results, records))
        self.assertFalse(self.probe.overall_passed(results, []), "reply metadata alone cannot prove actual requests")

    def test_unexpected_wire_request_blocks_overall_pass(self):
        pairs = self.probe.EXPECTED_COMBOS
        results = [self.probe.combo_result(self.probe.MODELS[key], effort,
                                           marker_for(self.probe, key, effort), 0,
                                           good_stdout(self.probe, key, effort),
                                           wire(self.probe.MODELS[key], effort))
                   for key, effort in pairs]
        records = [r for key, effort in pairs for r in wire(self.probe.MODELS[key], effort)]
        records.append(wire("glm-5.3", "low", status=500)[0])
        self.assertFalse(self.probe.overall_passed(results, records))


class InstallTests(unittest.TestCase):
    def test_conflict_refused_without_partial_write(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
            target = Path(tmp) / "tools"
            target.mkdir()
            (target / "README.md").write_text("tampered", encoding="utf-8")
            second = subprocess.run([sys.executable, str(INSTALL), "--target", str(target)],
                                    capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertFalse((target / "run-opencode.py").exists(), "conflict preflight must prevent creating the earlier file")
            self.assertEqual((target / "README.md").read_text(encoding="utf-8"), "tampered")

    def test_identical_content_is_idempotent(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
            target = Path(tmp) / "tools"
            for _ in range(2):
                result = subprocess.run([sys.executable, str(INSTALL), "--target", str(target)],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["installed"], [], "second install should change nothing")
            self.assertEqual(sorted(payload["unchanged"]), ["README.md", "run-opencode.py"])


class ParallelExampleTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("parallel_example", HERE / "examples/run-two-parallel.py")
        self.example = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.example)

    def test_unmodified_placeholders_never_start_workers(self):
        with mock.patch.object(self.example.subprocess, "Popen") as spawn:
            with self.assertRaises(SystemExit):
                self.example.main()
            spawn.assert_not_called()

    def test_launch_failure_waits_for_already_started_worker_and_fails(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
            results = [Path(tmp) / "a", Path(tmp) / "b"]
            self.example.RUNNER = "runner.py"
            self.example.JOBS = [{"workspace": tmp, "task": "task.md", "result_dir": str(result), "permissions": "permissions.json", "model": "flash", "effort": "low"} for result in results]
            results[0].mkdir()
            (results[0] / "receipt.json").write_text('{"executionCompleted":true}', encoding="utf-8")
            worker = mock.Mock()
            worker.wait.return_value = 0
            with mock.patch.object(self.example.subprocess, "Popen", side_effect=[worker, OSError("PRIVATE_ERROR")]):
                with mock.patch("builtins.print") as output:
                    self.assertEqual(self.example.main(), 1)
            worker.wait.assert_called_once_with()
            self.assertNotIn("PRIVATE_ERROR", str(output.call_args_list))

    def test_result_directory_aliases_are_rejected_before_launch(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
            self.example.RUNNER = "runner.py"
            self.example.JOBS = [{"workspace": tmp, "task": "task.md", "result_dir": result, "permissions": "permissions.json", "model": "flash", "effort": "low"} for result in (tmp, str(Path(tmp) / "."))]
            with self.assertRaises(SystemExit):
                self.example.validate_before_launch()


class RunnerArgValidationTests(unittest.TestCase):
    """Invalid model / missing args must fail before OpenCode is ever launched."""

    def test_invalid_model_rejected(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
            prompt = Path(tmp) / "task.md"
            prompt.write_text("x", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, runner_path(), "--model", "bogus", "--effort", "low",
                 "--workspace", tmp, "--prompt-file", str(prompt),
                 "--result-dir", str(Path(tmp) / "out")],
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("invalid choice", result.stderr)
            self.assertFalse((Path(tmp) / "out").exists())

    def test_missing_required_args_rejected(self):
        result = subprocess.run([sys.executable, runner_path()], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--workspace", result.stderr)


class ProbeArgValidationTests(unittest.TestCase):
    def test_missing_args_rejected_before_network(self):
        result = subprocess.run([sys.executable, str(PROBE)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--workspace", result.stderr)

    def test_refuses_any_existing_result_dir_before_provider_start(self):
        # Even an empty pre-existing directory must be rejected; the check
        # runs before any proxy or OpenCode process is started, so no
        # provider request can be made for a reused directory.
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
            workspace = Path(tmp) / "ws"
            workspace.mkdir()
            result_dir = Path(tmp) / "out"
            result_dir.mkdir()
            result = subprocess.run(
                [sys.executable, str(PROBE), "--workspace", str(workspace),
                 "--result-dir", str(result_dir)],
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("already exists", result.stderr)
            self.assertFalse((result_dir / "probe-evidence.json").exists())

    def test_require_new_result_dir_pure_check(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
            existing = Path(tmp) / "exists"
            existing.mkdir()
            with self.assertRaises(ValueError):
                load_probe().require_new_result_dir(existing)
            load_probe().require_new_result_dir(Path(tmp) / "fresh")


if __name__ == "__main__":
    unittest.main()
