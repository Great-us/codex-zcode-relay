"""Explicit connectivity probe for the OpenCode GLM integration.

WARNING: this probe performs six real model requests and consumes GLM quota.
It must be run deliberately; it is not part of the default offline test suite.
"""
import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

UPSTREAM = "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
MODELS = {"flash": "glm-5.3-flash", "full": "glm-5.3"}
EFFORTS = ("low", "high", "max")
EXPECTED_COMBOS = tuple(sorted((key, effort) for key in MODELS for effort in EFFORTS))
ALLOWED_FORWARD_HEADERS = ("authorization", "content-type", "accept", "user-agent")

records = []
records_lock = threading.Lock()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None  # Never forward provider authentication to a redirect target.


upstream_opener = urllib.request.build_opener(NoRedirect)


def wire_snapshot():
    with records_lock:
        return [dict(r) for r in records]


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/v4/chat/completions":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400)
            return
        if not isinstance(payload, dict):
            self.send_error(400)
            return
        # Whitelist only sanitized wire fields; never keep keys, headers,
        # raw request bodies or reasoning text.
        observation = {
            "model": payload.get("model"),
            "reasoning_effort": payload.get("reasoning_effort"),
            "http_status": None,
        }
        with records_lock:
            records.append(observation)
        # Forward only to the fixed first-party endpoint; authentication
        # stays in memory and is never persisted.
        headers = {k: v for k, v in self.headers.items() if k.lower() in ALLOWED_FORWARD_HEADERS}
        request = urllib.request.Request(UPSTREAM, data=body, headers=headers, method="POST")
        try:
            upstream = upstream_opener.open(request, timeout=300)
        except urllib.error.HTTPError as error:
            with records_lock:
                observation["http_status"] = error.code
            content = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        except Exception:
            with records_lock:
                observation["http_status"] = 502
            self.send_error(502, "Provider connection failed")
            return
        with upstream:
            with records_lock:
                observation["http_status"] = upstream.status
            self.send_response(upstream.status)
            self.send_header("Content-Type", upstream.headers.get("Content-Type", "text/event-stream"))
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            while chunk := upstream.read1(8192):
                self.wfile.write(chunk)
                self.wfile.flush()


def find_opencode():
    cli = shutil.which("opencode.exe")
    if not cli:
        installed = Path.home() / "AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode.exe"
        if installed.is_file():
            cli = str(installed)
    return cli


def parse_events(stdout):
    texts, terminal_reasons, error_types = [], [], []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        part = event.get("part", {})
        if not isinstance(part, dict):
            part = {}
        if event.get("type") == "text":
            if isinstance(part.get("text"), str):
                texts.append(part["text"])
        elif event.get("type") == "step_finish":
            terminal_reasons.append(part.get("reason"))
        elif event.get("type") == "error":
            error = event.get("error")
            name = error.get("name") if isinstance(error, dict) else None
            error_types.append(name if isinstance(name, str) else "OpenCodeError")
    return texts, terminal_reasons, error_types


def combo_result(model, effort, marker, returncode, stdout, wire_records):
    """Pure evaluation of one model/effort combination against wire evidence."""
    texts, terminal_reasons, error_types = parse_events(stdout)
    response = "".join(texts).strip()
    matches = [r for r in wire_records
               if r.get("model") == model and r.get("reasoning_effort") == effort]
    wire_model_observed = bool(matches) and all(r.get("http_status") == 200 for r in matches)
    result = {
        "modelKey": model, "effort": effort,
        "exitCode": returncode,
        "responseMatchesMarker": response == marker,
        "wireModelObserved": wire_model_observed,
        "reachedTerminalStop": bool(terminal_reasons) and terminal_reasons[-1] == "stop",
        "errorTypes": error_types,
    }
    result["passed"] = (returncode == 0 and result["responseMatchesMarker"]
                        and result["wireModelObserved"] and result["reachedTerminalStop"]
                        and not error_types)
    return result


def wire_requests_all_expected(wire_records):
    """Every real wire request must target one of the six expected
    model/effort pairs and have returned HTTP 200."""
    expected_models = set(MODELS.values())
    return all(r.get("model") in expected_models
               and r.get("reasoning_effort") in EFFORTS
               and r.get("http_status") == 200 for r in wire_records)


