#!/usr/bin/env python3
"""Local AI research CLI. No model/API key or third-party package required."""
from __future__ import annotations

import argparse
import dataclasses
import json
from pathlib import Path
import sys

from radarlib import (ROOT, SOURCES, SOURCE_MAP, BODY_LIMIT, AccessDenied, Busy, RadarError,
                      Store, brief, collect, intake, passage_evidence, receipt_status, since_days, stamp)


def bounded(minimum, maximum):
    def parse(value):
        number = int(value)
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"Choose {minimum}..{maximum}")
        return number
    return parse


def timestamp(value):
    parsed = stamp(value)
    if not parsed:
        raise argparse.ArgumentTypeError("Use an ISO date/time, for example 2026-11-01 or 2026-11-01T00:00:00Z")
    return parsed


def parser():
    p = argparse.ArgumentParser(description="Collect declared public AI sources; inspect provenance and produce local evidence packets.")
    p.add_argument("--database", type=Path, default=ROOT / "data" / "radar.sqlite3", help="Optional local SQLite path (tests/isolated experiments)")
    commands = p.add_subparsers(dest="command", required=True)
    c = commands.add_parser("collect", help="Collect bounded source deltas; partial sources remain visible")
    c.add_argument("--source", action="append", choices=SOURCE_MAP, help="Repeat to choose declared source IDs")
    c.add_argument("--days", type=bounded(1, 90), default=30)
    c.add_argument("--limit", type=bounded(1, 100), default=20, help="New/changed feed items or article checks per source")
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("status", help="Source health, coverage, index totals and active lease")
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("sources", help="Fixed public-source contracts; not an arbitrary crawler")
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("search", help="Rank local titles and retained text by lexical relevance; empty query lists newest")
    c.add_argument("query", nargs="?", default="")
    c.add_argument("--days", type=bounded(1, 3650), default=None)
    c.add_argument("--since", type=timestamp)
    c.add_argument("--until", type=timestamp)
    c.add_argument("--source", choices=SOURCE_MAP)
    c.add_argument("--limit", type=bounded(1, 1000), default=40)
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("document", help="Read retained text and provenance for one document/evidence version locally")
    c.add_argument("item_id")
    c.add_argument("--version")
    c.add_argument("--offset", type=bounded(0, BODY_LIMIT), default=0)
    c.add_argument("--max-chars", type=bounded(1, BODY_LIMIT), default=20_000)
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("passages", help="Rank bounded version-bound passages locally; source text is untrusted data")
    c.add_argument("query", nargs="?", default="")
    c.add_argument("--item", dest="item_id")
    c.add_argument("--version")
    c.add_argument("--days", type=bounded(1, 3650), default=None)
    c.add_argument("--since", type=timestamp)
    c.add_argument("--until", type=timestamp)
    c.add_argument("--source", choices=SOURCE_MAP)
    c.add_argument("--limit", type=bounded(1, 200), default=10)
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("passage", help="Read one immutable retained passage by its stable ID locally")
    c.add_argument("passage_id")
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("brief", help="Create a version-bound evidence packet; native provider writes the synthesis")
    c.add_argument("--days", type=bounded(1, 3650), default=7)
    c.add_argument("--since", type=timestamp)
    c.add_argument("--limit", type=bounded(1, 200), default=40)
    c.add_argument("--output", type=Path, help="Optional Markdown destination inside this workspace's artifacts directory")
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("intake", help="Save/refresh one supported public URL; social URLs are link-only")
    c.add_argument("url")
    c.add_argument("--title")
    c.add_argument("--note", default="")
    c.add_argument("--json", action="store_true")
    c = commands.add_parser("receipt", help="Check whether a saved evidence packet is now stale")
    c.add_argument("receipt_id")
    c.add_argument("--json", action="store_true")
    return p


