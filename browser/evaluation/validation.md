# Browser validation — 2026-11-03

## Status and method

The detection comparison gate passes on the synthetic corpus below. Team rollout remains pending Windows Chrome/Edge verification. The Python local web workflow remains the supported fallback. These results do not establish anonymity or performance on real requests.

Twenty initial fixtures (47 annotated spans) were written before model evaluation. Six additional harder cases bring the total to 26 requests and 56 spans. The additional set exposed clinical false positives and missing/wrongly typed entities. It also led to a general whole-word boundary regression fix; it is therefore not an untouched external test set. No real requests were used and no names or medical terms were added to detection dictionaries to fit these cases.

Scoring requires an exact source span and matching entity type. A wrong type counts as both a false positive and false negative, even when the content is replaced. Clinical-change checks flag any overlap with annotated clinical phrases. Python code-point offsets are converted to UTF-16 before comparison.

| Entity | Gold spans | Python precision / recall | JavaScript precision / recall |
| --- | ---: | ---: | ---: |
| PERSON | 22 | 80.0% / 90.9% | 95.5% / 95.5% |
| LOCATION | 12 | 85.7% / 100.0% | 92.3% / 100.0% |
| ORGANIZATION | 4 | 100.0% / 75.0% | 100.0% / 75.0% |
| EMAIL | 4 | 100.0% / 100.0% | 100.0% / 100.0% |
| PHONE | 3 | 100.0% / 100.0% | 100.0% / 100.0% |
| DATE | 3 | 100.0% / 100.0% | 100.0% / 100.0% |
| IDENTIFIER | 3 | 100.0% / 66.7% | 100.0% / 100.0% |
| ADDRESS | 1 | 100.0% / 100.0% | 100.0% / 100.0% |
| AGE | 1 | 100.0% / 100.0% | 100.0% / 100.0% |
| IBAN | 1 | 100.0% / 100.0% | 100.0% / 100.0% |
| POSTAL_CODE | 2 | 100.0% / 100.0% | 100.0% / 100.0% |
| **Overall** | **56** | **88.1% / 92.9%** | **96.4% / 96.4%** |

The gate requires PERSON, LOCATION and ORGANIZATION recall at least equal to Python and no reduction in overall precision. JavaScript: 54 true positives, 2 false positives, 2 misses. Python: 52 true positives, 7 false positives, 4 misses. This is a small regression corpus, not an accuracy estimate for Vcare requests.

## Known failures

- Lowercase signature “anna schmidt” is missed by the browser model and rules.
- “Universitätsklinikum Hamburg-Eppendorf” is replaced as LOCATION rather than ORGANIZATION; it is not leaked but has the wrong placeholder type.
- “Morbus Crohn” is incorrectly replaced as PERSON by the browser model. Python instead incorrectly changes “Morbus Basedow” in this fixture. Review diagnoses and medications as well as missed identifiers.
- Indirect identifying circumstances, unfamiliar names and formats, unusual signatures, and unannotated clinical false positives remain possible. Neither workflow certifies anonymity.

## Browser and operational checks

- JavaScript: 12 test groups cover rule regressions, token-ID agreement, UTF-16 offsets, subword boundaries, overlaps, repeated values, session isolation, hash approval, cancellation/stale results and missing models.
- Python: all 25 existing tests pass; Python source and CLI behavior are unchanged.
- Chrome on macOS: real WASM inference, desktop/narrow layouts, 20,001-character rejection, cancellation, editing invalidation, approval and clearing verified. Clearing one tab leaves another tab's approved draft intact.
- Safari on macOS: real WASM inference, review/approval and download verified. The downloaded synthetic file contains the approved draft only, with clinical text retained and no original mapping.
- Layout: at 1440 px, textareas share top and bottom positions and panels share height; at 390 px, panels stack, both textareas are 280 px high and there is no horizontal overflow.
- The final 26-case Chrome WASM report reproduces the JavaScript metrics above. Browser verification blocks fetch after loading, records only same-origin static asset GETs and checks detection across token windows and at the end of a 19,984-character request. No network attempts occur during inference.
- Windows Chrome and Edge: **not run**; no Windows execution target is available. Run the verification page and the interactive checklist below before team rollout.

Local measurements on this Mac in Chrome: model initialization about 5–6 seconds, short requests approximately 30–170 ms, and a 19,984-character request approximately 30 seconds. These figures exclude Internet download time and vary with device load. Core model/tokenizer/runtime assets total approximately 196 MB uncompressed; the complete static distribution is approximately 223 MB, including an additional bundled runtime variant. First-load transfer depends on compression and browser caching; no Internet bandwidth benchmark was performed.

## Reproduction and acceptance

From the project directory: run `npm ci`, `npm run setup`, `npm run check`, `make check`, and `npm run evaluate`. The last command writes ignored `browser/evaluation/results/comparison.json`. Run `npm run build:verification` and `npm run preview:verification -- --port 4179`, then open `/tests/verification.html` in the browser being tested. Save the report, then run `npm run evaluate -- --browser-report /absolute/path/to/report.json` to score browser results against the same Python baseline. A failed gate returns a nonzero exit code. Never deploy the verification build.

For each target browser: run the fixture page; verify only static asset requests before loading and none during processing; exercise demo, edit, approve, download, clear, cancel and retry; open a second tab and confirm independence; check 390 px and desktop widths; confirm missing assets block processing. Compare all fixture spans with the annotations, record timing and browser/OS version, and investigate changes before updating this report.

If future model changes fail the gate, keep the Python workflow recommended and report the browser candidate as experimental. Human review and the explicit Windows check remain required even when the numerical gate passes.

## Provenance

- Model: `Xenova/bert-base-multilingual-cased-ner-hrl`, revision `263e82c06569c8c2ac46238a7ae5107598934234`; see [manifest](../model-manifest.json) and [attribution](../public/licences/MODEL.md).
- Python baseline: Presidio `2.2.364`, spaCy `3.8.16`, German model `3.8.0`.
- Initial fixture SHA-256: `3d8bb136a95210007c9f99b0b9a13a22f5635b46fba748bc5f47811c510a86b1`.
- Additional fixture SHA-256: `4c2d5d475fff0482b125504d7039e01eae05c36e834e063c1c18bbc9723b52cd`.
- JavaScript package versions and transitive integrity are pinned in the project npm lockfile. Browser and Node use the same tokenizer, windowing, rules and entity aggregation; Node evaluates with native CPU inference, the browser verification uses WASM.
