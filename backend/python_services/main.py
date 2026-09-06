"""
Unified Python Engine for MediCare Patient Portal.
Combines:
  1. OCR & Document Extraction (PyMuPDF, OpenCV, Tesseract)
  2. Clinical Structuring & Validation Pipeline (Gemini, RxNorm, SAFE_FACTS)
  3. Smart Scheduling & Conflict-Free Slot Generation (Timezone-aware Asia/Kolkata)
"""
from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, List
from dotenv import load_dotenv

# Ensure .env is loaded from python_services root
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
load_dotenv()

# Ensure clinical_engine is in sys.path so its internal `import app...` works seamlessly
CLINICAL_DIR = Path(__file__).resolve().parent / "clinical_engine"
if str(CLINICAL_DIR) not in sys.path:
    sys.path.insert(0, str(CLINICAL_DIR))

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import extraction engine
from extraction.service import extract_text_from_bytes

# Import clinical pipeline components
from app.config import get_settings as get_clinical_settings
from app.pipeline import ClinicalPipeline
from app.routes import router as clinical_router
from app.services.gemini_client import GeminiClient
from app.services.rxnorm_service import RxNormService

# Import scheduler engine
from scheduler.models import SchedulingRequest, SchedulingResponse
from scheduler.scheduler import find_best_doctor_and_slot


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_clinical_settings()
    timeout = settings.request_timeout_seconds
    gemini_http_client = httpx.AsyncClient(timeout=timeout)
    rxnorm_http_client = httpx.AsyncClient(timeout=timeout)

    gemini_client = GeminiClient(
        api_keys=settings.gemini_api_keys,
        model=settings.gemini_model,
        http_client=gemini_http_client,
        timeout=timeout,
    )
    rxnorm_service = RxNormService(
        base_url=settings.rxnorm_base_url,
        http_client=rxnorm_http_client,
        timeout=timeout,
    )
    app.state.pipeline = ClinicalPipeline(gemini_client, rxnorm_service)

    yield

    await gemini_http_client.aclose()
    await rxnorm_http_client.aclose()


app = FastAPI(
    title="MediCare Patient Portal - Unified Python Services",
    description="Unified API hosting OCR, Clinical Reasoning, and Doctor Slot Scheduling engines.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# 1. Document Extraction Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/extract/file")
async def extract_file(file: UploadFile = File(...)):
    """Extract full text from a single uploaded PDF or image."""
    try:
        content = await file.read()
        res = extract_text_from_bytes(file.filename or "uploaded_file", file.content_type or "application/octet-stream", content)
        return {
            "success": True,
            "filename": res.filename,
            "file_type": res.file_type,
            "document_kind": res.document_kind,
            "page_count": res.page_count,
            "extracted_text": res.full_text,
            "overall_confidence": res.overall_confidence,
            "warnings": res.warnings,
        }
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"File extraction failed: {exc}") from exc


@app.post("/api/extract/batch")
async def extract_batch(files: List[UploadFile] = File(...)):
    """Extract full text from multiple files and combine with headers."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    combined_parts = []
    file_summaries = []

    for f in files:
        content = await f.read()
        try:
            res = extract_text_from_bytes(f.filename or "file", f.content_type or "application/octet-stream", content)
            header = f"===== FILE: {res.filename} ({res.document_kind}) ====="
            body = res.full_text.strip() if res.full_text.strip() else "[No readable text extracted]"
            combined_parts.append(f"{header}\n\n{body}")
            file_summaries.append({
                "filename": res.filename,
                "confidence": res.overall_confidence,
                "page_count": res.page_count,
                "warnings": res.warnings,
            })
        except Exception as exc:
            combined_parts.append(f"===== FILE: {f.filename} =====\n\n[Extraction Error: {exc}]")
            file_summaries.append({"filename": f.filename, "error": str(exc)})

    return {
        "success": True,
        "combined_text": "\n\n".join(combined_parts),
        "files": file_summaries,
    }


# ---------------------------------------------------------------------------
# 2. Clinical Pipeline Endpoints (Mounted)
# ---------------------------------------------------------------------------
app.include_router(clinical_router)


# ---------------------------------------------------------------------------
# 3. Doctor Scheduling Endpoints
# ---------------------------------------------------------------------------
@app.post("/api/schedule", response_model=SchedulingResponse)
@app.post("/schedule", response_model=SchedulingResponse)
def schedule_appointment(request: SchedulingRequest) -> SchedulingResponse:
    """Finds the conflict-free, earliest suitable doctor and time slot in Asia/Kolkata."""
    try:
        return find_best_doctor_and_slot(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "medicare-python-engines",
        "engines": ["ocr-extraction", "clinical-pipeline", "scheduler"],
    }
