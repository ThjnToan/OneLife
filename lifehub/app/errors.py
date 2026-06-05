"""Centralized HTTP error handlers returning JSON for the SPA."""

from __future__ import annotations

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException


def _json_error(status: int, message: str):
    response = jsonify({"error": message})
    response.status_code = status
    return response


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(HTTPException)
    def handle_http_exception(exc: HTTPException):
        return _json_error(exc.code or 500, exc.description or exc.name)

    @app.errorhandler(Exception)
    def handle_uncaught(exc: Exception):  # pragma: no cover - defensive
        app.logger.exception("Unhandled exception")
        return _json_error(500, f"Internal server error: {exc.__class__.__name__}")
