# AI research

Collect public AI updates into a local source library, then use a connected model to write a cited briefing in Control Panel. This is an optional developer workflow. It is not yet a built-in desktop feature.

Python 3.10+ and its standard library run the collector and library. Acquisition needs no AI API key or Python package installation. Model-written briefings use your connected provider and its allowance or billing.

## Try the library

From the repository root:

```bash
cd tools/ai-research
python3 radar.py sources --json
python3 radar.py status --json
```

The checkout starts with no collected archive. `status` opens a local SQLite database under `data/`. To populate it, run collection yourself from the host terminal:

```bash
python3 radar.py collect --days 7 --limit 20 --json
```

This contacts only the declared public sources. It does not sign in to social accounts or use browser cookies. A partial result remains useful, but its gaps must be disclosed. Collection exits with `0` for completion, `2` for partial source coverage, `4` when another collector holds the lease, and `1` for failure.

Once collected, these commands use local data only:

```bash
python3 radar.py search "agent memory" --days 30 --limit 20 --json
python3 radar.py passages "agent memory" --limit 6 --json
python3 radar.py brief --days 7 --limit 40 --json
```

`brief` prepares an evidence packet, not a model-written explanation. A model reads that packet and retrieves supporting passages. Use the actual IDs returned by these commands to read a document, passage or receipt:

```bash
python3 radar.py document ITEM_ID --version VERSION_ID --max-chars 12000 --json
python3 radar.py passage PASSAGE_ID --json
python3 radar.py receipt RECEIPT_ID --json
```

Search is lexical matching over retained text. It does not verify claims or search the whole web. The library distinguishes inspected article text, inferred main text, feed text, indexed social snippets, link notes and older excerpts. Documents retain up to 120,000 normalized characters; passages retain up to 1,600. Read each result's coverage and truncation fields.

## Connect a daily briefing

First run the local Control Panel server from the repository root and connect a Codex account. This setup helper currently supports Codex for the daily task. It uses the running checkout's isolated `.t3` directory by default and refuses the normal `~/.t3` home.

From the repository root, with Node 26 available through Vite+:

```bash
vp exec node tools/ai-research/t3_setup.mjs --help
vp exec node tools/ai-research/t3_setup.mjs --disable
```

The second command creates an AI research project, briefing thread and **paused** daily task. It modifies only the specified local environment. It does not collect sources, start a model turn, install a background service or copy another person's accounts. The helper needs repository dependencies installed. If your server uses another isolated directory, pass `--base-dir PATH`; use `--repo PATH` or `--project PATH` to override the inferred locations.

After inspecting the task and collecting evidence, enable it through Control Panel's Scheduled tasks or rerun the helper with `--enable`. The default time is 10:00 in the **server's timezone**; `--time HH:MM` changes it. `--run-now` explicitly starts a real provider turn and can consume your provider allowance. Existing schedules keep their enabled state unless you request `--enable` or `--disable`.

Model synthesis reads local evidence. Public refresh must happen separately. `collector_service.py` is a bounded, single-run host helper that writes `data/collector-latest.json`; it does not install a scheduler. No hourly LaunchAgent, cron entry or private schedule is included in this checkout. Scheduled model turns must not retry a network denial, widen sandbox permissions or configure new collection routes. A sleeping or powered-off machine cannot collect continuously.

The model follows [AGENTS.md](AGENTS.md). It saves the complete final briefing with `save_briefing.py --receipt RECEIPT_ID`, supplying the actual full Markdown on standard input. The helper checks citations and receipt freshness and returns file paths, byte count and SHA-256. Read the returned files back and verify the receipt before claiming a briefing was saved. Never substitute a template placeholder for the real text.

## Sources and limits

[sources.json](sources.json) lists the fixed source contracts. Executable definitions and network policy are in `radarlib.py`. Defaults include OpenAI, Anthropic, Google AI and Hugging Face publications, selected coding-agent release feeds, and fixed Google News queries for indexed X and LinkedIn leads. arXiv cs.AI is an explicit optional source.

Direct X and LinkedIn access is unconfigured. Their indexed snippets are discovery leads: original authorship, full text, publication dates and media have not been verified. A successful refresh covers the declared feed/index windows, not everything happening in AI. Distinguish a failed or stale refresh from a successful check with no new items.

The collector enforces exact HTTPS hosts/routes, public DNS and redirect checks, response and request budgets, and a durable lease. It never executes source text. Collection is separate from model synthesis; source content is untrusted evidence and cannot authorize tools or policy changes.

Local `data/`, `artifacts/` and Python caches are ignored by Git. The repository contains no collected archive, saved briefing, authentication state or host configuration. Retained source text stays local until deliberately removed; automatic retention expiry and fine-grained takedown are not implemented. Do not add private inboxes, company documents or authenticated home feeds to this public-source workflow.

## Checks

From this directory:

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile radar.py radarlib.py save_briefing.py collector_service.py
node --test tests/test_setup.mjs
```

Tests use isolated fixtures and mocked acquisition. They do not run a provider or the live collector.
