"""Explicit Responses API connectivity test; consumes real GLM quota.

Adapted from the original six-profile experiment. It is a model request probe,
not an agent runtime: no file/shell/MCP tool execution is provided to the model.
Only whitelisted result fields are saved. Existing ZCode authentication is read
in memory by the local helper, never printed, stored, or sent to another host.
"""
import argparse
import concurrent.futures
import http.client
import importlib.util
import json
import time
from pathlib import Path

MODELS = {"flash": "glm-5.3-flash", "full": "glm-5.3"}
EFFORTS = ("low", "high", "max")


def summarize(model, effort, status, body):
    if not isinstance(body, dict):
        body = {}
    texts = [part.get("text", "") for item in body.get("output", [])
             if isinstance(item, dict) and item.get("type") == "message"
             for part in item.get("content", [])
             if isinstance(part, dict) and part.get("type") == "output_text"]
    exact = all(isinstance(text, str) for text in texts) and "".join(texts).strip() == "OK"
    report = {"requested_model": model, "requested_effort": effort,
              "http_status": status, "response_status": body.get("status"),
              "returned_model": body.get("model"), "expected_output": exact}
    report["passed"] = status == 200 and body.get("status") == "completed" and body.get("model") == model and exact
    return report


def probe(pair, key):
    model, effort = pair
    start = time.monotonic()
    connection = http.client.HTTPSConnection("open.bigmodel.cn", timeout=300)
    report = {"requested_model": model, "requested_effort": effort, "passed": False}
    try:
        body = {"model": model, "reasoning": {"effort": effort},
                "input": [{"role": "user", "content": "Reply exactly OK."}],
                "max_output_tokens": 2048, "stream": False}
        connection.request("POST", "/api/v1/responses", body=json.dumps(body),
                           headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        response = connection.getresponse()
        report = summarize(model, effort, response.status, json.loads(response.read()))
    except Exception as error:
        report["error_type"] = type(error).__name__  # Never save exception text or raw response.
    finally:
        connection.close()
    report["elapsed_seconds"] = round(time.monotonic() - start, 2)
    return report


def main():
    parser = argparse.ArgumentParser(description="Real GLM Responses API probe; consumes quota")
    parser.add_argument("--model", choices=MODELS, default="flash")
    parser.add_argument("--effort", choices=EFFORTS, default="low")
    parser.add_argument("--all", action="store_true", help="test all six pairs, at most two simultaneously")
    parser.add_argument("--result-dir", type=Path, required=True, help="new output directory")
    args = parser.parse_args()
    result_dir = args.result_dir.resolve()
    if result_dir.exists():
        parser.error("result directory already exists; choose a new directory")
    spec = importlib.util.spec_from_file_location("local_glm_auth", Path(__file__).with_name("read-zcode-key.py"))
    auth = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auth)
    try:
        key = auth.read_key()
    except Exception:
        parser.error("Existing local ZCode Coding Plan authentication is unavailable")
    result_dir.mkdir(parents=True, exist_ok=False)
    pairs = [(model, effort) for model in MODELS.values() for effort in EFFORTS] if args.all else [(MODELS[args.model], args.effort)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(2, len(pairs))) as pool:
        reports = list(pool.map(lambda pair: probe(pair, key), pairs))
    evidence = {"endpoint": "https://open.bigmodel.cn/api/v1/responses", "results": reports,
                "allPassed": len(reports) == len(pairs) and all(report["passed"] for report in reports),
                "privacy": "No keys, headers, raw input/output, exception messages or reasoning text saved.",
                "scope": "API accepts explicit reasoning effort; not a reasoning-quality or file-tool test."}
    (result_dir / "api-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False))
    return 0 if evidence["allPassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
