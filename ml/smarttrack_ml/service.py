"""Authenticated, bounded HTTP adapter for the separately deployed ML service."""

from __future__ import annotations

import hmac
import json
import os
from pathlib import Path
from typing import Any, Mapping

from .model import ArtifactError, ModelArtifact, load_artifact
from .scoring import score_telemetry


DEFAULT_MAX_BODY_BYTES = 64 * 1024


def _bearer(authorization: str | None) -> str | None:
    if not isinstance(authorization, str):
        return None
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token or " " in token:
        return None
    return token


class InferenceService:
    """Framework-neutral service core used by FastAPI and dependency-free tests."""

    def __init__(
        self,
        *,
        shared_secret: str | None,
        artifact: ModelArtifact | None = None,
        max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
        production: bool = True,
    ) -> None:
        if isinstance(max_body_bytes, bool) or not isinstance(max_body_bytes, int) or max_body_bytes <= 0:
            raise ValueError("max_body_bytes must be a positive integer")
        self.shared_secret = shared_secret
        self.artifact = artifact
        self.max_body_bytes = max_body_bytes
        self.production = production

    def _authenticate(self, authorization: str | None) -> tuple[bool, int, str]:
        if not isinstance(self.shared_secret, str) or not self.shared_secret:
            return False, 503, "ml_auth_unconfigured"
        token = _bearer(authorization)
        if token is None or not hmac.compare_digest(token.encode("utf-8"), self.shared_secret.encode("utf-8")):
            return False, 401, "unauthorized"
        return True, 200, "ok"

    def handle_request(self, body: bytes | str | Mapping[str, Any], *, authorization: str | None) -> tuple[int, dict[str, Any]]:
        authenticated, status, reason = self._authenticate(authorization)
        if not authenticated:
            return status, {"available": False, "error": reason}
        if isinstance(body, bytes):
            if len(body) > self.max_body_bytes:
                return 413, {"available": False, "error": "request_too_large"}
            try:
                payload = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return 400, {"available": False, "error": "invalid_json"}
        elif isinstance(body, str):
            encoded = body.encode("utf-8")
            if len(encoded) > self.max_body_bytes:
                return 413, {"available": False, "error": "request_too_large"}
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                return 400, {"available": False, "error": "invalid_json"}
        elif isinstance(body, Mapping):
            payload = body
            try:
                if len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) > self.max_body_bytes:
                    return 413, {"available": False, "error": "request_too_large"}
            except (TypeError, ValueError):
                return 400, {"available": False, "error": "invalid_json"}
        else:
            return 400, {"available": False, "error": "invalid_json"}
        if not isinstance(payload, Mapping):
            return 422, {"available": False, "error": "request_schema_invalid"}
        record = payload.get("record", payload.get("current"))
        previous = payload.get("previous")
        if not isinstance(record, Mapping) or (previous is not None and not isinstance(previous, Mapping)):
            return 422, {"available": False, "error": "request_schema_invalid"}
        result = score_telemetry(record, previous, self.artifact, production=self.production)
        if not result.get("available"):
            return 503, result
        return 200, result


def configured_service_from_environment() -> InferenceService:
    """Build the fail-closed default service from deployment environment."""
    secret = os.environ.get("SMARTTRACK_ML_SHARED_SECRET")
    artifact: ModelArtifact | None = None
    path = os.environ.get("SMARTTRACK_MODEL_PATH")
    digest = os.environ.get("SMARTTRACK_MODEL_SHA256")
    if path and digest:
        try:
            artifact = load_artifact(path, expected_sha256=digest, trusted=True)
        except (ArtifactError, OSError, ValueError):
            artifact = None
    try:
        max_body = int(os.environ.get("SMARTTRACK_MAX_BODY_BYTES", str(DEFAULT_MAX_BODY_BYTES)))
    except ValueError:
        max_body = DEFAULT_MAX_BODY_BYTES
    return InferenceService(shared_secret=secret, artifact=artifact, max_body_bytes=max_body)


def create_app(service: InferenceService | None = None) -> Any:
    """Create the optional FastAPI app; importing the package does not need FastAPI."""
    try:
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse
    except ImportError as exc:
        raise RuntimeError("FastAPI is required to create the HTTP app") from exc
    instance = service or configured_service_from_environment()
    app = FastAPI(title="SmartTrack ML", docs_url=None, redoc_url=None)

    @app.post("/score")
    async def score(request: Request) -> Any:
        authorization = request.headers.get("authorization")
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > instance.max_body_bytes:
                    return JSONResponse(status_code=413, content={"available": False, "error": "request_too_large"})
            except ValueError:
                return JSONResponse(status_code=400, content={"available": False, "error": "invalid_content_length"})
        chunks: list[bytes] = []
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > instance.max_body_bytes:
                return JSONResponse(status_code=413, content={"available": False, "error": "request_too_large"})
            chunks.append(chunk)
        status, result = instance.handle_request(b"".join(chunks), authorization=authorization)
        return JSONResponse(status_code=status, content=result)

    @app.get("/health")
    async def health() -> Any:
        # Deliberately does not claim model readiness or expose artifact details.
        return {"service": "smarttrack-ml", "available": instance.artifact is not None}

    return app


app = None
try:  # Keep module importable in the dependency-free firmware/web test image.
    if os.environ.get("SMARTTRACK_CREATE_APP") == "1":
        app = create_app()
except RuntimeError:
    app = None


__all__ = ["DEFAULT_MAX_BODY_BYTES", "InferenceService", "app", "configured_service_from_environment", "create_app"]
