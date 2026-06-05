"""Validation helpers using marshmallow schemas."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps

from flask import jsonify, request
from marshmallow import Schema, ValidationError


def validate_json(schema_class: type[Schema]) -> Callable:
    """Decorator to validate request JSON against a marshmallow schema.

    For GET/HEAD/DELETE methods, an empty body is allowed and the request
    is passed through without populating ``request.validated_data``.

    Usage:
        @bp.route("/endpoint", methods=["POST"])
        @validate_json(MySchema)
        def my_endpoint():
            # request.validated_data contains the validated data
            ...
    """

    def decorator(f: Callable) -> Callable:
        @wraps(f)
        def wrapped(*args, **kwargs):
            if request.method in ("GET", "HEAD", "DELETE", "OPTIONS"):
                return f(*args, **kwargs)
            schema = schema_class()
            try:
                data = request.get_json(force=True, silent=False)
                if data is None:
                    return jsonify({"error": "Request must contain valid JSON"}), 400
                if not isinstance(data, dict):
                    return jsonify({"error": "Request body must be a JSON object"}), 400
                validated = schema.load(data)
                request.validated_data = validated  # type: ignore[attr-defined]
            except ValidationError as err:
                return jsonify({"error": "Validation failed", "details": err.messages}), 400
            except Exception:
                return jsonify({"error": "Invalid JSON body"}), 400
            return f(*args, **kwargs)

        return wrapped

    return decorator


def validate_query(schema_class: type[Schema]) -> Callable:
    """Decorator to validate query parameters against a marshmallow schema."""

    def decorator(f: Callable) -> Callable:
        @wraps(f)
        def wrapped(*args, **kwargs):
            schema = schema_class()
            try:
                data = request.args.to_dict()
                validated = schema.load(data)
                request.validated_query = validated  # type: ignore[attr-defined]
            except ValidationError as err:
                return jsonify({"error": "Query validation failed", "details": err.messages}), 400
            return f(*args, **kwargs)

        return wrapped

    return decorator
