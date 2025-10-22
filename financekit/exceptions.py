from __future__ import annotations
from typing import Optional
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import APIException, Throttled


class ReplayDetected(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Replay detected"
    default_code = "replay_detected"


def exception_handler(exc, context) -> Optional[Response]:
    """
    Wrap DRF/default exceptions into a consistent envelope:
      { code, detail, hint }
    Leaves non-error responses untouched.
    """
    resp = drf_exception_handler(exc, context)
    if resp is None:
        return resp

    detail = resp.data
    # Normalize detail to string when it's a dict/list
    if isinstance(detail, (dict, list)):
        # Prefer 'detail' key if present
        det = detail.get("detail") if isinstance(detail, dict) else None
        detail_str = str(det) if det is not None else str(detail)
    else:
        detail_str = str(detail)

    # Prefer our friendly alias for throttling
    if isinstance(exc, Throttled):
        code = "rate_limited"
    else:
        code = getattr(getattr(exc, "default_code", None), "value", None) or getattr(exc, "default_code", None)
    if not code:
        # Map some common status codes to codes
        code = {
            status.HTTP_400_BAD_REQUEST: "bad_request",
            status.HTTP_401_UNAUTHORIZED: "unauthorized",
            status.HTTP_403_FORBIDDEN: "forbidden",
            status.HTTP_404_NOT_FOUND: "not_found",
            status.HTTP_409_CONFLICT: "conflict",
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
            status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
            status.HTTP_500_INTERNAL_SERVER_ERROR: "server_error",
        }.get(resp.status_code, "error")

    resp.data = {"code": code, "detail": detail_str}
    return resp
