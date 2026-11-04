"""Loopback-only HTML UI for the existing pseudonymization workflow."""
import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, HTTPServer
from importlib.resources import files
import logging
from pathlib import Path
import secrets
import shutil
import tempfile
from types import SimpleNamespace

from .cli import ToolError, approve, digest, dump, export, load_json, prepare, private_write
from .detection import Detector

WEB_ASSETS = {'/favicon.png': 'image/png', '/app.js': 'text/javascript; charset=utf-8', '/style.css': 'text/css; charset=utf-8', '/fonts/montserrat-cyrillic-ext.woff2': 'font/woff2', '/fonts/montserrat-cyrillic.woff2': 'font/woff2', '/fonts/montserrat-vietnamese.woff2': 'font/woff2', '/fonts/montserrat-latin-ext.woff2': 'font/woff2', '/fonts/montserrat-latin.woff2': 'font/woff2'}

MAX_BODY = 2 * 1024 * 1024

# Translate CLI errors at the UI boundary; the CLI remains English.
UI_ERRORS = {'Duplicate JSON key.': 'Doppelter JSON-Schlüssel. Bitte eindeutige Schlüssel verwenden.',
 'Invalid JSON constant.': 'Ungültiger JSON-Wert. Bitte gültiges JSON verwenden.',
 'Invalid configuration.': 'Ungültige Konfiguration. Erwartet wird ein Objekt mit „identifier_fields“.',
 'Invalid JSON Pointer.': 'Ungültiger JSON-Pointer in der Konfiguration.',
 'Invalid identifier type.': 'Ungültiger Kennnummerntyp. Bitte Großbuchstaben und Unterstriche verwenden.',
 'Configured identifier must be a string or number.': 'Das konfigurierte Kennnummernfeld muss Text oder eine '
                                                      'Zahl enthalten.',
 'JSON key contains a detected identifier; rename keys locally before retrying.': 'Ein JSON-Schlüssel '
                                                                                  'enthält eine erkannte '
                                                                                  'personenbezogene Angabe. '
                                                                                  'Bitte den Schlüssel lokal '
                                                                                  'umbenennen und erneut '
                                                                                  'versuchen.',
 'Configured identifier pointer was not found.': 'Ein konfiguriertes Kennnummernfeld wurde nicht gefunden. '
                                                 'Bitte die JSON-Pointer prüfen.',
 'Workspace already exists.': 'Der Arbeitsordner existiert bereits. Bitte eine neue Sitzung beginnen.',
 'Identifier fields require JSON input.': 'Die Konfiguration von Kennnummernfeldern erfordert das Format '
                                          'JSON.',
 'Workspace must be a private directory, not a symbolic link.': 'Der Arbeitsordner muss ein privates '
                                                                'Verzeichnis ohne symbolische Verknüpfung '
                                                                'sein.',
 'Invalid workspace format.': 'Ungültiges Format im Arbeitsordner. Bitte eine neue Sitzung beginnen.',
 'Workspace files must be private regular files without links.': 'Sitzungsdateien fehlen oder haben '
                                                                 'unzulässige Berechtigungen. Bitte den '
                                                                 'Entwurf erneut prüfen und freigeben.',
 'Draft must be reviewed and approved again.': 'Der Entwurf muss erneut geprüft und freigegeben werden.',
 'Export destination must be outside the workspace.': 'Das Ausgabeziel muss außerhalb des Arbeitsordners '
                                                      'liegen.',
 'Export cannot overwrite input.': 'Die Ausgabe darf den Originaltext nicht überschreiben.',
 'Bitte einen Text oder eine JSON-Anfrage eingeben.': 'Bitte einen Text oder eine JSON-Anfrage eingeben.',
 'Die Anfrage ist nicht mehr aktiv. Bitte neu vorbereiten.': 'Die Anfrage ist nicht mehr aktiv. Bitte neu '
                                                             'vorbereiten.',
 'Bitte die vollständige Fassung prüfen und die Prüfung bestätigen.': 'Bitte die vollständige Fassung prüfen '
                                                                      'und die Prüfung bestätigen.',
 'Die Fassung wurde geändert. Bitte erneut prüfen und freigeben.': 'Die Fassung wurde geändert. Bitte erneut '
                                                                   'prüfen und freigeben.'}


