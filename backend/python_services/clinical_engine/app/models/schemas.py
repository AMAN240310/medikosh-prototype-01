"""
Pydantic models for every stage of the clinical structuring & validation
pipeline:

  1. StructuredExtraction  -> output of the Gemini structuring prompt
  2. RxNormResult          -> output of RxNorm medicine validation
  3. SafeValidatedData     -> output of backend validation (SAFE_FACTS)
  4. (stage 4's output is plain text, not JSON -> no model needed for it)
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SourceType(str, Enum):
    VOICE = "VOICE"
    DOCUMENT = "DOCUMENT"


class PriorityTier(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


# ---------------------------------------------------------------------------
# Stage 1 - Gemini structuring output
# ---------------------------------------------------------------------------

class MedicineToValidate(BaseModel):
    raw_name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    evidence: str


class PatientReported(BaseModel):
    symptoms: list[str] = Field(default_factory=list)
    medical_history: list[str] = Field(default_factory=list)
    current_medications: list[str] = Field(default_factory=list)


class DocumentExtracted(BaseModel):
    findings: list[str] = Field(default_factory=list)
    medical_history: list[str] = Field(default_factory=list)
    medications: list[str] = Field(default_factory=list)


class Fact(BaseModel):
    field: str
    value: Optional[str] = None
    source_type: SourceType
    evidence: str


class StructuredExtraction(BaseModel):
    patient_reported: PatientReported = Field(default_factory=PatientReported)
    document_extracted: DocumentExtracted = Field(default_factory=DocumentExtracted)
    medicines_to_validate: list[MedicineToValidate] = Field(default_factory=list)
    uncertain_information: list[str] = Field(default_factory=list)
    facts: list[Fact] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Stage 2 - RxNorm validation output
# ---------------------------------------------------------------------------

class RxNormStatus(str, Enum):
    VALID = "VALID"
    UNVERIFIED = "UNVERIFIED"


class RxNormResult(BaseModel):
    raw_name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    evidence: Optional[str] = None
    exists_in_rxnorm: bool
    validated_name: Optional[str] = None
    status: RxNormStatus
    rxcui: Optional[str] = None
    # A possible approximate match, surfaced ONLY for human review. Per spec
    # this is never auto-applied as validated_name - "do not silently
    # correct the medicine name".
    suggested_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Stage 3 - backend validation output (SAFE_FACTS)
# ---------------------------------------------------------------------------

class SafeFact(BaseModel):
    field: str
    value: str
    evidence: str
    source_type: SourceType


class ValidatedMedicine(BaseModel):
    name: str
    dosage: Optional[str] = None
    status: RxNormStatus
    evidence: Optional[str] = None


class ExcludedInformation(BaseModel):
    field: str
    reason: str
    detail: Optional[str] = None


class ConflictingValue(BaseModel):
    value: str
    source_type: SourceType
    evidence: str


class ConflictRecord(BaseModel):
    field: str
    description: str
    conflicting_values: list[ConflictingValue]


class SafeValidatedData(BaseModel):
    safe_facts: list[SafeFact] = Field(default_factory=list)
    validated_medicines: list[ValidatedMedicine] = Field(default_factory=list)
    excluded_information: list[ExcludedInformation] = Field(default_factory=list)
    conflicts: list[ConflictRecord] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Stage 3.5 - deterministic relevance prioritization output
# (PRIORITIZED_SAFE_FACTS - never touches an LLM, never invents anything;
# it only re-tiers and re-orders facts that are already in SAFE_FACTS)
# ---------------------------------------------------------------------------

class PrioritizedFact(BaseModel):
    field: str
    value: str
    evidence: str
    source_type: SourceType
    tier: PriorityTier


class PrioritizedSafeFacts(BaseModel):
    # The identified current presenting problem, if one could be found
    # among the safe facts (e.g. a chief_complaint fact, or failing that
    # the first symptom fact). Never invented - null if nothing usable
    # was present to identify it from.
    chief_concern: Optional[str] = None
    high_priority_facts: list[PrioritizedFact] = Field(default_factory=list)
    medium_priority_facts: list[PrioritizedFact] = Field(default_factory=list)
    # Kept for inspection only - deliberately never sent to stage 4.
    low_priority_facts: list[PrioritizedFact] = Field(default_factory=list)
    validated_medicines: list[ValidatedMedicine] = Field(default_factory=list)
    excluded_information: list[ExcludedInformation] = Field(default_factory=list)
    conflicts: list[ConflictRecord] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Full pipeline result (stages 1-4 bundled together)
# ---------------------------------------------------------------------------

class PipelineTiming(BaseModel):
    structuring_ms: float
    medicine_validation_ms: float
    deterministic_validation_ms: float
    prioritization_ms: float
    summary_generation_ms: float
    total_ms: float


class PipelineResult(BaseModel):
    structured_extraction: StructuredExtraction
    rxnorm_results: list[RxNormResult]
    safe_validated_data: SafeValidatedData
    prioritized_safe_facts: PrioritizedSafeFacts
    clinical_summary: str
    # Optional so existing consumers that only look at the fields above
    # are unaffected; omitted entirely (not just null) when timing capture
    # is turned off - see ClinicalPipeline.run(include_timing=...).
    timing: Optional[PipelineTiming] = None
