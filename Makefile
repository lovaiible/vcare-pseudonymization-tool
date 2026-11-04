# Named tasks for this project. Run `make help` to list them.
.DEFAULT_GOAL := help
PYTHON ?= python3.12
VENV ?= .venv
PORT ?= 8765
ARGS ?= --help
MODEL_URL := https://github.com/explosion/spacy-models/releases/download/de_core_news_lg-3.8.0/de_core_news_lg-3.8.0-py3-none-any.whl

.PHONY: help setup install model check-env ui test test-integration check cli

help:
	@echo "Vcare request pseudonymizer"
	@echo "  make setup             Create the environment, install dependencies and model"
	@echo "  make ui                Start the local HTML interface (PORT=8766 to change port)"
	@echo "  make test              Run unit and HTTP workflow tests"
	@echo "  make test-integration  Run offline German-model tests"
	@echo "  make check             Run both test suites"
	@echo "  make cli ARGS='...'    Run a pseudonymizer CLI command (defaults to --help)"
	@echo "Setup override: make setup PYTHON=/path/to/python3.12"

$(VENV)/pyvenv.cfg:
	"$(PYTHON)" -m venv "$(VENV)"

install: $(VENV)/pyvenv.cfg
	"$(VENV)/bin/python" -m pip install -c requirements.lock -e .

model: install
	"$(VENV)/bin/python" -m pip install "$(MODEL_URL)"

setup: model

check-env:
	@test -x "$(VENV)/bin/python" || { echo "Environment missing. Run make setup first (Python 3.12 required)."; exit 1; }

ui: check-env
	"$(VENV)/bin/python" -m vcare_pseudonymizer.server --port "$(PORT)"

test: check-env
	"$(VENV)/bin/python" -m unittest discover -s tests -v

test-integration: check-env
	"$(VENV)/bin/python" -m unittest discover -s tests -p 'integration_*.py' -v

check: test test-integration

cli: check-env
	"$(VENV)/bin/python" -m vcare_pseudonymizer.cli $(ARGS)
