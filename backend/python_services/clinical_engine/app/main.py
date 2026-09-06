"""
Standalone FastAPI app for the SIH 26047 clinical structuring & validation
pipeline. Mount `router` from app.routes into an existing FastAPI app
instead if you'd rather fold this into Module B's backend directly (you'll
want to replicate the lifespan below too, so Gemini/RxNorm HTTP clients
get reused rather than recreated per request).

Run with:  uvicorn app.main:app --reload
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.pipeline import ClinicalPipeline
from app.routes import router
from app.services.gemini_client import GeminiCallError, GeminiClient
from app.services.rxnorm_service import RxNormService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Creates one Gemini HTTP client and one RxNorm HTTP client for the
    whole app's lifetime, instead of a new httpx.AsyncClient per request.
    Both are closed cleanly on shutdown."""
    settings = get_settings()
    gemini_http_client = httpx.AsyncClient(timeout=settings.request_timeout_seconds)
    rxnorm_http_client = httpx.AsyncClient(timeout=settings.request_timeout_seconds)

    gemini_client = GeminiClient(
        api_keys=settings.gemini_api_keys,
        model=settings.gemini_model,
        http_client=gemini_http_client,
        timeout=settings.request_timeout_seconds,
    )
    rxnorm_service = RxNormService(
        base_url=settings.rxnorm_base_url,
        http_client=rxnorm_http_client,
        timeout=settings.request_timeout_seconds,
    )
    app.state.pipeline = ClinicalPipeline(gemini_client, rxnorm_service)

    yield

    await gemini_http_client.aclose()
    await rxnorm_http_client.aclose()


app = FastAPI(
    title="SIH 26047 - Clinical Structuring & Validation Pipeline",
    description=(
        "Turns extracted document text and voice-intake transcripts into a "
        "validated, evidence-linked clinical summary for doctor review."
    ),
    version="0.2.0",
    lifespan=lifespan,
)
app.include_router(router)


@app.exception_handler(GeminiCallError)
async def gemini_call_error_handler(request: Request, exc: GeminiCallError) -> JSONResponse:
    # An upstream failure, not a bug in this service - 502 with the same
    # clear, key-redacted detail GeminiCallError already carries, instead
    # of an unhandled 500 traceback.
    return JSONResponse(
        status_code=502,
        content={"error": "gemini_request_failed", "model": exc.model, "detail": str(exc)},
    )


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
