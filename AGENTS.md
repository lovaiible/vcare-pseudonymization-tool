# Repository instructions

- This standalone repository contains the German browser pseudonymizer and the compatible Python CLI/local server. Keep documentation in English and the interface in German.
- Use synthetic fixtures only. Never commit real requests, mappings, credentials, local workspaces, models, dependency directories, or generated builds.
- Preserve local-only browser processing, human review, SHA-256 approval checks, and export restrictions. Do not introduce telemetry or remote inference.
- Run `npm run setup` before `npm run check`; run `make check` for Python changes after `make setup`. Keep model provenance and licence notices intact.
- Publish only the production `dist/` artifact. Never publish `dist-qa/`, tests, local data, or Python workspaces. Deployment behavior changes require explicit authorization.
- Deliver on a dedicated `codex/` feature branch through a PR against `main`. Use Conventional Commits for commit messages and PR titles. Never push directly to `main` or merge without explicit user authorization. Return the local checkout to `main` after verifying delivery, preserving uncommitted work and feature branches.
