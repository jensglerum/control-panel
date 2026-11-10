#!/usr/bin/env python3
"""Bounded host acquisition; native T3 owns model synthesis scheduling."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def main():
    completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        result = subprocess.run(
            [sys.executable, str(ROOT / "radar.py"), "collect", "--days", "30", "--limit", "20", "--json"],
            cwd=ROOT, capture_output=True, text=True, timeout=240,
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            payload = {"status": "failed", "error": (result.stderr or result.stdout)[-2000:]}
        code = result.returncode
    except (OSError, subprocess.TimeoutExpired) as error:
        payload, code = {"status": "failed", "error": str(error)}, 1
    completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record = {"completed_at": completed_at, "exit_code": code, "result": payload}
    data = ROOT / "data"
    data.mkdir(exist_ok=True)
    temporary = data / f"collector-latest.{os.getpid()}.tmp"
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(data / "collector-latest.json")
    print(json.dumps({
        "completed_at": completed_at,
        "status": payload.get("status", "failed"),
        "exit_code": code,
        "items": payload.get("totals", {}).get("items"),
        "requests": payload.get("requests"),
    }), flush=True)
    return 0 if code in (0, 2, 4) else 1


if __name__ == "__main__":
    raise SystemExit(main())
