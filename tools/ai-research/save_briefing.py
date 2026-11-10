#!/usr/bin/env python3
"""Validate and persist a model's complete synthesis with its evidence receipt."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from radarlib import ROOT, RadarError, Store, receipt_status


def validate_text(text, receipt_id):
    text = text.strip()
    if len(text) < 180 or len(text.encode()) > 256_000:
        raise ValueError("Supply the complete briefing, between 180 characters and 256 KB.")
    if re.search(r"(?m)^\s*(?:\$\{content\}|\{\{content\}\}|INSERT_BRIEFING_HERE)\s*$", text):
        raise ValueError("A template placeholder is not a saved briefing.")
    if receipt_id not in text:
        raise ValueError("Include the actual evidence receipt ID in the briefing.")
    if not re.search(r"\]\(https://[^\s)]+\)", text):
        raise ValueError("Include at least one Markdown citation to an original HTTPS source.")
    return text + "\n"


def atomic_text(destination, text):
    temporary = destination.with_name(destination.name + f".{os.getpid()}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(destination)


def save(text, receipt_id):
    text = validate_text(text, receipt_id)
    store = Store()
    try:
        evidence = receipt_status(store, receipt_id)
    finally:
        store.close()
    if evidence["stale"]:
        raise ValueError("Evidence changed. Generate and inspect a fresh packet before saving.")
    artifacts = ROOT / "artifacts"
    artifacts.mkdir(exist_ok=True)
    saved_at = datetime.datetime.now(datetime.timezone.utc)
    snapshot = artifacts / f"briefing-{saved_at.strftime('%Y%m%d-%H%M%SZ')}-{receipt_id[-8:]}.md"
    latest = artifacts / "latest-briefing.md"
    atomic_text(snapshot, text)
    atomic_text(latest, text)
    result = {
        "saved_at": saved_at.isoformat(), "receipt_id": receipt_id,
        "latest_path": str(latest), "snapshot_path": str(snapshot),
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        "bytes": len(text.encode()), "evidence_stale": False,
    }
    atomic_text(artifacts / "latest-briefing.json", json.dumps(result, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", required=True, help="Actual receipt ID from radar.py brief")
    args = parser.parse_args()
    try:
        result = save(sys.stdin.read(256_001), args.receipt)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, RadarError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
