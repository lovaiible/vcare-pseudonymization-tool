"""Local recognizers. No downloads are performed by this module."""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    kind: str
    priority: int = 10


RULES = [
    ('EMAIL', r'(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', 0),
    ('IBAN', r'\bDE\d{2}(?:[ ]?\d){18}\b', 0),
    ('PHONE', r'(?<!\w)(?:\+49[ ()/-]*|0049[ ()/-]*|0\d{2,5}[ /()-]+)\d(?:[ ()/-]*\d){5,13}(?!\w)', 1),
    ('DATE', r'\b(?:\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?:\s+\d{4})?)\b', 2),
    ('AGE', r'\b\d{1,3}\s*(?:Jahre?\s*alt|Jahre?|Monate?\s*alt|Wochen\s*alt|[- ]?jährig\w*)\b', 2),
    ('ADDRESS', r'\b[A-ZÄÖÜ][\wäöüßÄÖÜ-]*(?:straße|strasse|str\.|weg|platz|allee|gasse)\s*\d+[a-zA-Z]?(?:\s*,?\s*\d{5}\s+[A-ZÄÖÜ][\wäöüß-]*)?', 1),
    # Conservatively treat isolated five-digit numbers as postal-code candidates.
    ('POSTAL_CODE', r'(?<!\w)(?<![0-9][.,])[0-9]{5}(?!\w|[.,][0-9])', 2),
    ('LOCATION', r'\b\d{5}\s+[A-ZÄÖÜ][\wäöüß-]+\b', 3),
    ('PERSON', r'\b(?:Herrn?|Frau)\s+((?:[A-ZÄÖÜ][\wäöüß-]+)(?:\s+[A-ZÄÖÜ][\wäöüß-]+){0,2})', 3),
    ('IDENTIFIER', r'\b(?:Patient(?:en)?(?:nummer|[- ]?ID)|Versicherungsnummer|Versichertennummer|Aktenzeichen|Referenz(?:nummer)?|Fallnummer)\s*[:#=-]?\s*([A-Za-z0-9][A-Za-z0-9/-]*)', 0),
]


# Match a signature name on the same line or the next non-empty line.
# Horizontal whitespace is deliberate: names must not consume further lines.
SIGNATURE = re.compile(
    r"^[ \t]*(?i:best regards|kind regards|warm regards|regards|best wishes|"
    r"mit freundlichen gr(?:ü|ue|u)(?:ß|ss)en|freundliche gr(?:ü|ue|u)(?:ß|ss)e|"
    r"viele gr(?:ü|ue|u)(?:ß|ss)e|liebe gr(?:ü|ue|u)(?:ß|ss)e|herzliche gr(?:ü|ue|u)(?:ß|ss)e)"
    r"[ \t]*[,!:]?[ \t]*(?:\r?\n[ \t]*){0,2}"
    r"(?P<name>[^\W\d_][^\W\d_.'’ʼ-]*(?:[.'’ʼ-][^\W\d_]*)*"
    r"(?:[ \t]+[^\W\d_][^\W\d_.'’ʼ-]*(?:[.'’ʼ-][^\W\d_]*)*){0,7})"
    r"[ \t]*(?=\r?$)", re.MULTILINE,
)
NAME_PARTICLES = {'von', 'van', 'der', 'den', 'de', 'del', 'di', 'da', 'dos', 'du', 'zu', 'zur', 'zum'}
NAME_TITLES = {'dr.', 'prof.', 'med.'}


def signature_spans(text):
    spans = []
    for match in SIGNATURE.finditer(text):
        words = match.group('name').split()
        names = [word for word in words if word.casefold() not in NAME_PARTICLES | NAME_TITLES]
        # Do not treat ordinary follow-up sentences or a signature title alone as names.
        if names and all(word[0].isupper() for word in names):
            spans.append(Span(*match.span('name'), 'PERSON', 1))
    return spans


def rule_spans(text):
    spans = signature_spans(text)
    for kind, pattern, priority in RULES:
        for match in re.finditer(pattern, text, re.IGNORECASE if kind in {'DATE', 'AGE', 'IDENTIFIER'} else 0):
            start, end = match.span(1 if kind in {'PERSON', 'IDENTIFIER'} else 0)
            spans.append(Span(start, end, kind, priority))
    return spans


def resolve(spans):
    """Longest first, priority next, then stable positional/type tie breakers."""
    chosen = []
    for span in sorted(set(spans), key=lambda s: (-(s.end-s.start), s.priority, s.start, s.kind)):
        if not any(span.start < other.end and other.start < span.end for other in chosen):
            chosen.append(span)
    return sorted(chosen, key=lambda s: s.start)


class Detector:
    def __init__(self):
        # Check installation before creating Presidio: never auto-download a model.
        from importlib.metadata import version
        import spacy
        from presidio_analyzer import AnalyzerEngine, RecognizerRegistry, EntityRecognizer, RecognizerResult
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        if not spacy.util.is_package('de_core_news_lg'):
            raise RuntimeError('Required local German model is unavailable.')
        engine = NlpEngineProvider(nlp_configuration={
            'nlp_engine_name': 'spacy',
            'models': [{'lang_code': 'de', 'model_name': 'de_core_news_lg'}],
        }).create_engine()

        class GermanEntities(EntityRecognizer):
            def __init__(self):
                super().__init__(supported_entities=['PERSON', 'LOCATION', 'ORGANIZATION'], supported_language='de')

            def analyze(self, text, entities, nlp_artifacts=None):
                kinds = {'PER': 'PERSON', 'PERSON': 'PERSON', 'LOC': 'LOCATION', 'LOCATION': 'LOCATION', 'ORG': 'ORGANIZATION', 'ORGANIZATION': 'ORGANIZATION'}
                return [RecognizerResult(kinds[e.label_], e.start_char, e.end_char, 0.7)
                        for e in nlp_artifacts.entities if e.label_ in kinds and kinds[e.label_] in entities]

        registry = RecognizerRegistry(supported_languages=['de'])
        registry.add_recognizer(GermanEntities())
        self.engine = AnalyzerEngine(nlp_engine=engine, registry=registry, supported_languages=['de'])
        self.version = {'tool': '0.1.0', 'presidio': version('presidio-analyzer'),
                        'spacy': version('spacy'), 'model': version('de-core-news-lg')}

    def detect(self, text):
        found = self.engine.analyze(text=text, language='de', entities=['PERSON', 'LOCATION', 'ORGANIZATION'])
        return resolve(rule_spans(text) + [Span(r.start, r.end, r.entity_type, 10) for r in found])
