import dataclasses
import datetime as dt
import json
import io
from contextlib import redirect_stdout
from pathlib import Path
import sqlite3
import shlex
import tempfile
import threading
import unittest
from unittest.mock import patch

import radarlib as r


RECENT = r.now()
OLD = (dt.datetime.now(r.UTC) - dt.timedelta(days=10)).isoformat()


def rss(entries, *, etag="v1"):
    body = "<rss version='2.0'><channel>"
    for title, slug, date in entries:
        body += f"<item><title>{title}</title><link>https://openai.com/index/{slug}</link><guid>{slug}</guid><description>Public source excerpt</description><pubDate>{date}</pubDate></item>"
    return body.encode() + b"</channel></rss>"


class FakeClient:
    def __init__(self, response, conditional=False):
        self.response = response
        self.conditional = conditional
        self.calls = []
        self.requests = 0

    def get(self, url, headers=None):
        headers = headers or {}
        self.calls.append((url, headers))
        self.requests += 1
        if isinstance(self.response, Exception):
            raise self.response
        if self.conditional and headers.get("If-None-Match") == self.response.headers.get("etag"):
            return r.Response(url, 304, b"", self.response.headers)
        return self.response


class ParserTests(unittest.TestCase):
    def test_rss_escaped_text_and_stable_native_identity(self):
        source = r.SOURCE_MAP["openai-news"]
        body = b"<rss><channel><item><title>A &amp; B</title><link>https://openai.com/index/a?utm_source=rss</link><guid>stable-guid</guid><description>&lt;p&gt;Some &lt;b&gt;text&lt;/b&gt;.&lt;/p&gt;</description><pubDate>Tue, 10 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>"
        items, rejected = r.parse_feed(body, source)
        self.assertEqual(rejected, [])
        self.assertEqual(items[0].title, "A & B")
        self.assertEqual(items[0].native_id, "stable-guid")
        self.assertEqual(items[0].published_at, "2026-11-10T09:00:00Z")
        self.assertEqual(items[0].url, "https://openai.com/index/a")
        self.assertEqual(items[0].excerpt, "Some text .")

    def test_atom_namespaces_links_and_prerelease(self):
        body = b"""<feed xmlns='http://www.w3.org/2005/Atom'><entry>
          <id>tag:github.com,2008:repo/v1-alpha.1</id><title>v1-alpha.1</title>
          <updated>2026-11-09T12:30:00Z</updated>
          <link rel='alternate' href='https://github.com/openai/codex/releases/tag/v1-alpha.1'/>
          <content type='html'>&lt;p&gt;Release details&lt;/p&gt;</content>
          <author><name>publisher</name></author></entry></feed>"""
        item = r.parse_feed(body, r.SOURCE_MAP["github-codex"])[0][0]
        self.assertEqual(item.author, "publisher")
        self.assertIn("prerelease-or-nightly", item.labels)
        self.assertIn("release-time-from-atom-updated", item.labels)
        self.assertEqual(item.excerpt, "Release details")

    def test_indexed_social_date_is_not_a_post_date(self):
        body = b"""<rss><channel><item><title>Unverified launch snippet - x.com</title>
        <link>https://news.google.com/rss/articles/CBMi_test-token?oc=5</link>
        <guid>index-123</guid><pubDate>Tue, 10 Nov 2026 09:00:00 GMT</pubDate>
        <description>Search snippet only</description></item></channel></rss>"""
        item = r.parse_feed(body, r.SOURCE_MAP["x-indexed-discovery"])[0][0]
        self.assertIsNone(item.published_at)
        self.assertEqual(item.indexed_at, "2026-11-10T09:00:00Z")
        self.assertEqual(item.evidence_tier, "unknown")
        self.assertTrue(item.extraction_status.startswith("indexed_social_lead"))
        self.assertEqual(item.author, "")

    def test_official_feed_permalink_does_not_expand_network_routes(self):
        url = "https://blog.google/products-and-platforms/products/education/example/"
        body = f"<rss><channel><item><title>Moved section</title><link>{url}</link></item></channel></rss>".encode()
        item = r.parse_feed(body, r.SOURCE_MAP["google-ai"])[0][0]
        self.assertEqual(item.url, url.rstrip("/"))
        with self.assertRaises(r.AccessDenied):
            r.validate_url(url)

    def test_html_login_or_wrong_xml_does_not_count_as_empty_success(self):
        for body in (b"<html><title>Sign in</title></html>", b"<rss><channel/></rss>"):
            with self.assertRaises(r.RadarError):
                r.parse_feed(body, r.SOURCE_MAP["openai-news"])

    def test_entity_declarations_are_rejected(self):
        with self.assertRaises(r.RadarError):
            r.parse_feed(b'<!DOCTYPE foo [<!ENTITY x "x">]><rss/>', r.SOURCE_MAP["openai-news"])

    def test_sitemap_scope_and_engineering_canonical(self):
        sitemap = b"""<urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>
          <url><loc>https://www.anthropic.com/careers</loc></url>
          <url><loc>https://www.anthropic.com/research/a</loc><lastmod>2026-11-10T00:00:00Z</lastmod></url>
          <url><loc>http://127.0.0.1/private</loc></url></urlset>"""
        self.assertEqual(r.parse_sitemap(sitemap), {"https://www.anthropic.com/research/a": "2026-11-10T00:00:00Z"})
        page = b"""<html><head><title>Research A</title>
         <link rel='canonical' href='https://www.anthropic.com/research/a'/>
         <meta property='article:published_time' content='2026-11-10T00:00:00Z'/>
         <meta name='description' content='Declared abstract.'/></head>
         <body><nav>Variable navigation</nav><main><article><h1>Research A</h1><p>Source text only.</p></article></main></body></html>"""
        item = r.article_item(page, "https://www.anthropic.com/engineering/a")
        self.assertEqual(item.url, "https://www.anthropic.com/research/a")
        altered = page.replace(b"Variable navigation", b"Completely changed navigation")
        self.assertEqual(item.version, r.article_item(altered, item.url).version)

    def test_retained_text_distinguishes_article_main_metadata_and_feed(self):
        article = b"<html><title>Example</title><main><article>Inspected body text.</article></main></html>"
        item = r.article_item(article, "https://www.anthropic.com/research/example")
        self.assertEqual(item.body_kind, "inspected_article_text")
        self.assertEqual(item.body_text, "Inspected body text.")
        main = r.article_item(article.replace(b"<article>", b"<section>").replace(b"</article>", b"</section>"), item.url)
        self.assertEqual(main.body_kind, "inspected_main_text")
        metadata = r.article_item(b"<html><title>Example</title><meta name='description' content='Abstract only.'/></html>", item.url)
        self.assertEqual(metadata.body_kind, "article_metadata")
        feed = r.parse_feed(rss([("Example", "example", RECENT)]), r.SOURCE_MAP["openai-news"])[0][0]
        self.assertEqual(feed.body_kind, "feed_text")


