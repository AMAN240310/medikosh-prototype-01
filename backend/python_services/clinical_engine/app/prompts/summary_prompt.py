"""
Stage 4 prompt: turns PRIORITIZED_SAFE_FACTS (stage 3.5's output) into a
doctor-facing clinical summary. Output is plain text in a fixed section
format, not JSON.

Rewritten per the pipeline-optimization spec (this replaces the original
SAFE_VALIDATED_DATA-based prompt): the model now receives a curated,
already-prioritized payload rather than the full SAFE_FACTS set, is told
an explicit target length, an explicit priority order, and explicit
instructions against repetition and against turning a document finding
into a diagnosis. Stage 1's structuring prompt is untouched by this
change - only stage 4 was in scope for a rewrite.
"""
from __future__ import annotations

import json

from app.models.schemas import PrioritizedSafeFacts

SUMMARY_PROMPT_TEMPLATE = """You are a Senior Clinical AI generating a comprehensive, thorough, doctor-facing clinical summary.

Use all the information provided below in PRIORITIZED_DATA. Synthesize both patient-reported symptoms from the voice intake AND all findings from attached medical documents, laboratory reports, pathology results, and clinical notes.

CRITICAL INSTRUCTIONS:
1. Target length: 400 to 700 words. Be thorough, clear, and detailed. Do NOT truncate or omit important clinical facts.
2. Thoroughly synthesize DOCUMENT FINDINGS & INVESTIGATIONS: extract and explicitly detail every laboratory investigation, test name, numerical value with units, reference ranges, and abnormal indicators (e.g. Hemoglobin, Blood Sugar, HbA1c, Liver/Kidney profiles, Lipid profile, Urine analysis, Imaging).
3. Do not invent facts, speculate, or make unconfirmed medical diagnoses. Clearly attribute findings (e.g., "Patient reports...", "Laboratory report indicates...", "Document dated ... shows...").
4. Group related facts together with high clinical clarity. Avoid repetitive phrasing.
5. If information is uncertain, conflicting, or excluded, place it under INFORMATION REQUIRING VERIFICATION.

PRIORITIZED_DATA:
{{PRIORITIZED_DATA}}

Generate the clinical summary using exactly the following structured sections. Omit a section only if there is zero information for it:

PATIENT SUMMARY

CHIEF CONCERN & PRESENTING COMPLAINT
Detailed description of the primary reason for consultation, onset, duration, character, and severity of symptoms.

SYMPTOM ANALYSIS & CLINICAL CONVERSATION
Comprehensive breakdown of all reported symptoms, anatomical site, progression, relieving and aggravating factors, and associated systemic symptoms from the intake conversation.

DOCUMENT FINDINGS & DIAGNOSTIC INVESTIGATIONS
Comprehensive clinical review of all attached medical documents and lab investigations. Detail test names, exact numeric values, units, reference intervals, abnormal flags, imaging impressions, and past clinical findings documented in reports.

PAST MEDICAL & SURGICAL HISTORY
Relevant chronic conditions, past illnesses, surgical history, family history, and lifestyle factors documented or reported.

CURRENT MEDICATIONS & ALLERGIES
List all validated medications with dosage and frequency, along with documented drug allergies, adverse reactions, or NKDA status.

INFORMATION REQUIRING VERIFICATION
Any unverified medications, conflicting patient statements vs documents, or ambiguous facts requiring direct clinician clarification during consultation.

Return only the final clinical summary."""


def build_summary_payload(prioritized: PrioritizedSafeFacts) -> str:
    """Builds the JSON payload stage 4 receives: all safe facts (high, medium,
    and low priority so laboratory investigations and document findings are never
    omitted), validated medicines, excluded information, and conflicts."""
    all_facts = (
        prioritized.high_priority_facts
        + prioritized.medium_priority_facts
        + prioritized.low_priority_facts
    )
    payload: dict = {
        "prioritized_safe_facts": [
            fact.model_dump(exclude_none=True) for fact in all_facts
        ],
        "validated_medicines": [
            med.model_dump(exclude_none=True) for med in prioritized.validated_medicines
        ],
        "excluded_information": [
            item.model_dump(exclude_none=True) for item in prioritized.excluded_information
        ],
        "conflicts": [
            conflict.model_dump(exclude_none=True) for conflict in prioritized.conflicts
        ],
    }
    if prioritized.chief_concern:
        payload["chief_concern"] = prioritized.chief_concern
    return json.dumps(payload, indent=2)


def build_summary_prompt(prioritized_data_json: str) -> str:
    return SUMMARY_PROMPT_TEMPLATE.replace("{{PRIORITIZED_DATA}}", prioritized_data_json)
