"""Uniform JSON error format for the whole API.

Every error response has the shape::

    {"error": {"code": "<machine code>", "message": "<human text>",
               "details": [{"field": "name", "message": "...", "type": "..."}], ...extra}}

Messages are English and user-facing; raw Pydantic texts are translated by ``friendly_message``.
"""

import logging
from collections.abc import Sequence
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.errors")

_HTTP_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    429: "rate_limited",
}

# Location prefixes FastAPI puts in front of the field path.
_LOC_SOURCES = {"body", "query", "path", "header", "cookie"}


class AppError(Exception):
    """Domain/API error rendered in the uniform format."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: Sequence[dict[str, Any]] = (),
        **extra: Any,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = list(details)
        self.extra = extra


def not_found(what: str = "Resource") -> AppError:
    return AppError(404, "not_found", f"{what} not found.")


def field_error(field: str, message: str, type_: str = "invalid") -> dict[str, Any]:
    return {"field": field, "message": message, "type": type_}


def validation_failed(details: Sequence[dict[str, Any]], message: str | None = None) -> AppError:
    return AppError(422, "validation_error", message or "Check the highlighted fields.", details)


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: Sequence[dict[str, Any]] = (),
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message, "details": list(details)}
    body.update(extra)
    return JSONResponse(status_code=status_code, content={"error": body}, headers=headers)


def _field_path(loc: Sequence[Any]) -> str | None:
    parts = list(loc)
    if parts and parts[0] in _LOC_SOURCES:
        parts = parts[1:]
    # drop pydantic function-validator markers like "function-after[...]"
    parts = [p for p in parts if not (isinstance(p, str) and "[" in p and p.endswith("]"))]
    return ".".join(str(p) for p in parts) or None


def friendly_message(err: dict[str, Any]) -> str:
    t = err.get("type", "")
    ctx = err.get("ctx") or {}
    if t == "missing":
        return "This field is required."
    if t == "string_too_short":
        return (
            "This field is required."
            if ctx.get("min_length", 1) <= 1
            else f"Use at least {ctx['min_length']} characters."
        )
    if t == "string_too_long":
        return f"Use at most {ctx.get('max_length')} characters."
    if t in {"value_error", "assertion_error"}:
        msg = str(err.get("msg", ""))
        for prefix in ("Value error, ", "Assertion failed, "):
            if msg.startswith(prefix):
                msg = msg[len(prefix) :]
        return msg or "Invalid value."
    if t in {
        "int_parsing",
        "int_type",
        "float_parsing",
        "float_type",
        "decimal_parsing",
        "decimal_type",
        "int_from_float",
        "finite_number",
    }:
        return "Enter a valid number."
    if t in {"greater_than_equal"}:
        return f"Enter a value of {ctx.get('ge')} or more."
    if t in {"greater_than"}:
        return f"Enter a value greater than {ctx.get('gt')}."
    if t in {"less_than_equal"}:
        return f"Enter a value of {ctx.get('le')} or less."
    if t in {"less_than"}:
        return f"Enter a value less than {ctx.get('lt')}."
    if t == "decimal_max_places":
        return f"Use at most {ctx.get('decimal_places')} decimal places."
    if t == "decimal_max_digits":
        return "The number is too large."
    if t in {"literal_error", "enum"}:
        return "Choose one of the available options."
    if t in {"string_type", "bool_type", "bool_parsing", "list_type", "dict_type", "model_type"}:
        return "Invalid value type."
    if t == "extra_forbidden":
        return "Unknown field."
    if t in {"date_parsing", "date_from_datetime_parsing", "date_type"}:
        return "Enter a valid date (YYYY-MM-DD)."
    return "Invalid value."


async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return error_response(exc.status, exc.code, exc.message, exc.details, **exc.extra)


async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    if any(e.get("type") == "json_invalid" for e in errors):
        return error_response(400, "invalid_json", "Request body is not valid JSON.")
    details = [
        {"field": _field_path(e.get("loc", ())), "message": friendly_message(e), "type": e["type"]}
        for e in errors
    ]
    return error_response(422, "validation_error", "Check the highlighted fields.", details)


async def _http_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    status = exc.status_code
    code = _HTTP_CODES.get(status, "http_error")
    default_message = HTTPStatus(status).phrase if status in HTTPStatus._value2member_map_ else ""
    message = exc.detail if isinstance(exc.detail, str) else default_message
    if status == 404 and message == "Not Found":
        message = "Not found."
    return error_response(status, code, message, headers=getattr(exc, "headers", None))


async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", exc_info=exc)
    return error_response(500, "internal_error", "Something went wrong on our side.")


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _http_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unhandled_handler)
