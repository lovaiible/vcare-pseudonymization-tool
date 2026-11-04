import argparse
from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from vcare_pseudonymizer.cli import prepare, approve, export, transform, main
from vcare_pseudonymizer.detection import Span, rule_spans, resolve


class RulesDetector:
    version = {'test': 'rules-only'}
    def detect(self, text):
        return resolve(rule_spans(text))


class DetectionTests(unittest.TestCase):
    def test_annotated_rules(self):
        # Synthetic exact-span annotations: intentionally separate from NER evaluation.
        cases = [
            ('Frau Jutta Müller hat Asthma.', 'Jutta Müller', 'PERSON'),
            ('Mail: jutta@example.org', 'jutta@example.org', 'EMAIL'),
            ('Telefon +49 30 12345678.', '+49 30 12345678', 'PHONE'),
            ('Geboren 12.03.1980.', '12.03.1980', 'DATE'),
            ('Termin 2026-10-23.', '2026-10-23', 'DATE'),
            ('Termin 3. März 2025.', '3. März 2025', 'DATE'),
            ('Sie ist 46 Jahre alt.', '46 Jahre alt', 'AGE'),
            ('Musterstraße 12, 12345 Berlin', 'Musterstraße 12, 12345 Berlin', 'ADDRESS'),
            ('Wohnort 12345 Berlin', '12345 Berlin', 'LOCATION'),
            ('IBAN DE89 3704 0044 0532 0130 00', 'DE89 3704 0044 0532 0130 00', 'IBAN'),
            ('Patienten-ID: AB-123', 'AB-123', 'IDENTIFIER'),
            ('Versichertennummer: A123456789', 'A123456789', 'IDENTIFIER'),
            ('Aktenzeichen: VC/123', 'VC/123', 'IDENTIFIER'),
        ]
        hits = 0
        for text, original, kind in cases:
            with self.subTest(kind=kind):
                detected = RulesDetector().detect(text)
                matched = any(text[s.start:s.end] == original and s.kind == kind for s in detected)
                hits += matched
                self.assertTrue(matched)
        self.assertEqual(hits, len(cases))

    def test_email_signature_names(self):
        for closing, separator, name in [
            ('Best regards', ' ', 'Jutta Müller'),
            ('Kind regards,', '\n', 'Jutta Müller'),
            ('Best regards,', '\n\n', 'Dr. Jutta Müller'),
            ('Mit freundlichen Grüßen', '\r\n', 'Jutta Müller'),
            ('mit freundlichen Gruessen', '\n', 'Jutta Müller'),
            ('Viele Grüße', '\n', 'Anna-Lena von der Heide'),
            ('Liebe Grüße,', '\n', 'J. Müller'),
            ('Herzliche Grüße', '\n', 'Élodie O’Connor'),
            ('Best wishes', '\n', 'Nguyễn Thị Hồng'),
        ]:
            with self.subTest(closing=closing, name=name):
                text = 'Asthma, Salbutamol 100 µg.\n\n' + closing + separator + name
                result, entries, _ = transform(text, RulesDetector(), {})
                self.assertEqual(result, 'Asthma, Salbutamol 100 µg.\n\n' + closing + separator + '[PERSON_1]')
                self.assertEqual(entries[0]['original'], name)
                self.assertEqual(entries[0]['type'], 'PERSON')

    def test_signature_boundaries_and_repeated_names(self):
        for text in ['Best regards', 'Best regards\n', 'Best regards\nIch habe Asthma',
                     'Wir besprechen Best regards Jutta Müller morgen.', 'Best regards\nDr.']:
            with self.subTest(text=text):
                result, _, _ = transform(text, RulesDetector(), {})
                self.assertEqual(result, text)
        text = 'Best regards\nJutta Müller\nTelefon: +49 30 12345678\n\nViele Grüße\nJutta Müller'
        result, entries, _ = transform(text, RulesDetector(), {})
        self.assertEqual(result.count('[PERSON_1]'), 2)
        self.assertIn('Telefon: [TELEFON_1]', result)
        person = next(entry for entry in entries if entry['type'] == 'PERSON')
        self.assertEqual(len(person['occurrences']), 2)

    def test_postal_code_layouts(self):
        for value, code in [
            ('Wohnort 10115 Berlin', '10115'),
            ('Wohnort Berlin 10115', '10115'),
            ('Wohnort Berlin (10115)', '10115'),
            ('Wohnort Berlin, 10115.', '10115'),
            ('Wohnort Berlin,10115.', '10115'),
            ('Wohnort berlin 10115', '10115'),
            ('PLZ: 10115', '10115'),
            ('Wohnort 01067 Dresden', '01067'),
            ('D-01067 Dresden', '01067'),
            ('10115', '10115'),
        ]:
            with self.subTest(value=value):
                result, _, _ = transform(value, RulesDetector(), {})
                self.assertNotIn(code, result)
                self.assertTrue('[PLZ_' in result or '[ORT_' in result)

    def test_postal_code_repetition_and_number_boundaries(self):
        result, entries, _ = transform('PLZ: 01067; erneut: 01067', RulesDetector(), {})
        self.assertEqual(result, 'PLZ: [PLZ_1]; erneut: [PLZ_1]')
        self.assertEqual(entries[0]['original'], '01067')
        self.assertEqual(len(entries[0]['occurrences']), 2)
        for value in ['Kennung A10115B', 'Nummer 123456789', 'Messwert 0.12345 mg', 'Messwert 12345,67 mg']:
            with self.subTest(value=value):
                self.assertFalse(any(s.kind == 'POSTAL_CODE' for s in rule_spans(value)))

    def test_german_tokens_and_shared_label_numbering(self):
        # Distinct internal types can share a German label without token collisions.
        value = {str(i): str(i) for i in range(14)}
        kinds = ['PERSON', 'EMAIL', 'PHONE', 'LOCATION', 'ORGANIZATION',
                 'DATE', 'AGE', 'ADDRESS', 'IDENTIFIER', 'IBAN', 'PATIENT_ID',
                 'INSURANCE_ID', 'ORT', 'CUSTOM']
        fields = {'/' + str(i): kind for i, kind in enumerate(kinds)}
        result, entries, _ = transform(value, RulesDetector(), fields)
        self.assertEqual(list(result.values()), [
            '[PERSON_1]', '[E_MAIL_1]', '[TELEFON_1]', '[ORT_1]', '[EINRICHTUNG_1]',
            '[DATUM_1]', '[ALTER_1]', '[ADRESSE_1]', '[KENNNUMMER_1]', '[IBAN_1]',
            '[PATIENTENNUMMER_1]', '[VERSICHERTENNUMMER_1]', '[ORT_2]', '[CUSTOM_1]'])
        self.assertEqual([entry['type'] for entry in entries], kinds)

    def test_overlap(self):
        self.assertEqual(resolve([Span(0, 8, 'ADDRESS'), Span(0, 4, 'PERSON', 0)]), [Span(0, 8, 'ADDRESS')])
        self.assertEqual(resolve([Span(0, 4, 'PERSON', 2), Span(0, 4, 'LOCATION', 1)]), [Span(0, 4, 'LOCATION', 1)])

    def test_repeat_and_clinical_preservation(self):
        value = 'jutta@example.org: Asthma, Salbutamol 100 µg. jutta@example.org'
        result, mapping, _ = transform(value, RulesDetector(), {})
        self.assertEqual(result.count('[E_MAIL_1]'), 2)
        self.assertIn('Asthma, Salbutamol 100 µg.', result)
        self.assertEqual(len(mapping), 1)
        self.assertEqual(len(mapping[0]['occurrences']), 2)
        self.assertEqual(transform(value, RulesDetector(), {})[0], result)

    def test_json(self):
        result, entries, _ = transform({'patient': {'id': 123}, 'items': ['a@example.org'], 'dose': 20}, RulesDetector(), {'/patient/id': 'PATIENT_ID'})
        self.assertEqual(result['patient']['id'], '[PATIENTENNUMMER_1]')
        self.assertEqual(result['dose'], 20)
        self.assertEqual(entries[0]['original'], 123)
        self.assertEqual(result['items'], ['[E_MAIL_1]'])
        self.assertEqual(transform({'a/b': {'~id': 123}}, RulesDetector(), {'/a~1b/~0id': 'ID'})[0]['a/b']['~id'], '[ID_1]')

    def test_key_and_config_errors(self):
        for value, fields in [({'a@example.org': 'x'}, {}), ({}, {'/missing': 'ID'}), ({'id': {}}, {'/id': 'ID'})]:
            with self.assertRaises(ValueError):
                transform(value, RulesDetector(), fields)

    def test_ner_adapter(self):
        class Fake(RulesDetector):
            def detect(self, text):
                return [Span(0, len(text), 'ORGANIZATION')]
        self.assertEqual(transform('Klinikum Beispiel', Fake(), {})[0], '[EINRICHTUNG_1]')


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'request.txt'
        self.source.write_text('a@example.org: Asthma', encoding='utf-8')
        self.workspace = self.root / 'workspace'
        self.args = argparse.Namespace(input=str(self.source), format='text', workspace=str(self.workspace), config=None)
        self.out = argparse.Namespace(workspace=str(self.workspace), output=str(self.root / 'export.txt'))

    def prep(self):
        prepare(self.args, RulesDetector)

    def test_full_offline_workflow(self):
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            self.prep()
            self.assertEqual(self.workspace.stat().st_mode & 0o777, 0o700)
            for path in self.workspace.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                self.prep()
            with self.assertRaises(ValueError):
                export(self.out)
            # Previously created workspaces may contain unused filesystem metadata.
            state_path = self.workspace / 'state.json'
            state = json.loads(state_path.read_text())
            state.update(input_device=1, input_inode=123)
            state_path.write_text(json.dumps(state))
            approve(self.args)
            export(self.out)
        self.assertEqual(Path(self.out.output).read_text(), '[E_MAIL_1]: Asthma')
        self.assertNotIn('a@example.org', (self.workspace / 'report.json').read_text())
        self.assertEqual(Path(self.out.output).stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            export(self.out)

    def test_json_workflow_and_invalid_edit(self):
        self.source.write_text('{"patient": {"id": 123}, "text": "a@example.org", "dose": 5}')
        config = self.root / 'config.json'
        config.write_text('{"identifier_fields": {"/patient/id": "PATIENT_ID"}}')
        self.args.format = 'json'
        self.args.config = str(config)
        self.prep()
        approve(self.args)
        export(self.out)
        self.assertEqual(json.loads(Path(self.out.output).read_text())['patient']['id'], '[PATIENTENNUMMER_1]')
        (self.workspace / 'draft.json').write_text('{invalid')
        with self.assertRaises(ValueError):
            approve(self.args)

    def test_approval_invalidation(self):
        self.prep()
        approve(self.args)
        (self.workspace / 'draft.txt').write_text('Reviewed correction')
        with self.assertRaises(ValueError):
            export(self.out)
        approve(self.args)
        export(self.out)
        self.assertEqual(Path(self.out.output).read_text(), 'Reviewed correction')

    def test_destinations(self):
        self.prep()
        approve(self.args)
        for target in [self.source, self.workspace / 'export.txt']:
            self.out.output = str(target)
            with self.assertRaises(ValueError):
                export(self.out)
        link = self.root / 'link'
        link.symlink_to(self.workspace, target_is_directory=True)
        self.out.output = str(link / 'export.txt')
        with self.assertRaises(ValueError):
            export(self.out)

    def test_private_files_and_links(self):
        self.prep()
        draft = self.workspace / 'draft.txt'
        draft.chmod(0o644)
        with self.assertRaises(ValueError):
            approve(self.args)
        draft.unlink()
        draft.symlink_to(self.source)
        with self.assertRaises(ValueError):
            approve(self.args)

    def test_malformed_json_sanitized(self):
        self.source.write_text('{"SECRET":')
        output = io.StringIO()
        with redirect_stderr(output):
            code = main(['prepare', str(self.source), '--format', 'json', '--workspace', str(self.workspace)])
        self.assertEqual(code, 1)
        self.assertNotIn('SECRET', output.getvalue())
        self.assertFalse(self.workspace.exists())

    def test_missing_model_sanitized(self):
        output = io.StringIO()
        with patch('vcare_pseudonymizer.cli.Detector', side_effect=RuntimeError('SECRET')), redirect_stderr(output):
            code = main(['prepare', str(self.source), '--format', 'text', '--workspace', str(self.workspace)])
        self.assertEqual(code, 1)
        self.assertIn('German model', output.getvalue())
        self.assertNotIn('SECRET', output.getvalue())
        self.assertFalse(self.workspace.exists())


if __name__ == '__main__':
    unittest.main()
