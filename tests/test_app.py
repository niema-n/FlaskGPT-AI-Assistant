"""Regression tests for FlaskGPT features that do not require a live Groq key."""

import io
import os
import tempfile
import sqlite3
import unittest
from types import SimpleNamespace
from pathlib import Path

import httpx
from groq import APIConnectionError, APITimeoutError, AuthenticationError, RateLimitError
from pypdf import PdfReader

import app as flaskgpt


class FlaskGPTTestCase(unittest.TestCase):
    def setUp(self):
        handle, self.database_path = tempfile.mkstemp(suffix=".sqlite3")
        os.close(handle)
        self.original_database_path = flaskgpt.DATABASE_PATH
        self.original_client = flaskgpt.client
        flaskgpt.DATABASE_PATH = self.database_path
        flaskgpt.client = None
        flaskgpt.init_db()
        flaskgpt.app.config.update(TESTING=True)
        self.client = flaskgpt.app.test_client()

    def tearDown(self):
        flaskgpt.DATABASE_PATH = self.original_database_path
        flaskgpt.client = self.original_client
        try:
            os.remove(self.database_path)
        except FileNotFoundError:
            pass

    def create_conversation(self, domain="Général", custom_domain=""):
        response = self.client.post("/api/conversations", json={
            "title": "Test conversation",
            "domain": domain,
            "custom_domain": custom_domain,
        })
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def test_home_renders_professional_workspace_navigation(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        for marker in ("app-sidebar", "view-dashboard", "view-assistant", "view-history",
                       "view-performance", "view-analysis", "view-sources", "view-ratings"):
            self.assertIn(marker, body)
        self.assertIn('id="view-dashboard" data-view-panel="dashboard" class="view-panel space-y-6"', body)
        self.assertIn('id="view-assistant" data-view-panel="assistant" class="view-panel hidden"', body)
        self.assertIn('id="dashboard-refresh"', body)
        for asset_path in ("/static/dist/css/style.css", "/static/dist/js/script.js"):
            with self.subTest(asset=asset_path):
                asset_response = self.client.get(asset_path)
                self.assertEqual(asset_response.status_code, 200)
                asset_response.close()

    def test_conversation_domain_is_validated_and_persisted(self):
        conversation = self.create_conversation("domain inconnu")
        self.assertEqual(conversation["domain"], "Général")
        opened = self.client.get(f"/api/conversations/{conversation['id']}")
        self.assertEqual(opened.get_json()["domain"], "Général")

    def test_other_domain_requires_and_persists_user_specification(self):
        missing = self.client.post("/api/conversations", json={
            "title": "Test", "domain": "Autre",
        })
        self.assertEqual(missing.status_code, 400)
        conversation = self.create_conversation("Autre", "  Droit   immobilier ")
        self.assertEqual(conversation["custom_domain"], "Droit immobilier")
        opened = self.client.get(f"/api/conversations/{conversation['id']}").get_json()
        self.assertEqual(opened["custom_domain"], "Droit immobilier")

    def test_rating_and_summary_are_saved(self):
        conversation = self.create_conversation()
        with flaskgpt.database_connection() as connection:
            cursor = connection.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)",
                (conversation["id"], "Réponse de test", flaskgpt.current_timestamp()),
            )
            message_id = cursor.lastrowid
        rated = self.client.post(
            f"/api/messages/{message_id}/rating",
            json={"rating": "satisfaisante"},
        )
        self.assertEqual(rated.status_code, 200)
        summary = self.client.get("/api/ratings/summary").get_json()
        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["counts"]["satisfaisante"], 1)
        recent = self.client.get("/api/ratings/recent").get_json()
        self.assertEqual(recent[0]["title"], conversation["title"])
        self.assertEqual(recent[0]["rating"], "satisfaisante")

    def test_performance_dashboard_uses_real_domain_metrics(self):
        conversation = self.create_conversation("Finance")
        with flaskgpt.database_connection() as connection:
            connection.execute(
                """INSERT INTO request_metrics
                   (conversation_id, request_type, response_time_ms, prompt_tokens,
                    completion_tokens, total_tokens, tokens_exact, domain, status, created_at)
                   VALUES (?, 'chat', 325.5, 12, 8, 20, 1, 'Finance', 'complete', ?)""",
                (conversation["id"], flaskgpt.current_timestamp()),
            )
        report = self.client.get("/api/performance").get_json()
        self.assertEqual(report["overall"]["total_tokens"], 20)
        self.assertEqual(report["domains"][0]["domain"], "Finance")
        self.assertEqual(report["domains"][0]["average_response_ms"], 325.5)
        filtered = self.client.get(
            f"/api/performance?conversation_id={conversation['id']}"
        ).get_json()
        self.assertEqual(len(filtered["domains"]), 1)
        self.assertEqual(filtered["overall"]["requests"], 1)

    def test_quality_report_identifies_missing_values_and_duplicates(self):
        report = flaskgpt.analyze_dataset(
            ["name", "score"],
            [["A", "1"], ["A", "1"], ["B", ""], ["C", "2"],
             ["D", "3"], ["E", "100"], ["F", "unknown"]],
            "unit-test.csv",
        )
        self.assertEqual(report["rows"], 7)
        self.assertEqual(report["missing_cells"], 1)
        self.assertEqual(report["duplicate_rows"], 1)
        self.assertEqual(report["inconsistent_values"], 1)
        self.assertEqual(report["outliers"], 1)
        self.assertTrue(0 <= report["quality_score"] <= 100)

    def test_uploaded_quality_report_is_saved_for_dashboard(self):
        response = self.client.post(
            "/api/data-quality/analyze",
            data={"dataset": (io.BytesIO(b"name,score\nA,1\nB,\n"), "quality.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["missing_cells"], 1)
        recent = self.client.get("/api/data-quality/recent")
        self.assertEqual(recent.status_code, 200)
        self.assertEqual(recent.get_json()[0]["source"], "quality.csv")

    def test_source_upload_and_delete(self):
        upload = self.client.post(
            "/api/sources",
            data={"source": (io.BytesIO(b"Revenue increased in Q1."), "report.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 201)
        source_id = upload.get_json()["id"]
        listed = self.client.get("/api/sources").get_json()
        self.assertEqual(listed[0]["name"], "report.txt")
        deleted = self.client.delete(f"/api/sources/{source_id}")
        self.assertEqual(deleted.status_code, 200)

    def test_prompt_without_api_key_returns_clear_error_without_network(self):
        conversation = self.create_conversation()
        response = self.client.post("/prompt", json={
            "conversation_id": conversation["id"],
            "messages": ["Bonjour"],
            "domain": "Général",
        })
        self.assertEqual(response.status_code, 503)
        self.assertIn("GROQ_API_KEY", response.get_json()["error"])
        report = self.client.get("/api/performance").get_json()
        self.assertEqual(report["overall"]["requests"], 1)
        self.assertEqual(report["overall"]["errors"], 1)
        self.assertEqual(report["overall"]["completed_requests"], 0)
        self.assertEqual(report["recent_requests"][0]["error_type"], "ProviderUnavailable")
        opened = self.client.get(f"/api/conversations/{conversation['id']}").get_json()
        self.assertEqual(opened["messages"][0]["content"], "Bonjour")

    def test_prompt_stream_is_saved_with_reported_usage(self):
        conversation = self.create_conversation("Autre", "Agriculture durable")
        chunks = [
            SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content="Réponse "))],
                usage=None,
            ),
            SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content="en flux."))],
                usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
            ),
        ]

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                return iter(chunks)

        fake_completions = FakeCompletions()
        flaskgpt.client = SimpleNamespace(
            chat=SimpleNamespace(completions=fake_completions)
        )
        response = self.client.post("/prompt", json={
            "conversation_id": conversation["id"],
            "messages": ["Question de test"],
            "domain": "Autre",
            "custom_domain": "Agriculture durable",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_data(as_text=True), "Réponse en flux.")
        self.assertTrue(fake_completions.kwargs["stream"])
        self.assertEqual(
            fake_completions.kwargs["messages"][0]["role"], "system"
        )
        self.assertIn(
            "Agriculture durable",
            fake_completions.kwargs["messages"][0]["content"],
        )
        opened = self.client.get(f"/api/conversations/{conversation['id']}").get_json()
        self.assertEqual(opened["messages"][-1]["content"], "Réponse en flux.")
        metrics = self.client.get("/api/performance").get_json()["overall"]
        self.assertEqual(metrics["total_tokens"], 15)
        self.assertEqual(metrics["prompt_token_reports"], 1)

    def test_empty_dashboard_returns_zero_counts_and_unavailable_averages(self):
        conversations = self.client.get("/api/conversations").get_json()
        performance = self.client.get("/api/performance").get_json()
        self.assertEqual(conversations, [])
        self.assertEqual(performance["overall"]["requests"], 0)
        self.assertIsNone(performance["overall"]["average_response_ms"])
        self.assertIsNone(performance["overall"]["total_tokens"])
        self.assertEqual(performance["recent_requests"], [])

    def test_performance_average_excludes_failed_calls_and_filters_conversation(self):
        first = self.create_conversation("Finance")
        second = self.create_conversation("Général")
        for conversation, elapsed, status, domain in (
            (first, 100, "complete", "Finance"),
            (first, 300, "partial", "Informatique et développement"),
            (first, 900, "error", "Finance"),
            (second, 2000, "complete", "Général"),
        ):
            flaskgpt.save_request_metric(conversation["id"], {
                "response_time_ms": elapsed,
                "status": status,
                "domain": domain,
            })
        overall = self.client.get("/api/performance").get_json()["overall"]
        self.assertEqual(overall["requests"], 4)
        self.assertEqual(overall["completed_requests"], 2)
        self.assertEqual(overall["partial_requests"], 1)
        self.assertEqual(overall["errors"], 1)
        self.assertEqual(overall["average_response_ms"], 800)
        first_report = self.client.get(
            f"/api/performance?conversation_id={first['id']}"
        ).get_json()
        self.assertEqual(first_report["overall"]["requests"], 3)
        self.assertEqual(first_report["overall"]["average_response_ms"], 200)
        self.assertEqual(
            {row["domain"] for row in first_report["domains"]},
            {"Finance", "Informatique et développement"},
        )

    def test_incomplete_provider_token_usage_is_not_filled_with_a_fake_total(self):
        conversation = self.create_conversation("Finance")
        chunks = [SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="Réponse"))],
            usage=SimpleNamespace(prompt_tokens=7, completion_tokens=None, total_tokens=None),
        )]

        class FakeCompletions:
            def create(self, **kwargs):
                return iter(chunks)

        flaskgpt.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
        response = self.client.post("/prompt", json={
            "conversation_id": conversation["id"],
            "messages": ["Question"],
            "domain": "Finance",
        })
        self.assertEqual(response.status_code, 200)
        response.get_data(as_text=True)
        metrics = self.client.get("/api/performance").get_json()
        recent = metrics["recent_requests"][0]
        self.assertEqual(recent["prompt_tokens"], 7)
        self.assertIsNone(recent["completion_tokens"])
        self.assertIsNone(recent["total_tokens"])

    def test_provider_setup_exception_is_saved_as_a_failed_request(self):
        conversation = self.create_conversation("Finance")

        class FakeCompletions:
            def create(self, **kwargs):
                raise RuntimeError("private upstream details")

        flaskgpt.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
        response = self.client.post("/prompt", json={
            "conversation_id": conversation["id"],
            "messages": ["Question"],
            "domain": "Finance",
        })
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("private upstream details", response.get_data(as_text=True))
        recent = self.client.get("/api/performance").get_json()["recent_requests"][0]
        self.assertEqual(recent["status"], "error")
        self.assertEqual(recent["error_type"], "RuntimeError")
        self.assertEqual(recent["domain"], "Finance")

    def test_stream_interruption_is_not_counted_as_success(self):
        conversation = self.create_conversation("Finance")
        chunks = iter([SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="Partiel"))],
            usage=None,
        )])
        stream = flaskgpt.event_stream(
            chunks,
            conversation["id"],
            flaskgpt.perf_counter(),
            domain="Finance",
        )
        self.assertEqual(next(stream), "Partiel")
        stream.close()
        recent = self.client.get("/api/performance").get_json()["recent_requests"][0]
        self.assertEqual(recent["status"], "partial")
        self.assertEqual(recent["domain"], "Finance")

    def test_summary_requests_track_failures_tokens_and_conversation_domain(self):
        conversation = self.create_conversation("Finance")
        with flaskgpt.database_connection() as connection:
            connection.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                (conversation["id"], "Resume ceci", flaskgpt.current_timestamp()),
            )

        unavailable = self.client.get(
            f"/api/conversations/{conversation['id']}/summary.pdf"
        )
        self.assertEqual(unavailable.status_code, 503)

        class FakeCompletions:
            def create(self, **kwargs):
                return SimpleNamespace(
                    choices=[SimpleNamespace(message=SimpleNamespace(content="Resume genere"))],
                    usage=SimpleNamespace(prompt_tokens=9, completion_tokens=4, total_tokens=13),
                )

        flaskgpt.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
        generated = self.client.get(
            f"/api/conversations/{conversation['id']}/summary.pdf"
        )
        self.assertEqual(generated.status_code, 200)
        self.assertEqual(generated.mimetype, "application/pdf")
        summary_pdf = PdfReader(io.BytesIO(generated.get_data()))
        self.assertGreaterEqual(len(summary_pdf.pages), 1)
        self.assertIn("Resume genere", summary_pdf.pages[0].extract_text())
        metrics = self.client.get("/api/performance").get_json()
        self.assertEqual(metrics["overall"]["requests"], 2)
        self.assertEqual(metrics["overall"]["errors"], 1)
        self.assertEqual(metrics["overall"]["completed_requests"], 1)
        self.assertEqual(metrics["overall"]["total_tokens"], 13)
        summary_metric = next(
            entry for entry in metrics["recent_requests"]
            if entry["request_type"] == "summary" and entry["status"] == "complete"
        )
        self.assertEqual(summary_metric["domain"], "Finance")
        self.assertEqual(summary_metric["prompt_tokens"], 9)

    def test_multiple_requests_persist_history_and_domain_snapshot(self):
        conversation = self.create_conversation("Général")
        calls = []

        class FakeCompletions:
            def create(self, **kwargs):
                calls.append(kwargs)
                answer = f"Réponse {len(calls)}"
                return iter([SimpleNamespace(
                    choices=[SimpleNamespace(delta=SimpleNamespace(content=answer))],
                    usage=SimpleNamespace(prompt_tokens=2, completion_tokens=2, total_tokens=4),
                )])

        flaskgpt.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
        prompts = [
            (["Question 1"], "Général"),
            (["Question 1", "Réponse 1", "Question 2"], "Finance"),
        ]
        for messages, domain in prompts:
            response = self.client.post("/prompt", json={
                "conversation_id": conversation["id"],
                "messages": messages,
                "domain": domain,
            })
            self.assertEqual(response.status_code, 200)
            response.get_data(as_text=True)
        opened = self.client.get(f"/api/conversations/{conversation['id']}").get_json()
        self.assertEqual(
            [(message["role"], message["content"]) for message in opened["messages"]],
            [("user", "Question 1"), ("assistant", "Réponse 1"),
             ("user", "Question 2"), ("assistant", "Réponse 2")],
        )
        report = self.client.get("/api/performance").get_json()
        self.assertEqual(report["overall"]["requests"], 2)
        self.assertEqual({row["domain"] for row in report["domains"]}, {"Général", "Finance"})

    def test_old_database_gets_safe_metric_columns_and_domain_backfill(self):
        handle, legacy_path = tempfile.mkstemp(suffix=".sqlite3")
        os.close(handle)
        original_path = flaskgpt.DATABASE_PATH
        try:
            connection = sqlite3.connect(legacy_path)
            connection.executescript("""
                CREATE TABLE conversations (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, domain TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE request_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
                    response_time_ms REAL NOT NULL, prompt_tokens INTEGER, completion_tokens INTEGER,
                    total_tokens INTEGER, status TEXT NOT NULL, created_at TEXT NOT NULL
                );
                INSERT INTO conversations VALUES ('legacy', 'Legacy', 'Finance', '2024-01-01', '2024-01-01');
                INSERT INTO request_metrics (conversation_id, response_time_ms, status, created_at)
                VALUES ('legacy', 125, 'complete', '2024-01-01');
            """)
            connection.commit()
            connection.close()
            flaskgpt.DATABASE_PATH = legacy_path
            flaskgpt.init_db()
            with flaskgpt.database_connection() as migrated:
                metric = migrated.execute(
                    "SELECT domain, custom_domain, error_type, error_code FROM request_metrics"
                ).fetchone()
            self.assertEqual(metric["domain"], "Finance")
            self.assertEqual(metric["custom_domain"], "")
            self.assertIsNone(metric["error_type"])
        finally:
            flaskgpt.DATABASE_PATH = original_path
            os.remove(legacy_path)

    def test_exports_are_available_for_saved_conversations(self):
        conversation = self.create_conversation()
        message_content = "caf\u00e9"
        with flaskgpt.database_connection() as connection:
            connection.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                (conversation["id"], message_content, flaskgpt.current_timestamp()),
            )
        for extension, mime in (("txt", "text/plain"), ("json", "application/json"), ("pdf", "application/pdf")):
            with self.subTest(extension=extension):
                response = self.client.get(
                    f"/api/conversations/{conversation['id']}/export/{extension}"
                )
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.mimetype.startswith(mime))
                if extension == "txt":
                    self.assertIn(message_content, response.get_data(as_text=True))
                elif extension == "json":
                    self.assertEqual(response.get_json()["messages"][0]["content"], message_content)
                else:
                    pdf = response.get_data()
                    self.assertTrue(pdf.startswith(b"%PDF-"))
                    reader = PdfReader(io.BytesIO(pdf))
                    self.assertEqual(len(reader.pages), 1)
                    self.assertIn(message_content, reader.pages[0].extract_text())
        unsupported = self.client.get(
            f"/api/conversations/{conversation['id']}/export/xml"
        )
        self.assertEqual(unsupported.status_code, 400)


    def test_every_supported_domain_is_persisted(self):
        for domain in flaskgpt.DOMAIN_INSTRUCTIONS:
            with self.subTest(domain=domain):
                conversation = self.create_conversation(
                    domain, "Domaine de test" if domain == "Autre" else ""
                )
                opened = self.client.get(
                    f"/api/conversations/{conversation['id']}"
                ).get_json()
                self.assertEqual(opened["domain"], domain)

    def test_creating_a_new_conversation_keeps_existing_history(self):
        first = self.create_conversation()
        with flaskgpt.database_connection() as connection:
            connection.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                (first["id"], "Old question", flaskgpt.current_timestamp()),
            )
        second = self.create_conversation("Finance")
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len(self.client.get("/api/conversations").get_json()), 2)
        history = self.client.get(f"/api/conversations/{first['id']}").get_json()
        self.assertEqual(history["messages"][0]["content"], "Old question")

    def test_database_transaction_rolls_back_constraint_errors(self):
        conversation = self.create_conversation()
        with self.assertRaises(sqlite3.IntegrityError):
            with flaskgpt.database_connection() as connection:
                connection.execute(
                    "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                    (conversation["id"], "temporary", flaskgpt.current_timestamp()),
                )
                connection.execute(
                    "INSERT INTO request_metrics (conversation_id, response_time_ms, status, created_at) VALUES (?, 10, 'unknown', ?)",
                    (conversation["id"], flaskgpt.current_timestamp()),
                )
        opened = self.client.get(f"/api/conversations/{conversation['id']}").get_json()
        self.assertEqual(opened["messages"], [])

    def test_frontend_keeps_the_api_key_server_side_and_sanitizes_markdown(self):
        javascript = Path("static/dist/js/script.js").read_text(encoding="utf-8")
        server = Path("app.py").read_text(encoding="utf-8")
        ignore_rules = Path(".gitignore").read_text(encoding="utf-8")
        self.assertIn('os.getenv("GROQ_API_KEY")', server)
        self.assertNotIn("GROQ_API_KEY", javascript)
        self.assertIn(".env", ignore_rules)
        self.assertIn("DOMPurify.sanitize", javascript)

    def test_invalid_source_uploads_are_rejected_without_saving_records(self):
        cases = [(b"not a document", "payload.exe", 415), (b"", "empty.txt", 400),
                 (b"not a PDF", "broken.pdf", 400)]
        for content, name, status in cases:
            with self.subTest(name=name):
                response = self.client.post(
                    "/api/sources",
                    data={"source": (io.BytesIO(content), name)},
                    content_type="multipart/form-data",
                )
                self.assertEqual(response.status_code, status)
        oversized = self.client.post(
            "/api/sources",
            data={"source": (io.BytesIO(b"x" * (10 * 1024 * 1024 + 1)), "large.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(oversized.status_code, 413)
        oversized.request.environ["wsgi.input"].close()
        oversized.close()
        self.assertEqual(self.client.get("/api/sources").get_json(), [])

    def test_csv_rejections_do_not_create_quality_reports(self):
        for content, name, status in (
            (b"", "empty.csv", 400),
            (b"data", "dataset.xlsx", 415),
            (b"not a sqlite database", "corrupt.sqlite", 400),
        ):
            with self.subTest(name=name):
                response = self.client.post(
                    "/api/data-quality/analyze",
                    data={"dataset": (io.BytesIO(content), name)},
                    content_type="multipart/form-data",
                )
                self.assertEqual(response.status_code, status)
        oversized = self.client.post(
            "/api/data-quality/analyze",
            data={"dataset": (io.BytesIO(b"x" * (20 * 1024 * 1024 + 1)), "large.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(oversized.status_code, 413)
        oversized.request.environ["wsgi.input"].close()
        oversized.close()
        self.assertEqual(self.client.get("/api/data-quality/recent").get_json(), [])

    def test_sqlite_dataset_upload_is_read_only_and_requires_table_selection(self):
        handle, path = tempfile.mkstemp(suffix=".sqlite")
        os.close(handle)
        try:
            connection = sqlite3.connect(path)
            connection.execute("CREATE TABLE metrics (name TEXT, amount INTEGER)")
            connection.executemany(
                "INSERT INTO metrics VALUES (?, ?)", [("A", 3), ("A", 3), ("B", None)]
            )
            connection.commit()
            connection.close()
            with open(path, "rb") as source_file:
                payload = source_file.read()
            chooser = self.client.post(
                "/api/data-quality/analyze",
                data={"dataset": (io.BytesIO(payload), "source.sqlite")},
                content_type="multipart/form-data",
            )
            self.assertEqual(chooser.status_code, 200)
            self.assertEqual(chooser.get_json()["tables"], ["metrics"])
            analysed = self.client.post(
                "/api/data-quality/analyze",
                data={"dataset": (io.BytesIO(payload), "source.sqlite"), "table": "metrics"},
                content_type="multipart/form-data",
            )
            self.assertEqual(analysed.status_code, 200)
            self.assertEqual(analysed.get_json()["rows"], 3)
            self.assertEqual(analysed.get_json()["missing_cells"], 1)
            connection = sqlite3.connect(path)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM metrics").fetchone()[0], 3)
            connection.close()
        finally:
            os.remove(path)

    def test_groq_auth_quota_timeout_and_connection_errors_are_safe(self):
        api_request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
        scenarios = [
            (AuthenticationError(
                "private token must not leak", response=httpx.Response(401, request=api_request),
                body={"api_key": "private-token"},
            ), 401, "AuthenticationError"),
            (RateLimitError(
                "private account details", response=httpx.Response(429, request=api_request),
                body={"internal": "private"},
            ), 429, "RateLimitError"),
            (APITimeoutError(request=api_request), 504, "APITimeoutError"),
            (APIConnectionError(message="api_key=private-token", request=api_request), 503,
             "APIConnectionError"),
        ]
        for provider_error, expected_status, expected_type in scenarios:
            with self.subTest(error=expected_type):
                conversation = self.create_conversation("Finance")

                class FakeCompletions:
                    def create(self, **kwargs):
                        raise provider_error

                flaskgpt.client = SimpleNamespace(
                    chat=SimpleNamespace(completions=FakeCompletions())
                )
                response = self.client.post("/prompt", json={
                    "conversation_id": conversation["id"],
                    "messages": ["Question de test"],
                    "domain": "Finance",
                })
                self.assertEqual(response.status_code, expected_status)
                body = response.get_data(as_text=True)
                self.assertNotIn("private-token", body)
                self.assertNotIn("private account details", body)
                recent = self.client.get("/api/performance").get_json()["recent_requests"][0]
                self.assertEqual(recent["status"], "error")
                self.assertEqual(recent["error_type"], expected_type)

    def test_empty_and_invalid_prompt_payloads_are_rejected(self):
        conversation = self.create_conversation()
        empty = self.client.post("/prompt", json={
            "conversation_id": conversation["id"], "messages": [],
        })
        self.assertEqual(empty.status_code, 400)
        wrong_content_type = self.client.post("/prompt", data="not json")
        self.assertEqual(wrong_content_type.status_code, 415)
        self.assertEqual(self.client.get("/api/performance").get_json()["overall"]["requests"], 0)

    def test_stream_timeout_after_partial_text_is_recorded_as_partial(self):
        conversation = self.create_conversation("Finance")
        api_request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")

        def chunks():
            yield SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content="Partie recue"))],
                usage=None,
            )
            raise APITimeoutError(request=api_request)

        class FakeCompletions:
            def create(self, **kwargs):
                return chunks()

        flaskgpt.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
        response = self.client.post("/prompt", json={
            "conversation_id": conversation["id"], "messages": ["Question"], "domain": "Finance",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("trop de temps", response.get_data(as_text=True))
        recent = self.client.get("/api/performance").get_json()["recent_requests"][0]
        self.assertEqual(recent["status"], "partial")
        self.assertEqual(recent["error_type"], "APITimeoutError")

if __name__ == "__main__":
    unittest.main()
