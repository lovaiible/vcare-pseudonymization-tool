# Vcare request pseudonymizer

A local German request pseudonymizer owned by the Vcare team. It replaces identifying details with typed German placeholders while retaining clinical context. Review is required before export; pseudonymization does not guarantee anonymity.

## Browser-only version (preview)

[Open the public browser tool](https://lovaiible.github.io/vcare-pseudonymization-tool/). No installation or sign-in is required.

The JavaScript interface processes pasted German text entirely on the user's device. It needs no Python server, accounts, API keys, or external inference service. The existing Python CLI and local web interface remain available below.

The synthetic detection comparison passes, but Windows Chrome/Edge verification is still pending. Keep the Python workflow as the supported fallback until the browser matrix is complete. Read the [validation results and known misses](browser/evaluation/validation.md) before using either version.

For developers, install Node.js 22.12+ (use a maintained LTS release) and run these commands from the repository root:

```sh
npm ci
npm run setup    # Download checksum-pinned model assets; copy local runtime/fonts
npm run dev      # Open the printed localhost URL
npm run check    # JavaScript regression tests and verified production build
npm run preview # Serve dist/ locally after building
```

`npm run build` produces `dist/`, the static site published to GitHub Pages, including model weights, WASM, fonts, favicon and licences. Opening HTML through `file://` is unsupported. There is no Docker configuration, authentication, processing backend, or service worker. The site and source code are public; entered requests remain in the browser. GitHub serves static assets and can record normal access metadata such as IP addresses, but the application does not transmit request text.

The model loads automatically when the page opens. A progress bar below the headline shows model-file download progress, followed by an indeterminate initialization phase; only “Sprachmodell bereit” means detection is ready. You can enter text during loading; detection becomes available once the model is ready. If loading fails, use “Erneut versuchen” without losing your input. The first load needs roughly 200 MB of application/model assets; startup over the Internet depends on connection speed. Model and runtime URLs are versioned, and the browser may cache these static assets. No request data is cached by the application. Offline reopening is not supported; an already loaded worker can process further requests without network access. Clearing/cancelling terminates that worker, and immediately initializes a fresh one, which may need asset access again. Leaving the page stops the worker without restarting it.

### Browser-only workflow and retention

1. Paste up to 20,000 Unicode characters and choose **Angaben erkennen**. JSON and file imports remain CLI-only.
2. Compare the complete draft with the original. Correct missed identifiers and inappropriate replacements, including clinical terms.
3. Check the review confirmation, select **Fassung freigeben**, then **Herunterladen**. Approval hashes the exact UTF-8 draft with SHA-256; editing or preparing a new request invalidates it.
4. Use **Sitzung leeren & neu beginnen** between cases. **Verarbeitung abbrechen** cancels processing and retains the original input for correction or retry.

Originals, automatic mappings, findings and approvals exist only in this tab's memory. There is no mapping download or session recovery. Clearing, reloading, or leaving the page discards the session, including browser back/forward restoration. Tabs have independent sessions. The download contains only the approved text; manually edited drafts do not rewrite automatic mappings. Memory disposal means references are released for garbage collection, not forensic erasure of device memory. Browser extensions and operating-system memory management remain outside the application's control.

All model/runtime requests stay on the serving origin. Text is never placed in requests, URLs, storage, logs or telemetry. The page has a restrictive Content Security Policy; there are no third-party scripts or fonts. Approval is a review aid, not an anonymity certificate or protection against someone modifying their own browser.

### Browser model and development checks

The worker uses Transformers.js and the quantized ONNX conversion of [Davlan's multilingual NER model](https://huggingface.co/Davlan/bert-base-multilingual-cased-ner-hrl), with German PERSON, LOCATION and ORGANIZATION detection. [The manifest](browser/model-manifest.json) pins the conversion revision, file sizes and SHA-256 checksums. Setup fetches from Hugging Face; runtime Hub/CDN loading is disabled. The model is news-trained, not clinically validated. Its AFL-3.0 licence, attribution, ONNX Runtime's MIT licence and Transformers.js's Apache-2.0 licence ship with the build.

Rules handle contacts, addresses, postal codes, ages, dates, financial/contextual identifiers and signatures. A tokenizer matching the pinned cased BERT configuration preserves offsets; regression tests compare its IDs with the library tokenizer. Windows contain 384 tokens with 64-token overlap. Each token uses the prediction with the most surrounding context. Subword detections expand to complete source words before the longest-span/priority overlap resolver. JavaScript offsets are UTF-16 indices; the evaluation converts Python offsets before comparison. Placeholder-looking text already present in the input is skipped when assigning new placeholder numbers.

```sh
npm test
npm run evaluate # Requires the existing Python .venv as the comparison baseline
npm run build:verification
npm run preview:verification -- --port 4179
# Open http://127.0.0.1:4179/tests/verification.html and run synthetic verification.
```

The verification build (`dist-qa/`) is separate and must never be deployed. Its test worker allows same-origin GET requests only, then blocks fetch after initialization and tests all annotated cases, token boundaries, and a near-limit request. Save its JSON report and compare it with `npm run evaluate -- --browser-report /absolute/path/to/report.json`. A failed detection gate exits with a nonzero status. Generated assets and results are ignored by Git. `VCARE_PYTHON` optionally selects another Python 3.12 interpreter for evaluation; production needs no environment variables.

If initialization fails, the app stops instead of processing with rules alone. Retry after checking asset availability; developers should rerun `npm run setup`. Checksum failures require correcting the downloaded files, not disabling verification. Reload after an application update; reload open tabs after a deployment if an old version can no longer find its assets.

## Python setup

Requires Python 3.12 and Make on macOS or Linux. On macOS, install the required Python version with `brew install python@3.12` if needed. Run all commands from the repository root:

```sh
make setup  # Create .venv, install pinned dependencies and the German model
make ui     # Open the printed address: http://127.0.0.1:8765
```

If Python 3.12 is not on your PATH, use `make setup PYTHON=/path/to/python3.12`. Setup requires network access and reuses an existing environment; processing needs no network services or external AI. `requirements.lock` pins the tested dependencies; the Makefile pins `de_core_news_lg` 3.8.0. No environment variables or `.env` file are required.

| Command | Purpose |
| --- | --- |
| `make help` | List tasks |
| `make ui PORT=8766` | Start on another port |
| `make cli ARGS='--help'` | Show CLI usage |
| `make test` | Run unit and local HTTP tests |
| `make test-integration` | Run offline German-model tests |
| `make check` | Run both test suites |

On macOS, `start-ui.command` also starts the interface after setup. No virtual-environment activation is needed.

## Python local web workflow

The original German HTML interface started by `make ui` requires the local Python server; opening the HTML file directly will not work.

1. Paste the original text and select **Angaben erkennen**.
2. Compare the entire draft with the original and edit missed identifiers or false positives. Counts do not establish complete detection.
3. Confirm your review and select **Fassung freigeben**, then **Herunterladen**. Editing the draft invalidates approval.
4. Use **Sitzung leeren & neu beginnen** between cases. Stop the server with `Ctrl+C`.

Only pasted plain text is supported in the browser. The CLI also accepts files, JSON, and identifier-field configuration. Downloads contain only the approved draft, never its mapping.

This is a single-user tool, bound to `127.0.0.1`, with Host/Origin checks, a local session, no-store responses, and a Content Security Policy. Tabs share one active case and can replace each other's work. It is not a hosted or multi-user service.

The interface bundles Montserrat Variable from [the Vcare website](https://www.vcare.health/), including Latin, extended Latin, Vietnamese, and Cyrillic subsets. The [SIL Open Font License](vcare_pseudonymizer/web/fonts/OFL.txt) is included. Fonts, scripts, and assets are served locally; no external resources are loaded during use.

## CLI workflow

Use absolute paths outside the repository for inputs, workspaces, and exports:

```sh
make cli ARGS='prepare /private/tmp/request.txt --format text --workspace /private/tmp/vcare-review'
# JSON: adapt config.example.json to match the input first.
make cli ARGS='prepare /private/tmp/request.json --format json --workspace /private/tmp/vcare-json-review --config config.example.json'
# After reviewing and, if necessary, editing the text draft locally:
make cli ARGS='approve --workspace /private/tmp/vcare-review'
make cli ARGS='export --workspace /private/tmp/vcare-review --output /private/tmp/reviewed-request.txt'
```

Inputs must be UTF-8. Each file is one request; a new request gets a separate mapping. Repeated identical typed values share placeholders within that request, such as `[PERSON_1]`, `[E_MAIL_1]`, `[TELEFON_1]`, `[ORT_1]`, `[PLZ_1]`, `[DATUM_1]`, and `[KENNNUMMER_1]`. Aliases are not linked. Existing placeholder-like text can resemble generated tokens; inspect it during review. Existing workspaces are not rewritten.

JSON structure and unconfigured numeric values are preserved; nested string values are scanned. Duplicate keys, nonstandard numeric constants, and keys containing detected identifiers are rejected. Rename identifying keys locally before retrying. Use `config.example.json` to replace entire identifier fields, including numeric IDs. Every pointer must exist and refer to a string or number, not an object, array, boolean, or null. JSON Pointer escapes are `~0` for `~` and `~1` for `/`. Configured values become placeholder strings. Known English types `PATIENT_ID` and `INSURANCE_ID` produce German tokens; other custom labels are used as provided. Internal detector types remain unchanged.

A workspace contains the draft, `mapping.json`, `report.json`, and `state.json`; approval adds `approval.json`. The mapping retains original values and occurrence locations. Reports contain detector versions, counts, types, JSON Pointers, Unicode character offsets (end-exclusive), and a checklist. Mappings describe automatic replacements, not manual edits. There is no restore command.

Export verifies the approved draft hash and refuses changed or unapproved content, existing targets, the input path, and destinations inside the workspace. Approval records your review; local users with file access can alter its metadata, so it is not a tamper-proof attestation.

## Review and detection limits

Check names (including relatives), contacts, identifiers, dates, ages, locations, organizations, numeric fields, and JSON keys. Rare conditions, occupations, family relationships, and unusual events can identify people indirectly. Keep only what recipients need; retained clinical information remains sensitive.

- Isolated five-digit numbers are conservatively treated as postal-code candidates, including leading zeros and city-before-code layouts. Codes already covered by an address or location use that broader placeholder. Unrelated five-digit integers can also be replaced; review clinical measurements. Longer identifiers and decimal values are excluded by the postal-code rule.
- Names after common German/English email sign-offs are detected on the same line or next name line, with at most one blank line. Rules support capitalized names, initials, common titles, and name particles. Lowercase signatures, aliases, unusual names, sign-offs, and address/date/phone formats may be missed.
- Named-entity detection can remove clinical terms incorrectly. Passing tests and zero detections do not establish anonymity or completeness.

## Verification and operations

Run `make check` after setup. Unit tests use synthetic data and deterministic rules. Model integration tests block socket connections and exercise the installed German model. The small annotated rule fixture set is regression coverage, not a population-level accuracy estimate. No real requests are used in tests.

Store originals, workspaces, and exports outside tracked source files on encrypted device storage. Workspace directories use mode `0700` and files `0600`; the application itself does not encrypt them. Use a trusted parent directory and editor, preserving private permissions. Concurrent modification by other processes is outside the workflow's guarantees. Paths and JSON keys may themselves be sensitive; do not put request content in command arguments.

The Python local web interface keeps originals, drafts, and mappings in a private temporary folder. Clearing, successfully preparing a replacement request, or normal shutdown removes those files. A failed preparation preserves the previous case. Closing/reloading the browser does not stop the server. Forced termination can leave `vcare-ui-*` folders in the system temporary directory; inspect and delete them locally. Browser downloads persist independently, and browser extensions/download permissions are outside application control.

CLI workspaces remain until manually removed. If writing preparation files fails, a partial sensitive workspace may remain: inspect/delete it and retry with a new workspace. Never reuse a partial workspace. Existing workspaces and export files are not overwritten. Missing dependencies or models fail preparation rather than falling back to rules. Normal output/errors omit request content. No automatic retention, telemetry, schedule, or retry service processes request data. Keep mappings only as long as needed under your organization's policy; deletion is irreversible without another retained original.

## GitHub Pages deployment

The `GitHub Pages` workflow runs JavaScript tests and builds on pull requests, relevant pushes to `main`, and manual runs. Only successful builds on `main` publish `dist/`; verification builds, Python code, test fixtures, local data and dependency directories are not uploaded. Actions use Node 22, the npm lockfile, and checksum-pinned model downloads. The model is downloaded during the build rather than committed to Git.

In repository **Settings → Pages**, the publishing source is **GitHub Actions**. The `github-pages` environment permits deployments from `main` only. The public URL is https://lovaiible.github.io/vcare-pseudonymization-tool/; no custom domain or credentials are required. GitHub Pages provides HTTPS.

To release, create a feature branch and a PR with a Conventional Commit title, wait for checks, and merge after review. To redeploy the current release, run **Actions → GitHub Pages → Run workflow** on `main`. To roll back, revert the problematic change in a new PR and merge it; the successful build redeploys the previous application behavior. Do not force-push `main`. Existing open tabs should reload after rollback or a model-version change.

For a local deployment-path check, run `npm run build -- --base=/vcare-pseudonymization-tool/`, then `npm run preview -- --base=/vcare-pseudonymization-tool/` and open the printed address with that path. Development can continue using `npm run dev` at the root URL.
