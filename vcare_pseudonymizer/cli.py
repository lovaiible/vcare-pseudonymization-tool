"""Private local workspaces and explicit review before export."""
import argparse
from collections import Counter
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sys

from .detection import Detector, resolve

class ToolError(ValueError):
    """A fixed, content-free message suitable for display."""


# Display labels only: detector types remain stable for reports and integrations.
PLACEHOLDER_LABELS = {
    'PERSON': 'PERSON',
    'EMAIL': 'E_MAIL',
    'PHONE': 'TELEFON',
    'LOCATION': 'ORT',
    'POSTAL_CODE': 'PLZ',
    'ORGANIZATION': 'EINRICHTUNG',
    'DATE': 'DATUM',
    'AGE': 'ALTER',
    'ADDRESS': 'ADRESSE',
    'IDENTIFIER': 'KENNNUMMER',
    'IBAN': 'IBAN',
    'PATIENT_ID': 'PATIENTENNUMMER',
    'INSURANCE_ID': 'VERSICHERTENNUMMER',
}


CHECKLIST = [
    'Compare the original and draft locally; correct missed identifiers and false positives.',
    'Review indirect identifiers: rare conditions, occupations, family details and unusual events.',
    'Check all numeric JSON fields and keys; configure identifier fields explicitly.',
    'Retained clinical narratives remain sensitive; approval does not certify anonymity.',
    'Share only the exported content, never the workspace or mapping.',
]


def load_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ToolError('Duplicate JSON key.')
            result[key] = value
        return result
    def invalid(_):
        raise ToolError('Invalid JSON constant.')
    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'


