import http.client
from http.server import HTTPServer
from functools import partial
from pathlib import Path
import json
import tempfile
import threading
import unittest
from vcare_pseudonymizer.server import App, Handler
from vcare_pseudonymizer.detection import resolve, rule_spans


class RulesDetector:
    version = {'test': 'rules'}
    def detect(self, text):
        return resolve(rule_spans(text))


class UITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = App(self.temp.name, RulesDetector)

    def test_review_export_clear(self):
        result = self.app.create({'source': 'a@example.org hat Asthma.', 'format': 'text'})
        payload = {'case': result['case'], 'draft': result['draft'], 'reviewed': True}
        self.assertEqual(result['draft'], '[E_MAIL_1] hat Asthma.')
        with self.assertRaises(ValueError):
            self.app.download(payload)
        self.app.confirm(payload)
        exported, format_ = self.app.download(payload)
        self.assertEqual(exported.decode(), result['draft'])
        self.assertNotIn(b'a@example.org', exported)
        with self.assertRaises(ValueError):
            self.app.download({**payload, 'draft': 'changed'})
        self.app.clear()
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_json_and_failed_prepare_retains_active(self):
        result = self.app.create({'source': '{"id":123,"dose":5}', 'format':'json', 'config':'{"identifier_fields":{"/id":"ID"}}'})
        self.assertEqual(json.loads(result['draft']), {'id':'[ID_1]', 'dose':5})
        with self.assertRaises(ValueError):
            self.app.create({'source': '{invalid', 'format':'json'})
        self.assertEqual(self.app.active, result['case'])
        self.assertEqual(len(list(Path(self.temp.name).iterdir())), 1)

    def test_http_guards_and_assets(self):
        server = HTTPServer(('127.0.0.1', 0), partial(Handler, app=self.app))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        origin = 'http://127.0.0.1:' + str(server.server_port)
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
        self.addCleanup(connection.close)
        connection.request('GET', '/')
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertIn('no-store', response.getheader('Cache-Control'))
        cookie = response.getheader('Set-Cookie').split(';')[0]
        self.assertIn(b'Vcare', response.read())
        connection.request('POST', '/api/clear', '{}', {'Content-Type':'application/json'})
        response = connection.getresponse(); self.assertEqual(response.status, 403); response.read()
        headers = {'Content-Type':'application/json','Origin':origin,'Cookie':cookie,'X-Vcare-Request':'1'}
        connection.request('POST', '/api/prepare', json.dumps({'source':'a@example.org','format':'text'}), headers)
        response = connection.getresponse(); self.assertEqual(response.status, 200)
        result = json.loads(response.read())
        payload = {'case': result['case'], 'draft': result['draft'], 'reviewed': True}
        connection.request('POST', '/api/export', json.dumps(payload), headers)
        response = connection.getresponse(); self.assertEqual(response.status, 400); response.read()
        connection.request('POST', '/api/approve', json.dumps(payload), headers)
        response = connection.getresponse(); self.assertEqual(response.status, 200); response.read()
        connection.request('POST', '/api/export', json.dumps(payload), headers)
        response = connection.getresponse(); self.assertEqual(response.status, 200)
        self.assertIn('attachment', response.getheader('Content-Disposition'))
        self.assertEqual(response.read(), b'[E_MAIL_1]')
        headers['Origin'] = 'https://external.example'
        connection.request('POST', '/api/clear', '{}', headers)
        response = connection.getresponse(); self.assertEqual(response.status, 403); response.read()
        headers['Origin'] = origin; headers['Host'] = 'external.example'
        connection.request('POST', '/api/clear', '{}', headers)
        response = connection.getresponse(); self.assertEqual(response.status, 403); response.read()
        headers.pop('Host')
        for path in ['/app.js','/style.css','/favicon.png','/fonts/montserrat-latin.woff2']:
            connection.request('GET', path, headers={'Cookie':cookie})
            response = connection.getresponse(); self.assertEqual(response.status, 200)
            asset = response.read()
            if path == '/favicon.png':
                self.assertEqual(response.getheader('Content-Type'), 'image/png')
                self.assertTrue(asset.startswith(b'\x89PNG\r\n\x1a\n'))
            if path.endswith('.woff2'):
                self.assertEqual(response.getheader('Content-Type'), 'font/woff2')
                self.assertTrue(asset.startswith(b'wOF2'))
        connection.request('POST', '/api/prepare', '{"source":"SECRET",', headers)
        response = connection.getresponse(); self.assertEqual(response.status, 400); self.assertNotIn(b'SECRET', response.read())

        connection.request('POST', '/api/prepare', json.dumps({'source':'{"id":1,"id":2}', 'format':'json'}), headers)
        response = connection.getresponse(); self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(response.read())['error'], 'Doppelter JSON-Schlüssel. Bitte eindeutige Schlüssel verwenden.')
        connection.request('POST', '/api/prepare', json.dumps({'source':'{"id":1}', 'format':'json', 'config':'{"identifier_fields":{"/missing":"ID"}}'}), headers)
        response = connection.getresponse(); self.assertEqual(response.status, 400)
        self.assertIn('Kennnummernfeld wurde nicht gefunden', json.loads(response.read())['error'])