def overall_passed(results, wire_records):
    """All six expected combinations must be present and passed, and every
    real wire request must belong to the expected set with HTTP 200."""
    if len(results) != len(EXPECTED_COMBOS):
        return False
    seen = {(r.get("modelKey"), r.get("effort")) for r in results}
    expected = {(MODELS[key], effort) for key, effort in EXPECTED_COMBOS}
    wire_pairs = {(r.get("model"), r.get("reasoning_effort")) for r in wire_records}
    if seen != expected or wire_pairs != expected:
        return False
    return all(r.get("passed") for r in results) and wire_requests_all_expected(wire_records)


def run_combo(cli, workspace, model, effort, marker, proxy_port):
    environment = {
        **os.environ,
        "OPENCODE_CONFIG_CONTENT": json.dumps({
            "share": "disabled",
            "mcp": {"playwright": {"enabled": False}},
            "permission": {"*": "deny"},
            "provider": {"zhipuai-coding-plan": {"options": {
                "baseURL": f"http://127.0.0.1:{proxy_port}/v4", "timeout": False}}},
        }),
    }
    prompt = (f"Harmless connection test. Use no tools and access no files or network yourself. "
              f"Compute 17 * 19 internally. Return exactly this single line and nothing else: {marker}")
    start = time.monotonic()
    try:
        process = subprocess.run(
            [str(cli), "run", "--pure", "--model", "zhipuai-coding-plan/" + model,
             "--variant", effort, "--format", "json", "--dir", str(workspace),
             "--title", "OpenCode GLM probe", prompt],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=environment, stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as error:
        # Only the exception type is kept; never the message or any
        # credential-bearing stderr content.
        return {"modelKey": model, "effort": effort, "exitCode": None,
                "errorTypes": [type(error).__name__], "passed": False,
                "elapsedSeconds": round(time.monotonic() - start, 3)}
    result = combo_result(model, effort, marker, process.returncode, process.stdout, wire_snapshot())
    result["elapsedSeconds"] = round(time.monotonic() - start, 3)
    return result


proxy = None


def require_new_result_dir(result_dir):
    """The probe only accepts a result directory that does not exist yet.
    Called before any provider proxy or OpenCode process is started."""
    if result_dir.exists():
        raise ValueError(f"result directory already exists; choose a new one: {result_dir}")


def main():
    global proxy
    parser = argparse.ArgumentParser(description="OpenCode GLM connectivity probe (consumes real quota)")
    parser.add_argument("--workspace", type=Path, required=True, help="existing scratch directory passed to opencode --dir")
    parser.add_argument("--result-dir", type=Path, required=True, help="new directory for probe evidence; must not already exist")
    args = parser.parse_args()
    workspace = args.workspace.resolve(strict=True)
    if not workspace.is_dir():
        parser.error("workspace must be an existing directory")
    result_dir = args.result_dir.resolve()
    try:
        require_new_result_dir(result_dir)
    except ValueError as error:
        parser.error(str(error))
    result_dir.mkdir(parents=True, exist_ok=False)
    cli = find_opencode()
    if not cli:
        parser.error("OpenCode executable was not found")
    proxy = ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
    threading.Thread(target=proxy.serve_forever, daemon=True).start()
    results = []
    try:
        # At most two requests in flight; every expected combination runs.
        # No overall timeout: the probe waits for every real process exit.
        for effort in EFFORTS:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(run_combo, cli, workspace, MODELS[key], effort,
                                           f"OPENCODE_GLM_OK|{key}|{effort}|323", proxy.server_port)
                           for key in MODELS]
                # f.result() waits for each process; even if one combination
                # fails, the sibling already-started process is joined first.
                for key, future in zip(MODELS, futures):
                    try:
                        results.append(future.result())
                    except Exception as error:
                        results.append({"modelKey": MODELS[key], "effort": effort,
                                        "passed": False, "errorTypes": [type(error).__name__]})
            if any(not result.get("passed") for result in results):
                break  # Already-started siblings have finished; avoid more failed requests.
    finally:
        proxy.shutdown()
        proxy.server_close()
        all_ok = overall_passed(results, wire_snapshot())
        evidence = {
            "provider": "zhipuai-coding-plan",
            "upstream": UPSTREAM,
            "results": results,
            "wireRequests": wire_snapshot(),
            "allPassed": all_ok,
            "privacy": "Only model, reasoning effort, HTTP status and pass/fail outcomes are persisted; no keys, headers, raw prompts, session IDs or reasoning text.",
        }
        (result_dir / "probe-evidence.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({
            "completedTests": len(results),
            "passed": sum(1 for r in results if r.get("passed")),
            "allPassed": all_ok,
        }, ensure_ascii=False), flush=True)
    return 0 if overall_passed(results, wire_snapshot()) else 1


if __name__ == "__main__":
    sys.exit(main())
