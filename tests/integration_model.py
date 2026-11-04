"""Requires setup dependencies and German model. Uses synthetic content only."""
import socket
import unittest
from unittest.mock import patch
from vcare_pseudonymizer.detection import Detector
from vcare_pseudonymizer.cli import transform


class ModelIntegration(unittest.TestCase):
    def test_real_model_offline(self):
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network prohibited')):
            detector = Detector()
            text = 'Jutta Müller wohnt in Berlin. Sie arbeitet bei Siemens. Sie hat Asthma und nimmt Salbutamol.'
            result, entries, _ = transform(text, detector, {})
            self.assertTrue(any(e['type'] == 'PERSON' for e in entries))
            self.assertTrue(any(e['type'] == 'LOCATION' for e in entries))
            self.assertTrue(any(e['type'] == 'ORGANIZATION' for e in entries))
            self.assertNotIn('Jutta Müller', result)
            self.assertNotIn('Berlin', result)
            self.assertNotIn('Siemens', result)
            self.assertIn('Asthma', result)
            self.assertIn('Salbutamol', result)

    def test_postal_codes_with_real_model_offline(self):
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network prohibited')):
            detector = Detector()
            for text in ['Wohnort: Berlin 10115.', 'Wohnort: Berlin (10115).', 'Wohnort: 01067 Dresden.', 'PLZ: 10115']:
                with self.subTest(text=text):
                    result, _, _ = transform(text, detector, {})
                    self.assertNotIn('10115', result)
                    self.assertNotIn('01067', result)
                    self.assertTrue('[PLZ_' in result or '[ORT_' in result)

    def test_email_signatures_with_real_model_offline(self):
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network prohibited')):
            detector = Detector()
            for closing in ['Best regards', 'Kind regards', 'Viele Grüße', 'Mit freundlichen Grüßen']:
                with self.subTest(closing=closing):
                    text = 'Ich habe Asthma und nehme Salbutamol.\n\n' + closing + '\nJutta Müller'
                    result, entries, _ = transform(text, detector, {})
                    self.assertNotIn('Jutta Müller', result)
                    self.assertIn('[PERSON_', result)
                    self.assertIn('Asthma', result)
                    self.assertIn('Salbutamol', result)
                    self.assertTrue(any(e['type'] == 'PERSON' and 'Jutta Müller' in e['original'] for e in entries))

    def test_missing_model(self):
        with patch('spacy.util.is_package', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'local German model'):
                Detector()