class App:
    def __init__(self, root, detector_factory=Detector):
        self.root = Path(root)
        self.token = secrets.token_urlsafe(32)
        self.detector_factory = detector_factory
        self.detector = None
        self.active = None

    def clear(self):
        if self.active:
            shutil.rmtree(self.root / self.active)
            self.active = None

    def create(self, payload):
        if payload.get('format') not in {'text', 'json'} or not isinstance(payload.get('source'), str) or not payload['source'].strip():
            raise ToolError('Bitte einen Text oder eine JSON-Anfrage eingeben.')
        case = secrets.token_hex(16)
        directory = self.root / case
        directory.mkdir(mode=0o700)
        try:
            source = directory / 'input'
            private_write(source, payload['source'])
            config = None
            if payload.get('config', '').strip():
                config = directory / 'config.json'
                private_write(config, payload['config'])
            if self.detector is None:
                self.detector = self.detector_factory()
            prepare(SimpleNamespace(input=str(source), format=payload['format'], workspace=str(directory / 'review'), config=config), lambda: self.detector)
            workspace = directory / 'review'
            report = load_json((workspace / 'report.json').read_text())
            draft = (workspace / ('draft.json' if payload['format'] == 'json' else 'draft.txt')).read_text()
        except Exception:
            shutil.rmtree(directory)
            raise
        self.clear()
        self.active = case
        return {'case': case, 'draft': draft, 'counts': report['counts'], 'format': payload['format']}

    def workspace(self, payload):
        if not self.active or payload.get('case') != self.active:
            raise ToolError('Die Anfrage ist nicht mehr aktiv. Bitte neu vorbereiten.')
        return self.root / self.active / 'review'

    def confirm(self, payload):
        workspace = self.workspace(payload)
        if payload.get('reviewed') is not True or not isinstance(payload.get('draft'), str) or not payload['draft'].strip():
            raise ToolError('Bitte die vollständige Fassung prüfen und die Prüfung bestätigen.')
        state = load_json((workspace / 'state.json').read_text())
        if state['format'] == 'json':
            load_json(payload['draft'])
        draft = workspace / ('draft.json' if state['format'] == 'json' else 'draft.txt')
        draft.write_text(payload['draft'], encoding='utf-8')
        approve(SimpleNamespace(workspace=str(workspace)))
        return {'approved': True, 'hash': digest(payload['draft'].encode())}

    def download(self, payload):
        workspace = self.workspace(payload)
        state = load_json((workspace / 'state.json').read_text())
        draft = workspace / ('draft.json' if state['format'] == 'json' else 'draft.txt')
        if not isinstance(payload.get('draft'), str) or draft.read_bytes() != payload['draft'].encode():
            raise ToolError('Die Fassung wurde geändert. Bitte erneut prüfen und freigeben.')
        target = workspace.parent / ('export-' + secrets.token_hex(8))
        try:
            export(SimpleNamespace(workspace=str(workspace), output=str(target)))
            return target.read_bytes(), state['format']
        finally:
            target.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, app, **kwargs):
        self.app = app
        super().__init__(*args, **kwargs)

    def log_message(self, *_):
        pass  # Paths, content and exception details never enter HTTP logs.

    @property
    def origin(self):
        return 'http://127.0.0.1:' + str(self.server.server_port)

    def respond(self, code, body, kind='application/json; charset=utf-8', extra=None):
        data = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(code)
        for key, value in {
            'Content-Type': kind, 'Content-Length': str(len(data)), 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
            'Cross-Origin-Resource-Policy': 'same-origin',
            **(extra or {}),
        }.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def valid_host(self):
        return self.headers.get('Host') == self.origin.removeprefix('http://')

    def authorized(self):
        return self.headers.get('Cookie', '') == 'vcare_session=' + self.app.token

    def do_GET(self):
        if not self.valid_host() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.respond(403, '{}')
        if self.path == '/':
            return self.respond(200, files('vcare_pseudonymizer').joinpath('web/index.html').read_bytes(), 'text/html; charset=utf-8',
                                {'Set-Cookie': 'vcare_session=' + self.app.token + '; HttpOnly; SameSite=Strict; Path=/'})
        if self.authorized() and self.path in WEB_ASSETS:
            name = self.path[1:]
            kind = WEB_ASSETS[self.path]
            return self.respond(200, files('vcare_pseudonymizer').joinpath('web/' + name).read_bytes(), kind)
        return self.respond(404, '{}')

    def do_POST(self):
        if not self.valid_host() or not self.authorized() or self.headers.get('Origin') != self.origin or self.headers.get('X-Vcare-Request') != '1':
            return self.respond(403, '{}')
        if self.headers.get('Content-Type') != 'application/json':
            return self.respond(415, dump({'error': 'JSON erforderlich.'}))
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                return self.respond(413, dump({'error': 'Anfrage zu groß (maximal 2 MB).'}))
            payload = load_json(self.rfile.read(length).decode('utf-8'))
            if not isinstance(payload, dict):
                raise ValueError()
            if self.path == '/api/prepare':
                result = self.app.create(payload)
            elif self.path == '/api/approve':
                result = self.app.confirm(payload)
            elif self.path == '/api/export':
                data, format_ = self.app.download(payload)
                return self.respond(200, data, 'application/json' if format_ == 'json' else 'text/plain; charset=utf-8',
                                    {'Content-Disposition': 'attachment; filename="vcare-anfrage.' + ('json' if format_ == 'json' else 'txt') + '"'})
            elif self.path == '/api/clear':
                self.app.clear()
                result = {'cleared': True}
            else:
                return self.respond(404, '{}')
            self.respond(200, dump(result))
        except ToolError as error:
            self.respond(400, dump({'error': UI_ERRORS.get(str(error), 'Verarbeitung fehlgeschlagen. Bitte Eingabe und Konfiguration prüfen.')}))
        except (ImportError, RuntimeError):
            self.respond(503, dump({'error': 'Lokales Sprachmodell nicht verfügbar. Bitte Python-Abhängigkeiten und de_core_news_lg gemäß README installieren.'}))
        except Exception:
            self.respond(400, dump({'error': 'Verarbeitung fehlgeschlagen. Bitte Format, Konfiguration und lokale Installation prüfen.'}))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Vcare: lokale HTML-Oberfläche')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    with tempfile.TemporaryDirectory(prefix='vcare-ui-') as directory:
        Path(directory).chmod(0o700)
        app = App(directory)
        try:
            with HTTPServer(('127.0.0.1', args.port), partial(Handler, app=app)) as server:
                print(f'Vcare öffnen: http://127.0.0.1:{server.server_port}', flush=True)
                print('Beenden mit Ctrl+C. Lokale Sitzungsdateien werden beim Beenden gelöscht.')
                server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
