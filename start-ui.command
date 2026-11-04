#!/bin/sh
# Double-click after completing the README setup once.
cd -- "$(dirname -- "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  echo 'Bitte zuerst die Einrichtung in README.md abschließen (Python 3.12 und lokales Sprachmodell).'
  echo 'Danach diese Datei erneut öffnen.'
  read -r ignored
  exit 1
fi
exec .venv/bin/python -m vcare_pseudonymizer.server