class SourceBoundaryTests(unittest.TestCase):
    def test_private_arbitrary_and_ambiguous_destinations_are_blocked(self):
        invalid = ("http://openai.com/index/a", "https://127.0.0.1/index/a", "https://openai.com.evil.test/index/a", "https://u:p@openai.com/index/a", "https://openai.com:444/index/a", "https://openai.com/index/../private", "https://openai.com/index/%252e%252e/private", "https://github.com/other/repo/releases.atom", "https://news.google.com/rss/search?q=arbitrary")
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(r.AccessDenied):
                r.validate_url(url)

    def test_dns_nonpublic_resolution_is_blocked(self):
        with patch("radarlib.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(r.AccessDenied):
                r.public_address("openai.com")

    def test_redirect_is_validated_before_next_request(self):
        client = r.Client()
        with patch.object(client, "_request_with_retry", return_value=r.Response("https://openai.com/news/rss.xml", 302, b"", {"location": "https://127.0.0.1/private"})) as request:
            with self.assertRaises(r.AccessDenied):
                client.get("https://openai.com/news/rss.xml")
            self.assertEqual(request.call_count, 1)

    def test_social_post_is_link_only_and_wrapper_not_fetchable(self):
        self.assertEqual(r.validate_url("https://x.com/example/status/123", link_only=True), "https://x.com/example/status/123")
        for url in ("https://x.com/example/status/123", "https://news.google.com/rss/articles/CBMi_token"):
            with self.assertRaises(r.AccessDenied):
                r.validate_url(url)


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = r.Store(self.root / "data" / "test.sqlite3")
        self.root_patch = patch.object(r, "ROOT", self.root)
        self.root_patch.start()

    def tearDown(self):
        self.root_patch.stop()
        self.store.close()
        self.temp.cleanup()

    def collect(self, body, **kwargs):
        fake = FakeClient(r.Response("https://openai.com/news/rss.xml", 200, body, {"etag": kwargs.pop("etag", "v1")}))
        return r.collect(self.store, source_ids=["openai-news"], client=fake, **kwargs)

    def item(self, title="Initial", labels=None):
        return r.Item("https://openai.com/index/a", title, "Excerpt", RECENT, author="publisher", content_hash=r.digest(title), labels=labels or [])

    def test_repeat_collection_is_idempotent_and_advances_bounded_backfill(self):
        body = rss([("A", "a", RECENT), ("B", "b", RECENT)])
        first = self.collect(body, limit=1)
        self.assertEqual(first["status"], "partial")
        self.assertEqual(first["totals"]["items"], 1)
        second = self.collect(body, limit=1)
        third = self.collect(body, limit=1)
        self.assertEqual(second["totals"]["items"], 2)
        self.assertEqual(third["totals"]["versions"], 2)
        self.assertEqual(third["results"][0]["coverage"]["pending_in_scope"], 0)

    def test_expanding_lookback_does_not_reuse_a_narrow_304(self):
        response = r.Response("https://openai.com/news/rss.xml", 200, rss([("Today", "today", RECENT), ("Older", "older", OLD)]), {"etag": "same"})
        first = FakeClient(response, conditional=True)
        r.collect(self.store, source_ids=["openai-news"], days=1, client=first)
        second = FakeClient(response, conditional=True)
        result = r.collect(self.store, source_ids=["openai-news"], days=30, client=second)
        self.assertEqual(second.calls[0][1], {})
        self.assertEqual(result["totals"]["items"], 2)

    def test_retention_upgrade_replays_unchanged_feed_before_reusing_etag(self):
        body = rss([("Existing item", "existing", RECENT)])
        item = r.parse_feed(body, r.SOURCE_MAP["openai-news"])[0][0]
        legacy = dataclasses.replace(item, body_text=None)
        with self.store.db:
            self.store.upsert("openai-news", legacy, r.now())
            self.store.db.execute("UPDATE sources SET status='completed',etag='same',coverage_json=? WHERE id='openai-news'", (json.dumps({"requested_since": r.since_days(31), "pending_in_scope": 0}),))
        fake = FakeClient(r.Response("https://openai.com/news/rss.xml", 200, body, {"etag": "same"}), conditional=True)
        result = r.collect(self.store, source_ids=["openai-news"], client=fake)
        self.assertEqual(fake.calls[0][1], {})
        self.assertEqual(result["totals"]["versions"], 1)
        self.assertEqual(self.store.document(item.id)["text_coverage"]["kind"], "feed_text")
        again = FakeClient(fake.response, conditional=True)
        r.collect(self.store, source_ids=["openai-news"], client=again)
        self.assertEqual(again.calls[0][1]["If-None-Match"], "same")

    def test_failed_source_retains_last_successful_cursor(self):
        self.collect(rss([("A", "a", RECENT)]))
        before = self.store.source("openai-news")
        result = r.collect(self.store, source_ids=["openai-news"], client=FakeClient(r.RadarError("HTTP 403")))
        after = self.store.source("openai-news")
        self.assertEqual(result["status"], "partial")
        self.assertEqual(after["status"], "failed")
        self.assertEqual(before["cursor_json"], after["cursor_json"])
        self.assertEqual(before["last_success"], after["last_success"])

    def test_source_topic_membership_does_not_manufacture_evidence_edits(self):
        first = self.item(labels=["agents", "developer-tools"])
        second = dataclasses.replace(first, labels=["research", "models", "safety"])
        with self.store.db:
            self.store.upsert("anthropic-engineering", first, r.now())
        packet = r.brief(self.store)
        with self.store.db:
            change = self.store.upsert("anthropic-research", second, r.now())
        self.assertEqual(change, "unchanged")
        self.assertEqual(self.store.status()["totals"]["versions"], 1)
        self.assertFalse(r.receipt_status(self.store, packet["receipt_id"])["stale"])

    def test_changed_source_invalidates_receipt_and_preserves_version_history(self):
        with self.store.db:
            self.store.upsert("openai-news", self.item(), r.now())
        packet = r.brief(self.store)
        with self.store.db:
            self.store.upsert("openai-news", self.item("Corrected announcement"), r.now())
        receipt = r.receipt_status(self.store, packet["receipt_id"])
        self.assertTrue(receipt["stale"])
        self.assertEqual(self.store.status()["totals"]["versions"], 2)
        self.assertEqual(self.store.search("Corrected")[0]["title"], "Corrected announcement")

    def test_unchanged_feed_preserves_manual_article_enrichment(self):
        body = rss([("A", "a", RECENT)])
        self.collect(body)
        article = f"""<html><head><title>A</title>
        <meta name='description' content='Richer article evidence.'/>
        <meta property='article:published_time' content='{RECENT}'/>
        </head><main><article><h1>A</h1><p>Complete article content.</p></article></main></html>""".encode()
        r.intake(self.store, "https://openai.com/index/a", client=FakeClient(r.Response("https://openai.com/index/a", 200, article, {})))
        enriched = self.store.search()[0]
        packet = r.brief(self.store)
        repeated = self.collect(body)
        self.assertEqual(repeated["results"][0]["changed"], 0)
        self.assertEqual(self.store.search()[0]["version"], enriched["version"])
        self.assertEqual(self.store.search()[0]["excerpt"], "Richer article evidence.")
        self.assertFalse(r.receipt_status(self.store, packet["receipt_id"])["stale"])
        # A real change to the previously observed feed is different from a
        # repeated representation. It becomes visible and stales cited work.
        self.collect(rss([("Corrected A", "a", RECENT)]), etag="v2")
        self.assertEqual(self.store.search()[0]["title"], "Corrected A")
        self.assertTrue(r.receipt_status(self.store, packet["receipt_id"])["stale"])

    def test_first_feed_observation_does_not_erase_existing_article(self):
        article = dataclasses.replace(self.item("A"), excerpt="Inspected article excerpt", extraction_status="article_metadata_excerpt")
        with self.store.db:
            self.store.upsert("manual-links", article, r.now())
        self.collect(rss([("A", "a", RECENT)]))
        self.assertEqual(self.store.search()[0]["excerpt"], "Inspected article excerpt")

    def test_recent_correction_enters_brief_without_rewriting_historical_publication(self):
        old_publication = (dt.datetime.now(r.UTC) - dt.timedelta(days=60)).isoformat()
        corrected = dataclasses.replace(self.item("Older corrected article"), published_at=r.stamp(old_publication), updated_at=RECENT)
        with self.store.db:
            self.store.upsert("anthropic-research", corrected, r.now())
        self.assertEqual(self.store.search(since=r.since_days(7)), [])
        packet = r.brief(self.store, days=7)
        self.assertEqual(packet["items"][0]["title"], "Older corrected article")
        self.assertTrue(packet["items"][0]["is_source_update"])
        self.assertEqual(packet["items"][0]["published_at"], r.stamp(old_publication))

    def test_snapshot_and_receipt_are_atomic_against_a_writer(self):
        with self.store.db:
            self.store.upsert("openai-news", self.item(), r.now())
        original = r._balanced_packet
        writer_blocked = []

        def during_snapshot(store, since, limit):
            captured = original(store, since, limit)

            def writer():
                other = sqlite3.connect(self.store.path, timeout=0.03)
                try:
                    with other:
                        other.execute("UPDATE items SET last_seen='concurrent writer' WHERE id=?", (self.item().id,))
                except sqlite3.OperationalError as exc:
                    writer_blocked.append("locked" in str(exc))
                finally:
                    other.close()

            thread = threading.Thread(target=writer)
            thread.start()
            thread.join(8)
            self.assertFalse(thread.is_alive())
            return captured

        with patch.object(r, "_balanced_packet", side_effect=during_snapshot):
            packet = r.brief(self.store)
        self.assertEqual(writer_blocked, [True])
        self.assertFalse(r.receipt_status(self.store, packet["receipt_id"])["stale"])
        with self.store.db:
            self.store.upsert("openai-news", self.item("Subsequent correction"), r.now())
        self.assertTrue(r.receipt_status(self.store, packet["receipt_id"])["stale"])

    def test_collection_lock_remains_held_until_commit_and_release(self):
        other = r.Store(self.store.path)
        try:
            with self.store.collection_lease() as (_, owner):
                with self.store.db:
                    self.store.upsert("openai-news", self.item(), r.now())
                    self.store.renew(owner)
                with self.assertRaises(r.Busy):
                    with other.collection_lease():
                        self.fail("Second collector acquired live lease")
            with other.collection_lease():
                self.assertEqual(other.status()["totals"]["items"], 1)
        finally:
            other.close()

    def test_expired_crashed_lease_is_reconciled(self):
        with self.store.db:
            self.store.db.execute("INSERT INTO runs VALUES('old','old-owner',?,NULL,'running',NULL)", (r.now(),))
            self.store.db.execute("INSERT INTO leases VALUES('collection','old-owner','old',0)")
        with self.store.collection_lease():
            old = self.store.db.execute("SELECT status FROM runs WHERE id='old'").fetchone()[0]
            self.assertEqual(old, "abandoned")

    def test_manual_social_intake_never_fetches_the_post(self):
        fake = FakeClient(r.RadarError("Should not fetch"))
        result = r.intake(self.store, "https://x.com/example/status/123", note="Please investigate", client=fake)
        self.assertEqual(fake.calls, [])
        self.assertEqual(result["evidence_tier"], "unknown")
        self.assertTrue(result["extraction_status"].startswith("link_only"))

    def test_social_leads_are_separate_in_evidence_packet(self):
        item = r.Item("https://news.google.com/rss/articles/token", "Index snippet", "Snippet only", indexed_at=RECENT, evidence_tier="unknown", extraction_status="indexed_social_lead; original post not inspected", content_hash=r.digest("Snippet only"), body_text="Snippet only", body_kind="indexed_social_snippet", body_scope="feed_supplied_text", body_total_chars=12)
        with self.store.db:
            self.store.upsert("x-indexed-discovery", item, r.now())
        packet = r.brief(self.store)
        self.assertEqual(packet["items"], [])
        self.assertEqual(len(packet["discovery_leads"]), 1)
        self.assertIsNone(packet["discovery_leads"][0]["original_url"])
        self.assertIsNone(packet["discovery_leads"][0]["published_at"])
        evidence = r.passage_evidence(self.store.passages(item_id=item.id)[0])
        self.assertEqual(evidence["record_kind"], "indexed_social_lead")
        self.assertIsNone(evidence["original_url"])
        self.assertIsNone(evidence["published_at"])
        self.assertEqual(evidence["indexed_at"], RECENT)
        self.assertEqual(evidence["evidence_tier"], "unknown")
        self.assertEqual(evidence["text_coverage"]["kind"], "indexed_social_snippet")
        self.assertFalse(evidence["text_coverage"]["complete_extracted_text"])

    def test_retention_backfill_preserves_version_and_old_receipt_scope(self):
        text = "Earlier context. " * 100 + "The capabilityneedle is explained here."
        legacy = dataclasses.replace(self.item(), content_hash=r.digest(text), extraction_status="article_metadata_excerpt")
        with self.store.db:
            self.store.upsert("manual-links", legacy, r.now())
        packet = r.brief(self.store)
        old_passage = self.store.passages(item_id=legacy.id)[0]
        enriched = dataclasses.replace(legacy, body_text=text, body_kind="inspected_article_text", body_scope="html_article", body_total_chars=len(text), body_source_url=legacy.url)
        with self.store.db:
            self.assertEqual(self.store.upsert("manual-links", enriched, r.now()), "unchanged")
        self.assertEqual(legacy.version, enriched.version)
        self.assertEqual(self.store.status()["totals"]["versions"], 1)
        self.assertFalse(r.receipt_status(self.store, packet["receipt_id"])["stale"])
        self.assertEqual(packet["items"][0]["text_coverage"]["kind"], "metadata_excerpt")
        self.assertNotIn("body_text", packet["items"][0])
        document = self.store.document(legacy.id)
        self.assertEqual(document["text"], text)
        self.assertTrue(document["text_coverage"]["complete_extracted_text"])
        self.assertEqual(self.store.search("capabilityneedle")[0]["id"], legacy.id)
        self.assertIn("document", self.store.search()[0]["retrieval"])
        historical = self.store.passage(old_passage["passage_id"])
        self.assertEqual(historical["text"], legacy.excerpt)
        self.assertEqual(historical["text_coverage"]["kind"], "metadata_excerpt")
        self.assertFalse(historical["is_current_text"])
        projected = r.passage_evidence(historical)
        self.assertTrue(projected["is_current_version"])
        self.assertFalse(projected["is_current_text"])
        self.assertEqual(projected["text_coverage"]["kind"], "metadata_excerpt")
        self.assertEqual(json.loads(Path(packet["json_path"]).read_text())["items"][0]["text_coverage"]["kind"], "metadata_excerpt")

    def test_ranked_or_search_and_passages_use_retained_body_and_filters(self):
        late_text = "Background context. " * 100 + "AI agent memory is discussed beyond the excerpt."
        primary = dataclasses.replace(self.item("Agent memory"), body_text=late_text, body_kind="inspected_article_text", body_scope="html_article", body_total_chars=len(late_text), content_hash=r.digest(late_text))
        other = dataclasses.replace(self.item("Unrelated title"), url="https://openai.com/index/b", published_at="2026-11-09T00:00:00Z", body_text="An agent works here.", body_kind="feed_text", body_total_chars=20, content_hash=r.digest("An agent works here."))
        with self.store.db:
            self.store.upsert("manual-links", primary, r.now())
            self.store.upsert("openai-news", other, r.now())
        results = self.store.search("agent memory")
        self.assertEqual([entry["id"] for entry in results], [primary.id, other.id])
        self.assertEqual(self.store.search("AI")[0]["id"], primary.id)
        self.assertEqual(self.store.search("AI", source_id="openai-news"), [])
        self.assertEqual(self.store.search("___ !!!"), [])
        self.assertEqual(self.store.search("agent", since="2026-11-10T00:00:00Z", until="2026-11-10T23:59:59Z")[0]["id"], primary.id)
        passages = self.store.passages("AI", item_id=primary.id)
        self.assertIn("beyond the excerpt", passages[0]["text"])
        self.assertEqual(passages[0]["version"], primary.version)
        self.assertEqual(self.store.passages("AI", source_id="openai-news"), [])
        self.assertEqual({row["id"] for row in self.store.passages("agent", since="2026-11-10T00:00:00Z", until="2026-11-10T23:59:59Z")}, {primary.id})
        self.assertEqual(self.store.passage(passages[0]["passage_id"])["text"], passages[0]["text"])
        self.assertEqual(self.store.document(primary.id, offset=10, max_chars=40)["text"], late_text[10:50])
        with self.assertRaises(r.RadarError):
            self.store.document(other.id, version=primary.version)

    def test_local_retrieval_cli_reads_fixture_text_without_network(self):
        import radar
        text = "Context. " * 100 + "A unique retrievabilityneedle appears here."
        item = dataclasses.replace(self.item("Local evidence"), body_text=text, body_kind="feed_text", body_scope="feed_supplied_text", body_total_chars=len(text), content_hash=r.digest(text))
        with self.store.db:
            self.store.upsert("openai-news", item, r.now())
        with patch.object(r.Client, "get", side_effect=AssertionError("Local retrieval must not fetch")):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(radar.main(["--database", str(self.store.path), "document", item.id, "--version", item.version, "--max-chars", "100", "--json"]), 0)
            document = json.loads(output.getvalue())
            self.assertEqual(document["text"], text[:100])
            self.assertTrue(document["output_coverage"]["response_truncated"])
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(radar.main(["--database", str(self.store.path), "passages", "retrievabilityneedle", "--item", item.id, "--json"]), 0)
            passage = json.loads(output.getvalue())["items"][0]
            self.assertEqual(passage["version"], item.version)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(radar.main(["--database", str(self.store.path), "passage", passage["passage_id"], "--json"]), 0)
            self.assertEqual(json.loads(output.getvalue())["text"], passage["text"])

    def test_generated_retrieval_shortcuts_keep_the_owning_isolated_database(self):
        import radar
        item = self.item("Isolationneedle")
        with self.store.db:
            self.store.upsert("openai-news", item, r.now())
        commands = self.store.search("Isolationneedle")[0]["retrieval"]
        packet = r.brief(self.store)
        original_store = radar.Store

        def isolated_only(path):
            # Fail before opening any other/default database, including live state.
            self.assertEqual(Path(path).resolve(), self.store.path.resolve())
            return original_store(path)

        with patch.object(radar, "Store", side_effect=isolated_only), patch.object(r.Client, "get", side_effect=AssertionError("Shortcut must remain local")):
            for command in commands.values():
                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(radar.main(shlex.split(command)[2:]), 0)
                value = json.loads(output.getvalue())
                evidence = value["items"][0] if "items" in value else value
                self.assertEqual(evidence.get("item_id", evidence.get("id")), item.id)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(radar.main(shlex.split(packet["freshness_check_command"])[2:]), 0)
            self.assertEqual(json.loads(output.getvalue())["id"], packet["receipt_id"])

    def test_passage_cli_has_one_canonical_citation_id_and_lean_provenance(self):
        import radar
        text = "Evidence paragraph about agent memory and a stable named finding. " * 400
        item = r.article_item(("<html><title>Research fixture</title><article>" + text + "</article></html>").encode(), "https://www.anthropic.com/research/fixture")
        item.published_at = RECENT
        with self.store.db:
            self.store.upsert("anthropic-research", item, r.now())
        internal = self.store.passages(item_id=item.id, limit=200)
        verbose_bytes = len(json.dumps({"schema_version": 1, "items": internal}, ensure_ascii=False, indent=2).encode())
        with patch.object(r.Client, "get", side_effect=AssertionError("Passage CLI must remain local")):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(radar.main(["--database", str(self.store.path), "passages", "--item", item.id, "--limit", "200", "--json"]), 0)
            self.assertLess(len(output.getvalue().encode()), verbose_bytes * 0.6)
            payload = json.loads(output.getvalue())
            self.assertEqual(payload["citation_id_field"], "passage_id")
            self.assertIn("--database " + shlex.quote(str(self.store.path.resolve())), payload["passage_lookup_command"])
            entries = payload["items"]
            self.assertEqual([entry["passage_id"] for entry in entries], [entry["passage_id"] for entry in internal])
            for entry in entries:
                self.assertEqual(next(iter(entry)), "passage_id")
                self.assertEqual(entry["item_id"], item.id)
                self.assertEqual(entry["version"], item.version)
                self.assertEqual(entry["url"], item.url)
                self.assertEqual(entry["source_ids"], ["anthropic-research"])
                self.assertEqual(entry["date_basis"], "publication")
                self.assertEqual(entry["published_at"], RECENT)
                self.assertEqual(entry["evidence_tier"], "self-reported")
                self.assertEqual(entry["text"], item.body_text[entry["start_char"]:entry["end_char"]])
                self.assertTrue(entry["is_current_version"])
                self.assertTrue(entry["is_current_text"])
                self.assertTrue(entry["source_text_is_untrusted"])
                self.assertEqual(entry["text_coverage"]["kind"], "inspected_article_text")
                self.assertFalse(entry["text_coverage"]["truncated"])
                self.assertTrue(set(entry).isdisjoint({"id", "fingerprint", "passage_hash", "content_hash", "text_id", "current_version", "excerpt", "match_excerpt", "retrieval", "available_version_count"}))
                self.assertTrue(set(entry["text_coverage"]).isdisjoint({"text_id", "retained_hash"}))
            chosen = entries[0]
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(radar.main(["--database", str(self.store.path), "passage", chosen["passage_id"], "--json"]), 0)
            exact = json.loads(output.getvalue())
            self.assertEqual(exact["passage_id"], chosen["passage_id"])
            self.assertEqual(exact["text"], chosen["text"])
            self.assertNotIn("passage_hash", exact)

    def test_truncation_and_changed_body_keep_historical_passages_and_stale_receipts(self):
        text = "Retained public content. " * (r.BODY_LIMIT // 10)
        first = r.article_item(("<html><title>Long article</title><article>" + text + "</article></html>").encode(), "https://openai.com/index/long")
        first.published_at = RECENT
        with self.store.db:
            self.store.upsert("manual-links", first, r.now())
        doc = self.store.document(first.id, max_chars=r.BODY_LIMIT)
        self.assertEqual(len(doc["text"]), r.BODY_LIMIT)
        self.assertTrue(doc["text_coverage"]["truncated"])
        self.assertFalse(doc["text_coverage"]["complete_extracted_text"])
        old_passage = self.store.passages("content", item_id=first.id)[0]
        packet = r.brief(self.store)
        changed = r.article_item(("<html><title>Long article</title><article>" + text + " Correction after retained limit.</article></html>").encode(), first.url)
        changed.published_at = RECENT
        with self.store.db:
            self.store.upsert("manual-links", changed, r.now())
        self.assertNotEqual(first.version, changed.version)
        self.assertTrue(r.receipt_status(self.store, packet["receipt_id"])["stale"])
        self.assertFalse(self.store.passage(old_passage["passage_id"])["is_current_version"])
        self.assertEqual(self.store.document(first.id, version=first.version)["version"], first.version)

    def test_upgrade_legacy_database_keeps_excerpt_fallback_without_claiming_full_text(self):
        path = self.root / "legacy.sqlite3"
        legacy = self.item("Legacy title")
        db = sqlite3.connect(path)
        db.executescript("""
          CREATE TABLE items(id TEXT PRIMARY KEY,url TEXT UNIQUE,first_seen TEXT,last_seen TEXT,current_version TEXT,state TEXT DEFAULT 'active');
          CREATE TABLE item_versions(id TEXT PRIMARY KEY,item_id TEXT,fingerprint TEXT,observed_at TEXT,title TEXT,excerpt TEXT,published_at TEXT,updated_at TEXT,author TEXT,content_hash TEXT,evidence_tier TEXT,extraction_status TEXT,media_status TEXT,labels_json TEXT);
          PRAGMA user_version=1;
        """)
        db.execute("INSERT INTO items(id,url,first_seen,last_seen,current_version) VALUES(?,?,?,?,?)", (legacy.id, legacy.url, RECENT, RECENT, legacy.version))
        db.execute("INSERT INTO item_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (legacy.version, legacy.id, legacy.fingerprint, RECENT, legacy.title, legacy.excerpt, RECENT, None, "publisher", legacy.content_hash, "self-reported", "article_metadata_excerpt", "uninspected", "[]"))
        db.commit()
        db.close()
        upgraded = r.Store(path)
        try:
            doc = upgraded.document(legacy.id)
            self.assertEqual(doc["version"], legacy.version)
            self.assertEqual(doc["text"], "Excerpt")
            self.assertEqual(doc["text_coverage"]["kind"], "legacy_excerpt")
            self.assertIsNone(doc["text_coverage"]["normalized_chars"])
            self.assertIsNone(doc["text_coverage"]["truncated"])
            self.assertFalse(doc["text_coverage"]["complete_extracted_text"])
            self.assertEqual(upgraded.search("Legacy")[0]["id"], legacy.id)
            self.assertEqual(upgraded.db.execute("PRAGMA user_version").fetchone()[0], 2)
        finally:
            upgraded.close()


if __name__ == "__main__":
    unittest.main()