def private_write(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(content if isinstance(content, bytes) else content.encode('utf-8'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pointer_part(key):
    return key.replace('~', '~0').replace('/', '~1')


def config_fields(path):
    if path is None:
        return {}
    config = load_json(Path(path).read_text(encoding='utf-8'))
    if not isinstance(config, dict) or set(config) != {'identifier_fields'}:
        raise ToolError('Invalid configuration.')
    fields = config['identifier_fields']
    if not isinstance(fields, dict):
        raise ToolError('Invalid configuration.')
    for pointer, kind in fields.items():
        if not isinstance(pointer, str) or (pointer and not pointer.startswith('/')) or re.search(r'~(?![01])', pointer):
            raise ToolError('Invalid JSON Pointer.')
        if not isinstance(kind, str) or not re.fullmatch(r'[A-Z][A-Z_]*', kind):
            raise ToolError('Invalid identifier type.')
    return fields


def transform(value, detector, fields):
    entries, lookup, findings, used = [], {}, [], set()
    counts = Counter()

    def token(original, kind, pointer, start=None, end=None):
        key = (kind, type(original).__name__, dump(original))
        location = {'pointer': pointer, 'start': start, 'end': end}
        if key not in lookup:
            label = PLACEHOLDER_LABELS.get(kind, kind)
            counts[label] += 1
            entry = {'placeholder': f'[{label}_{counts[label]}]', 'type': kind,
                     'original': original, 'occurrences': []}
            lookup[key] = entry
            entries.append(entry)
        entry = lookup[key]
        entry['occurrences'].append(location)
        findings.append({'type': kind, **location})
        return entry['placeholder']

    def walk(item, pointer=''):
        if pointer in fields:
            if isinstance(item, (dict, list, bool)) or item is None:
                raise ToolError('Configured identifier must be a string or number.')
            used.add(pointer)
            return token(item, fields[pointer], pointer)
        if isinstance(item, dict):
            result = {}
            for key, child in item.items():
                if detector.detect(key):
                    raise ToolError('JSON key contains a detected identifier; rename keys locally before retrying.')
                result[key] = walk(child, pointer + '/' + pointer_part(key))
            return result
        if isinstance(item, list):
            return [walk(child, pointer + '/' + str(i)) for i, child in enumerate(item)]
        if isinstance(item, str):
            spans = resolve(detector.detect(item))
            parts, offset = [], 0
            for span in spans:
                parts.extend([item[offset:span.start], token(item[span.start:span.end], span.kind, pointer, span.start, span.end)])
                offset = span.end
            return ''.join(parts) + item[offset:]
        return item

    result = walk(value)
    if used != set(fields):
        raise ToolError('Configured identifier pointer was not found.')
    return result, entries, findings


def prepare(args, detector_factory=None):
    source = Path(args.input).resolve(strict=True)
    workspace = Path(args.workspace).absolute()
    if workspace.exists() or workspace.is_symlink():
        raise ToolError('Workspace already exists.')
    content = source.read_text(encoding='utf-8')
    value = load_json(content) if args.format == 'json' else content
    fields = config_fields(args.config)
    if args.format != 'json' and fields:
        raise ToolError('Identifier fields require JSON input.')
    detector = (detector_factory or Detector)()
    output, entries, findings = transform(value, detector, fields)
    draft = dump(output) if args.format == 'json' else output
    # Finish analysis before creating any sensitive files.
    workspace.mkdir(mode=0o700)
    private_write(workspace / ('draft.json' if args.format == 'json' else 'draft.txt'), draft)
    private_write(workspace / 'mapping.json', dump({'entries': entries}))
    private_write(workspace / 'report.json', dump({'detector': detector.version, 'findings': findings,
                  'counts': dict(Counter(f['type'] for f in findings)), 'review_checklist': CHECKLIST,
                  'status': 'requires-human-review'}))
    private_write(workspace / 'state.json', dump({'format': args.format, 'input': str(source)}))


def read_workspace(directory):
    workspace = Path(directory).absolute()
    if workspace.is_symlink() or not workspace.is_dir() or workspace.stat().st_mode & 0o077:
        raise ToolError('Workspace must be a private directory, not a symbolic link.')
    for name in ['state.json', 'mapping.json', 'report.json']:
        check_private(workspace / name)
    state = load_json((workspace / 'state.json').read_text(encoding='utf-8'))
    if state['format'] not in {'json', 'text'}:
        raise ToolError('Invalid workspace format.')
    draft = workspace / ('draft.json' if state['format'] == 'json' else 'draft.txt')
    check_private(draft)
    data = draft.read_bytes()
    text = data.decode('utf-8')
    if state['format'] == 'json':
        load_json(text)
    return workspace, state, data


def check_private(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077 or path.stat().st_nlink != 1:
        raise ToolError('Workspace files must be private regular files without links.')


def approve(args):
    workspace, _, data = read_workspace(args.workspace)
    approval = workspace / 'approval.json'
    if approval.exists() or approval.is_symlink():
        check_private(approval)
        approval.unlink()
    private_write(approval, dump({'sha256': digest(data), 'human_review_confirmed': True}))


def export(args):
    workspace, state, data = read_workspace(args.workspace)
    approval = workspace / 'approval.json'
    check_private(approval)
    record = load_json(approval.read_text(encoding='utf-8'))
    if record.get('human_review_confirmed') is not True or record.get('sha256') != digest(data):
        raise ToolError('Draft must be reviewed and approved again.')
    target = Path(args.output).absolute()
    resolved = target.resolve()
    if resolved == workspace.resolve() or workspace.resolve() in resolved.parents:
        raise ToolError('Export destination must be outside the workspace.')
    if resolved == Path(state['input']).resolve():
        raise ToolError('Export cannot overwrite input.')
    private_write(target, data)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Local German request pseudonymization. Review is required before sharing.')
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare')
    prep.add_argument('input')
    prep.add_argument('--format', choices=['text', 'json'], required=True)
    prep.add_argument('--workspace', required=True)
    prep.add_argument('--config')
    for command in ['approve', 'export']:
        cmd = sub.add_parser(command)
        cmd.add_argument('--workspace', required=True)
        if command == 'export':
            cmd.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    # Third-party libraries must not emit request data or model debug output.
    logging.disable(logging.CRITICAL)
    try:
        {'prepare': prepare, 'approve': approve, 'export': export}[args.command](args)
    except ToolError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (ImportError, RuntimeError):
        print('Local detection unavailable. Install the documented dependencies and German model; no fallback was used.', file=sys.stderr)
        return 1
    except Exception:
        print('Operation failed. Check input/configuration, local model installation, private permissions, and review approval. No content was logged.', file=sys.stderr)
        return 1
    print({'prepare': 'Draft prepared. Review locally before approval.', 'approve': 'Reviewed draft approved.', 'export': 'Approved content exported.'}[args.command])
    return 0


if __name__ == '__main__':
    sys.exit(main())
