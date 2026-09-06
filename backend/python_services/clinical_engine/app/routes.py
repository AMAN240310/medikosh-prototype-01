"""
FastAPI routes exposing each pipeline stage individually, plus a combined
/pipeline/run endpoint that walks the full pipeline (including stage 3.5)
end to end. Mount `router` into an existing FastAPI app (e.g. Module B's
backend) if you'd rather not run this as a standalone service - just bring
the lifespan-managed HTTP clients from app.main along with it.

Endpoint contract note: /pipeline/summary's request body changed from the
previous version. It used to take the full SafeValidatedData; it now takes
PrioritizedSafeFacts, matching the new architecture where stage 4 only
ever sees stage 3.5's curated output. Call /pipeline/prioritize first if
you're starting from raw SAFE_FACTS. Every other endpoint's contract is
unchanged.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.models.schemas import (
    MedicineToValidate,
    PipelineResult,
    PrioritizedSafeFacts,
    RxNormResult,
    SafeValidatedData,
    StructuredExtraction,
)
from app.pipeline import ClinicalPipeline

router = APIRouter(prefix="/pipeline", tags=["clinical-pipeline"])


def get_pipeline(request: Request) -> ClinicalPipeline:
    """FastAPI dependency returning the single, lifespan-managed pipeline
    (app.state.pipeline, set up in app.main's lifespan) rather than
    building a fresh one - and fresh HTTP clients - on every request.
    Override this in tests with app.dependency_overrides to avoid making
    real Gemini/RxNorm calls."""
    return request.app.state.pipeline


class ExtractedTextRequest(BaseModel):
    extracted_text: str
    include_timing: bool = True


class MedicinesRequest(BaseModel):
    medicines: list[MedicineToValidate]


class SafeFactsRequest(BaseModel):
    structured_extraction: StructuredExtraction
    rxnorm_results: list[RxNormResult]


class PrioritizeRequest(BaseModel):
    safe_validated_data: SafeValidatedData


class SummaryRequest(BaseModel):
    prioritized_safe_facts: PrioritizedSafeFacts


@router.post("/run", response_model=PipelineResult)
async def run_full_pipeline(
    payload: ExtractedTextRequest, pipeline: ClinicalPipeline = Depends(get_pipeline)
) -> PipelineResult:
    """Runs the full pipeline end to end: raw text in, validated summary
    out. Prioritization (stage 3.5) always runs automatically before
    summary generation - there's no way to skip straight from SAFE_FACTS
    to an un-prioritized summary through this endpoint."""
    return await pipeline.run(payload.extracted_text, include_timing=payload.include_timing)


@router.post("/structure", response_model=StructuredExtraction)
async def structure_text(
    payload: ExtractedTextRequest, pipeline: ClinicalPipeline = Depends(get_pipeline)
) -> StructuredExtraction:
    """Stage 1 only: raw text -> structured JSON."""
    return await pipeline.structure_extracted_text(payload.extracted_text)


@router.post("/validate-medicines", response_model=list[RxNormResult])
async def validate_medicines(
    payload: MedicinesRequest, pipeline: ClinicalPipeline = Depends(get_pipeline)
) -> list[RxNormResult]:
    """Stage 2 only: medicine names -> RxNorm validation results. An empty
    list returns immediately with no RxNorm calls made."""
    return await pipeline.validate_medicines(payload.medicines)


@router.post("/safe-facts", response_model=SafeValidatedData)
async def safe_facts(
    payload: SafeFactsRequest, pipeline: ClinicalPipeline = Depends(get_pipeline)
) -> SafeValidatedData:
    """Stage 3 only: structured extraction + RxNorm results -> SAFE_FACTS.
    Purely deterministic - does not call Gemini."""
    return pipeline.build_safe_facts(payload.structured_extraction, payload.rxnorm_results)


@router.post("/prioritize", response_model=PrioritizedSafeFacts)
async def prioritize(
    payload: PrioritizeRequest, pipeline: ClinicalPipeline = Depends(get_pipeline)
) -> PrioritizedSafeFacts:
    """Stage 3.5 only: SAFE_FACTS -> PRIORITIZED_SAFE_FACTS. Purely
    deterministic - does not call Gemini. Optional to call directly:
    /pipeline/run already performs this automatically before generating
    the summary."""
    return pipeline.prioritize(payload.safe_validated_data)


@router.post("/summary")
async def summary(
    payload: SummaryRequest, pipeline: ClinicalPipeline = Depends(get_pipeline)
) -> str:
    """Stage 4 only: PRIORITIZED_SAFE_FACTS -> doctor-facing clinical
    summary text."""
    return await pipeline.generate_summary(payload.prioritized_safe_facts)
