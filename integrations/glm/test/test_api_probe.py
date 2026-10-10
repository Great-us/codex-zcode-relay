"""Offline response validation only: no credentials, model requests or tools."""
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("api_probe", Path(__file__).resolve().parents[1] / "probe-api.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ApiValidationTests(unittest.TestCase):
    def body(self, **changes):
        return {"model": "glm-5.3", "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "OK"}]}], **changes}

    def test_success_requires_model_status_and_exact_reply(self):
        self.assertTrue(probe.summarize("glm-5.3", "max", 200, self.body())["passed"])
        self.assertFalse(probe.summarize("glm-5.3-flash", "max", 200, self.body())["passed"])
        self.assertFalse(probe.summarize("glm-5.3", "max", 200, self.body(status="incomplete"))["passed"])

    def test_http_failure_never_passes(self):
        self.assertFalse(probe.summarize("glm-5.3", "max", 401, self.body())["passed"])

    def test_nonexact_reply_not_accepted_or_exposed(self):
        body = self.body(output=[{"type": "message", "content": [{"type": "output_text", "text": "PRIVATE_OUTPUT"}]}], error={"message": "PRIVATE_ERROR"})
        report = probe.summarize("glm-5.3", "max", 200, body)
        self.assertFalse(report["passed"])
        self.assertNotIn("PRIVATE", json.dumps(report))

    def test_nonobject_response_fails(self):
        self.assertFalse(probe.summarize("glm-5.3", "max", 200, None)["passed"])


if __name__ == "__main__":
    unittest.main()
