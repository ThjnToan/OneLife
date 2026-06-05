PY ?= python
PIP ?= $(PY) -m pip
PORT ?= 5000
HOST ?= 127.0.0.1

.PHONY: help install run test lint format typecheck clean db-init db-migrate db-upgrade db-downgrade db-stamp db-history ingest-token docker-build docker-run

help:
	@echo "Available targets:"
	@echo "  install       Install dependencies"
	@echo "  run           Start the dev server (auto-reload)"
	@echo "  test          Run the test suite"
	@echo "  lint          Run ruff"
	@echo "  format        Run ruff format"
	@echo "  typecheck     Run mypy"
	@echo "  db-init       Initialize migrations (one-time)"
	@echo "  db-migrate    Generate a new migration (msg=...)"
	@echo "  db-upgrade    Apply pending migrations"
	@echo "  db-downgrade  Roll back the last migration"
	@echo "  db-stamp      Mark current schema as up-to-date (msg=head by default)"
	@echo "  db-history    Show migration history"
	@echo "  ingest-token  Generate a fresh INGEST_TOKEN; print env line for the Android app"
	@echo "  docker-build  Build the Docker image"
	@echo "  docker-run    Run with docker compose"
	@echo "  clean         Remove caches and pyc files"

install:
	$(PIP) install -r requirements.txt
	$(PIP) install ruff mypy pytest pytest-cov

run:
	FLASK_ENV=development DEBUG=1 $(PY) wsgi.py

test:
	$(PY) -m pytest

lint:
	$(PY) -m ruff check app wsgi.py manage.py tests

format:
	$(PY) -m ruff format app wsgi.py manage.py tests
	$(PY) -m ruff check --fix app wsgi.py manage.py tests

typecheck:
	$(PY) -m mypy

db-init:
	FLASK_APP=manage $(PY) -m flask db init

db-migrate:
	@if [ -z "$(msg)" ]; then echo "Usage: make db-migrate msg=\"describe change\""; exit 1; fi
	FLASK_APP=manage SKIP_DB_INIT=1 $(PY) -m flask db migrate -m "$(msg)"

db-upgrade:
	FLASK_APP=manage SKIP_DB_INIT=1 $(PY) -m flask db upgrade

db-downgrade:
	FLASK_APP=manage SKIP_DB_INIT=1 $(PY) -m flask db downgrade

db-stamp:
	FLASK_APP=manage SKIP_DB_INIT=1 $(PY) -m flask db stamp head

db-history:
	FLASK_APP=manage SKIP_DB_INIT=1 $(PY) -m flask db history

# Generate a fresh random INGEST_TOKEN and print the line you should
# add to your .env (or export). The server must be restarted for the
# new token to take effect.
ingest-token:
	@$(PY) -c "import secrets; print('# Generated on ' + __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()); print('INGEST_TOKEN=' + secrets.token_urlsafe(32))"

docker-build:
	docker build -t onelife:latest .

docker-run:
	docker compose up -d

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf .ruff_cache .mypy_cache .pytest_cache .coverage htmlcov build dist
