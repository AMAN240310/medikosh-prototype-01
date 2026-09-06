"""
Data models for the Medical Document Collection & Extraction module.

These mirror the data model sketched in the product spec (Section 16),
kept deliberately flat and JSON-serializable so the same shape can be
persisted to disk for the demo and returned directly by the API.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProcessingStage(str, Enum):
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    VALIDATED = "validated"
    ANALYZING = "analyzing"
    ANALYZED = "analyzed"
    QUALITY_CHECK = "quality_check"
    QUALITY_CHECKED = "quality_checked"
    AWAITING_USER_DECISION = "awaiting_user_decision"
    CLASSIFYING = "classifying"
    CLASSIFIED = "classified"
    PREPROCESSING = "preprocessing"
    PREPROCESSED = "preprocessed"
    EXTRACTING = "extracting"
    EXTRACTED = "extracted"
    CHECKING_EXTRACTION = "checking_extraction"
    COMPLETE = "complete"
    FAILED = "failed"


class DocumentKind(str, Enum):
    DIGITAL_PDF = "digital_pdf"
    SCANNED_PDF = "scanned_pdf"
    IMAGE = "image"
    UNKNOWN = "unknown"


class Classification(str, Enum):
    PRESCRIPTION = "Prescription"
    LAB_REPORT = "Lab Report"
    DISCHARGE_SUMMARY = "Discharge Summary"
    RADIOLOGY_REPORT = "Radiology Report"
    GENERAL_MEDICAL_DOCUMENT = "General Medical Document"
    UNKNOWN = "Unknown"


class ExtractionMethod(str, Enum):
    DIRECT_TEXT = "direct_text"
    OCR = "ocr"
    VISION_AI = "vision_ai"
    MIXED = "mixed"
    NONE = "none"


@dataclass
class ProcessingStep:
    key: str
    label: str
    status: str = "pending"  # pending | active | done | failed | skipped
    detail: Optional[str] = None


@dataclass
class QualityIssue:
    code: str
    message: str
    severity: str = "warning"  # info | warning | error


@dataclass
class QualityAssessment:
    resolution: str = "unknown"
    blur: str = "unknown"
    brightness: str = "unknown"
    contrast: str = "unknown"
    rotation_degrees: float = 0.0
    rotation: str = "unknown"
    overall: str = "unknown"  # good | acceptable | poor
    issues: List[QualityIssue] = field(default_factory=list)
    metrics: Dict[str, float] = field(default_factory=dict)


@dataclass
class PageResult:
    page_number: int
    text: str
    confidence: float
    method: str
    warnings: List[str] = field(default_factory=list)
    word_count: int = 0
    low_confidence: bool = False
    source_image_path: Optional[str] = None
    processed_image_path: Optional[str] = None


@dataclass
class ExtractionResult:
    method: str = ExtractionMethod.NONE.value
    overall_confidence: float = 0.0
    pages: List[PageResult] = field(default_factory=list)
    full_text: str = ""


@dataclass
class VerificationResult:
    status: str = "pending"  # pending | completed | failed
    warnings: List[str] = field(default_factory=list)
    empty_pages: List[int] = field(default_factory=list)
    low_confidence_pages: List[int] = field(default_factory=list)
    suspiciously_short: bool = False


@dataclass
class AnalysisResult:
    document_kind: str = DocumentKind.UNKNOWN.value
    pages: int = 0
    has_embedded_text: bool = False
    embedded_text_chars: int = 0
    classification: str = Classification.UNKNOWN.value
    classification_signals: List[str] = field(default_factory=list)


@dataclass
class MedicalDocument:
    document_id: str
    original_filename: str
    file_type: str
    stored_path: str
    file_size_bytes: int
    file_hash: str
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    stage: str = ProcessingStage.UPLOADED.value
    steps: List[ProcessingStep] = field(default_factory=list)
    error: Optional[str] = None

    analysis: AnalysisResult = field(default_factory=AnalysisResult)
    quality: QualityAssessment = field(default_factory=QualityAssessment)
    extraction: ExtractionResult = field(default_factory=ExtractionResult)
    verification: VerificationResult = field(default_factory=VerificationResult)

    user_edited_text: Optional[str] = None
    user_edits: bool = False
    duplicate_of: Optional[str] = None
    accept_low_quality: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def touch(self) -> None:
        self.updated_at = now_iso()


PIPELINE_STEP_DEFS = [
    ("validate", "File validated"),
    ("analyze", "Document analyzed"),
    ("quality", "Quality checked"),
    ("classify", "Document classified"),
    ("preprocess", "Pages prepared"),
    ("extract", "Extracting text"),
    ("check", "Checking extraction"),
    ("finalize", "Preparing final output"),
]


def fresh_steps() -> List[ProcessingStep]:
    return [ProcessingStep(key=k, label=label) for k, label in PIPELINE_STEP_DEFS]


@dataclass
class DocumentBatch:
    """A group of documents uploaded together and combined into one text
    output once every member document finishes processing. Each member
    still goes through the exact same single-document pipeline — this is
    purely a grouping + combining layer on top, so per-document validation,
    quality gates, OCR, etc. all behave identically to a solo upload."""

    batch_id: str
    document_ids: List[str]
    label: str = ""
    created_at: str = field(default_factory=now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
