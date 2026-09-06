"""
Stage 7: Extraction Check / Confidence System.

Turns per-page confidence + quality signals into:
  - a document-level confidence score and label
  - a verification report (empty pages, short pages, low-confidence pages)

Deliberately kept separate from "medically verified" — see spec Rule 4.
High OCR confidence means the pixels were legible, not that the content
is clinically correct.
"""
from __future__ import annotations

from typing import List

from .models import ExtractionResult, PageResult, QualityAssessment, VerificationResult

SHORT_PAGE_WORD_THRESHOLD = 3
LOW_CONFIDENCE_PAGE_THRESHOLD = 0.55


def confidence_label(score: float) -> str:
    if score >= 0.85:
        return "High Confidence"
    if score >= 0.6:
        return "Medium Confidence"
    return "Low Confidence"


def compute_document_confidence(pages: List[PageResult], quality: QualityAssessment) -> float:
    if not pages:
        return 0.0

    total_words = sum(max(p.word_count, 1) for p in pages)
    weighted = sum(p.confidence * max(p.word_count, 1) for p in pages) / total_words

    quality_multiplier = {"good": 1.0, "acceptable": 0.93, "poor": 0.8, "unknown": 1.0}.get(
        quality.overall, 1.0
    )

    pages_with_text = sum(1 for p in pages if p.word_count > 0)
    coverage = pages_with_text / len(pages)

    score = weighted * quality_multiplier * (0.7 + 0.3 * coverage)
    return round(max(0.0, min(1.0, score)), 4)


def run_extraction_check(pages: List[PageResult]) -> VerificationResult:
    warnings: List[str] = []
    empty_pages = [p.page_number for p in pages if p.word_count == 0]
    short_pages = [p.page_number for p in pages if 0 < p.word_count <= SHORT_PAGE_WORD_THRESHOLD]
    low_conf_pages = [p.page_number for p in pages if p.confidence < LOW_CONFIDENCE_PAGE_THRESHOLD]

    if empty_pages:
        warnings.append(
            f"No readable text was found on page(s): {', '.join(map(str, empty_pages))}."
        )
    if short_pages:
        warnings.append(
            f"Page(s) {', '.join(map(str, short_pages))} produced suspiciously little text — "
            f"they may be mostly images, blank, or difficult to read."
        )
    if low_conf_pages:
        warnings.append(
            f"Page(s) {', '.join(map(str, low_conf_pages))} were extracted with low confidence "
            f"and should be reviewed against the original."
        )

    suspiciously_short = bool(pages) and all(p.word_count <= SHORT_PAGE_WORD_THRESHOLD for p in pages)
    if suspiciously_short:
        warnings.append(
            "The entire document produced very little text. It may be blank, "
            "image-only without readable content, or extraction failed."
        )

    status = "completed"
    if not pages or all(p.word_count == 0 for p in pages):
        status = "failed"

    return VerificationResult(
        status=status,
        warnings=warnings,
        empty_pages=empty_pages,
        low_confidence_pages=low_conf_pages,
        suspiciously_short=suspiciously_short,
    )


def assemble_full_text(pages: List[PageResult]) -> str:
    if len(pages) == 1:
        return pages[0].text

    parts = []
    for p in pages:
        header = f"========== PAGE {p.page_number} =========="
        body = p.text if p.text.strip() else "[No readable text extracted on this page]"
        parts.append(f"{header}\n\n{body}")
    return "\n\n".join(parts)
