"""
Orchestrates the full pipeline:

  1. Gemini structures raw extracted text (documents + voice transcripts)
  2. RxNorm validates every medicine name Gemini pulled out (skipped
     entirely if there are none)
  3. Backend validation fuses both into SAFE_FACTS (deterministic, no LLM)
  3.5. Deterministic relevance prioritization -> PRIORITIZED_SAFE_FACTS
       (deterministic, no LLM)
  4. Gemini turns PRIORITIZED_SAFE_FACTS into a doctor-facing summary

Stages 1 and 4 are the only two that touch an LLM - that was true before
this pass and stays true after it. Stage 4 only ever sees stage 3.5's
output (high + medium priority facts, validated medicines, excluded
information, conflicts) - never the raw text, never low-priority facts,
and never anything stage 3 excluded.
"""
from __future__ import annotations

import time

from app.models.schemas import (
    MedicineToValidate,
    PipelineResult,
    PipelineTiming,
    PrioritizedSafeFacts,
    RxNormResult,
    SafeValidatedData,
    StructuredExtraction,
)
from app.prompts.response_schema import STRUCTURING_RESPONSE_SCHEMA
from app.prompts.structuring_prompt import build_structuring_prompt
from app.prompts.summary_prompt import build_summary_payload, build_summary_prompt
from app.services.gemini_client import GeminiClient
from app.services.prioritization_service import prioritize_safe_facts as _prioritize_safe_facts
from app.services.rxnorm_service import RxNormService
from app.services.validation_service import build_safe_facts as _build_safe_facts


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


class ClinicalPipeline:
    def __init__(self, gemini_client: GeminiClient, rxnorm_service: RxNormService):
        self.gemini_client = gemini_client
        self.rxnorm_service = rxnorm_service

    async def aclose(self) -> None:
        """Closes any HTTP clients this pipeline's services own. A no-op
        for clients that were injected (e.g. FastAPI's lifespan-managed,
        shared clients) rather than created internally."""
        await self.gemini_client.aclose()
        await self.rxnorm_service.aclose()

    async def structure_extracted_text(self, extracted_text: str) -> StructuredExtraction:
        prompt = build_structuring_prompt(extracted_text)
        raw = await self.gemini_client.generate_json(
            prompt, response_schema=STRUCTURING_RESPONSE_SCHEMA, temperature=0.0
        )
        return StructuredExtraction.model_validate(raw)

    async def validate_medicines(
        self, medicines: list[MedicineToValidate]
    ) -> list[RxNormResult]:
        return await self.rxnorm_service.validate_many(medicines)

    def build_safe_facts(
        self, structured: StructuredExtraction, rxnorm_results: list[RxNormResult]
    ) -> SafeValidatedData:
        return _build_safe_facts(structured, rxnorm_results)

    def prioritize(self, safe_data: SafeValidatedData) -> PrioritizedSafeFacts:
        return _prioritize_safe_facts(safe_data)

    async def generate_summary(self, prioritized: PrioritizedSafeFacts) -> str:
        payload = build_summary_payload(prioritized)
        prompt = build_summary_prompt(payload)
        return await self.gemini_client.generate_text(prompt, temperature=0.2)

    async def run(self, extracted_text: str, include_timing: bool = True) -> PipelineResult:
        total_start = time.perf_counter()

        start = time.perf_counter()
        structured = await self.structure_extracted_text(extracted_text)
        structuring_ms = _elapsed_ms(start)

        start = time.perf_counter()
        rxnorm_results = await self.validate_medicines(structured.medicines_to_validate)
        medicine_validation_ms = _elapsed_ms(start)

        start = time.perf_counter()
        safe_data = self.build_safe_facts(structured, rxnorm_results)
        deterministic_validation_ms = _elapsed_ms(start)

        start = time.perf_counter()
        prioritized = self.prioritize(safe_data)
        prioritization_ms = _elapsed_ms(start)

        start = time.perf_counter()
        summary = await self.generate_summary(prioritized)
        summary_generation_ms = _elapsed_ms(start)

        timing = None
        if include_timing:
            timing = PipelineTiming(
                structuring_ms=structuring_ms,
                medicine_validation_ms=medicine_validation_ms,
                deterministic_validation_ms=deterministic_validation_ms,
                prioritization_ms=prioritization_ms,
                summary_generation_ms=summary_generation_ms,
                total_ms=_elapsed_ms(total_start),
            )

        return PipelineResult(
            structured_extraction=structured,
            rxnorm_results=rxnorm_results,
            safe_validated_data=safe_data,
            prioritized_safe_facts=prioritized,
            clinical_summary=summary,
            timing=timing,
        )
