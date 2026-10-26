import ast
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

import app as flaskgpt
from audit_fixtures import CASES, PYTHON_BLOCKS


class GenerationAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.old_path, self.old_client = flaskgpt.DATABASE_PATH, flaskgpt.client
        flaskgpt.DATABASE_PATH = str(Path(self.directory.name) / 'test.sqlite3')
        flaskgpt.app.config['TESTING'] = True
        self.client = flaskgpt.app.test_client()
        self.conversation = self.client.post('/api/conversations', json={'title': 'Audit', 'domain': 'Général'}).get_json()

    def tearDown(self):
        flaskgpt.DATABASE_PATH, flaskgpt.client = self.old_path, self.old_client
        self.directory.cleanup()

    def generate(self, text, finish='stop', fail=False):
        def create(**kwargs):
            self.provider_request = kwargs
            def chunks():
                for offset in range(0, len(text), 11):
                    yield NS(choices=[NS(delta=NS(content=text[offset:offset + 11]), finish_reason=None)], usage=None)
                if fail:
                    raise RuntimeError('private provider error')
                if finish is not None:
                    yield NS(choices=[NS(delta=NS(content=None), finish_reason=finish)], usage=None)
            return chunks()
        flaskgpt.client = NS(chat=NS(completions=NS(create=create)))
        response = self.client.post('/prompt', headers={'Accept': 'text/event-stream'}, json={
            'conversation_id': self.conversation['id'], 'messages': ['Question de test'], 'domain': 'Général',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'text/event-stream')
        events = [json.loads(frame[6:]) for frame in response.get_data(as_text=True).strip().split('\n\n')]
        raw = ''.join(event['text'] for event in events if event['type'] == 'delta')
        self.assertEqual(raw, text)
        self.assertEqual(events[-1]['type'], 'done')
        saved = self.client.get(f"/api/conversations/{self.conversation['id']}").get_json()['messages'][-1]
        self.assertEqual(saved['content'], text)
        self.assertEqual(saved['generation'], events[-1]['generation'])
        self.assertEqual(saved['id'], events[-1]['message_id'])
        return saved

    def test_five_python_blocks_long_answer_roundtrip_and_quality_instructions(self):
        saved = self.generate(CASES['AUDIT_FIVE'])
        self.assertGreater(len(saved['content'].split()), 2000)
        self.assertEqual(saved['content'].count('```python'), 5)
        self.assertEqual(saved['generation']['status'], 'complete')
        self.assertNotIn('Copier', saved['content'])
        self.assertEqual(self.provider_request['max_completion_tokens'], flaskgpt.MAX_COMPLETION_TOKENS)
        system = self.provider_request['messages'][0]['content']
        self.assertIn(flaskgpt.TECHNICAL_QUALITY_INSTRUCTIONS, system)
        self.assertIn(flaskgpt.DOMAIN_INSTRUCTIONS['Général'], system)
        for code in PYTHON_BLOCKS:
            ast.parse(code)

    def test_truncation_mid_table_is_partial_and_source_untouched(self):
        saved = self.generate(CASES['AUDIT_TABLE_LIMIT'], finish='length')
        self.assertEqual(saved['generation']['status'], 'partial')
        self.assertEqual(saved['generation']['reason'], 'token_limit')
        self.assertTrue(saved['generation']['can_continue'])
        metrics = self.client.get('/api/performance').get_json()['overall']
        self.assertEqual(metrics['completed_requests'], 0)
        self.assertEqual(metrics['partial_requests'], 1)

    def test_interruption_during_code_has_no_injected_error_in_source(self):
        saved = self.generate(CASES['AUDIT_CODE_BREAK'], fail=True)
        self.assertEqual(saved['generation']['reason'], 'interrupted')
        self.assertTrue(saved['generation']['can_continue'])
        self.assertNotIn('private provider error', saved['generation']['message'])

    def test_eof_without_finish_signal_is_not_success(self):
        saved = self.generate(CASES['AUDIT_NO_FINISH'], finish=None)
        self.assertEqual(saved['generation']['status'], 'partial')
        self.assertEqual(saved['generation']['reason'], 'missing_finish')

    def test_content_filter_is_explicit_without_continuation(self):
        saved = self.generate('Texte partiel', finish='content_filter')
        self.assertEqual(saved['generation']['status'], 'partial')
        self.assertFalse(saved['generation']['can_continue'])

    def test_python_check_reports_syntax_only_and_never_executes(self):
        marker = Path(self.directory.name) / 'must-not-exist'
        source = f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\n"
        valid = self.client.post('/api/code/validate-python', json={'code': source}).get_json()
        self.assertEqual(valid['status'], 'valid')
        self.assertFalse(valid['executed'])
        self.assertFalse(marker.exists())
        invalid = self.client.post('/api/code/validate-python', json={'code': 'for x in range(3)\n    print(x)'}).get_json()
        self.assertEqual(invalid['status'], 'invalid')
        self.assertEqual(invalid['line'], 1)
        self.assertEqual(invalid['scope'], 'syntax_only')
        self.assertEqual(self.client.post('/api/code/validate-python', json={'code': 'x' * 100001}).status_code, 400)

    def test_literal_copy_label_in_model_source_is_not_removed(self):
        saved = self.generate('Le texte cité est `Python**Copier**`.\n\n```python\ns = "Copier"\n```')
        self.assertIn('Python**Copier**', saved['content'])

    def test_legacy_messages_are_not_retroactively_claimed_complete(self):
        flaskgpt.save_assistant_message(self.conversation['id'], 'Ancienne réponse')
        saved = self.client.get(f"/api/conversations/{self.conversation['id']}").get_json()['messages'][-1]
        self.assertEqual(saved['generation'], {})

    def test_disconnected_browser_saves_partial_without_ui_text(self):
        response = iter([NS(choices=[NS(delta=NS(content='Partiel'), finish_reason=None)], usage=None)])
        stream = flaskgpt.event_stream(response, self.conversation['id'], structured=True)
        self.assertIn('"type": "delta"', next(stream))
        stream.close()
        saved = self.client.get(f"/api/conversations/{self.conversation['id']}").get_json()['messages'][-1]
        self.assertEqual(saved['content'], 'Partiel')
        self.assertEqual(saved['generation']['status'], 'partial')