def human(result, command):
    if command == "collect":
        print(f"Collection {result['status']}: {result['totals']['items']} indexed items, {result['requests']} public requests.")
        for source in result["results"]:
            counts = f" (+{source.get('inserted', 0)} new, {source.get('changed', 0)} changed)"
            print(f"  {source['source_id']}: {source['status']}{counts}" + ("; " + source["error"] if source.get("error") else ""))
        print("Direct X/LinkedIn access: unconfigured. Use status for all coverage limitations.")
    elif command == "status":
        print(f"{result['totals']['items']} items; {result['totals']['versions']} evidence versions; {result['totals']['stale_receipts']} stale receipts.")
        for source in result["sources"]:
            print(f"  {source['id']}: {source['status']}; {source['items']} items; last success {source['last_success'] or 'never'}")
            if source["last_error"]:
                print("    " + source["last_error"])
    elif command == "search":
        for item in result["items"]:
            print(f"{item['published_at'] or 'date unknown'}  {item['title']}\n{item['url']}\n{item.get('match_excerpt', item['excerpt'])}\nVersion: {item['version']}; text: {item['text_coverage']['kind']}\n{item['retrieval']['document']}\n")
        print(f"Returned {len(result['items'])} local results. Media uninspected; source claims are not independent measurements.")
    elif command in ("document", "passage"):
        print(f"{result['title']}\n{result['url']}\nVersion: {result['version']}; text: {result['text_coverage']['kind']}\n{result['text_coverage']['limitation']}\n\n{result['text']}")
        if command == "document" and result["output_coverage"]["next_offset"] is not None:
            print(f"\nMore retained text: repeat document with --offset {result['output_coverage']['next_offset']}")
    elif command == "passages":
        for item in result["items"]:
            print(f"{item['title']}\n{item['url']}\nPassage: {item['passage_id']}; version: {item['version']}; text: {item['text_coverage']['kind']}\n{item['text']}\n")
    elif command == "brief":
        print(result["markdown_path"])
        print(f"Receipt {result['receipt_id']}; {len(result['items'])} source items; {len(result['gaps'])} coverage gaps. Model synthesis pending.")
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))


def main(argv=None):
    args = parser().parse_args(argv)
    store = None
    try:
        if args.command == "sources":
            result = {"schema_version": 1, "sources": [dataclasses.asdict(source) for source in SOURCES]}
        else:
            store = Store(args.database)
            if args.command == "collect":
                result = collect(store, source_ids=args.source, days=args.days, limit=args.limit)
            elif args.command == "status":
                result = store.status()
            elif args.command == "search":
                since = args.since or (since_days(args.days) if args.days else None)
                result = {"schema_version": 1, "query": args.query, "since": since, "until": args.until, "items": store.search(args.query, since=since, until=args.until, source_id=args.source, limit=args.limit)}
            elif args.command == "document":
                result = {"schema_version": 1, **store.document(args.item_id, version=args.version, offset=args.offset, max_chars=args.max_chars)}
            elif args.command == "passage":
                result = {"schema_version": 1, **passage_evidence(store.passage(args.passage_id))}
            elif args.command == "passages":
                since = args.since or (since_days(args.days) if args.days else None)
                result = {"schema_version": 1, "citation_id_field": "passage_id", "passage_lookup_command": store._cli_prefix() + " passage PASSAGE_ID --json", "query": args.query, "since": since, "until": args.until, "items": [passage_evidence(item) for item in store.passages(args.query, item_id=args.item_id, version=args.version, since=since, until=args.until, source_id=args.source, limit=args.limit)]}
            elif args.command == "brief":
                result = brief(store, days=args.days, since=args.since, limit=args.limit, output=args.output)
            elif args.command == "intake":
                result = intake(store, args.url, title=args.title, note=args.note)
            elif args.command == "receipt":
                result = receipt_status(store, args.receipt_id)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            human(result, args.command)
        return 2 if args.command == "collect" and result["status"] == "partial" else 0
    except Busy as exc:
        error = {"schema_version": 1, "status": "busy", "error": str(exc)}
        print(json.dumps(error) if args.json else str(exc))
        return 4
    except (RadarError, OSError, ValueError) as exc:
        error = {"schema_version": 1, "status": "failed", "error": str(exc)}
        print(json.dumps(error) if args.json else str(exc), file=sys.stdout if args.json else sys.stderr)
        return 1
    finally:
        if store:
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
