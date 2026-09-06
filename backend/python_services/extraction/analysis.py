"""
Stage 2: Document Analysis.

Determines what kind of input we're dealing with, and — critically —
decides whether a PDF has enough embedded text to skip OCR entirely.

Routing rule (per spec section 5):
  - PDF with meaningful embedded text  -> direct text extraction path
  - PDF with little/no embedded text   -> OCR path (treated as "scanned")
  - Image                              -> OCR path
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

import pymupdf

from .models import AnalysisResult, DocumentKind

# A page is considered to have "meaningful" embedded text if it has at
# least this many non-whitespace characters. Below this, PDFs are usually
# either blank pages or scanned images with no text layer at all.
MIN_CHARS_PER_PAGE_FOR_DIRECT_TEXT = 40
# Fraction of pages that must clear the threshold for us to trust the
# whole document to the direct-text path rather than routing to OCR.
MIN_PAGE_FRACTION_WITH_TEXT = 0.6


@dataclass
class PageAnalysis:
    page_number: int
    char_count: int
    has_text: bool


def analyze_pdf(data: bytes) -> tuple[AnalysisResult, List[PageAnalysis]]:
    doc = pymupdf.open(stream=data, filetype="pdf")
    page_analyses: List[PageAnalysis] = []
    total_chars = 0

    for i, page in enumerate(doc):
        text = page.get_text("text") or ""
        chars = len(text.strip())
        total_chars += chars
        page_analyses.append(
            PageAnalysis(
                page_number=i + 1,
                char_count=chars,
                has_text=chars >= MIN_CHARS_PER_PAGE_FOR_DIRECT_TEXT,
            )
        )

    pages_with_text = sum(1 for p in page_analyses if p.has_text)
    fraction_with_text = pages_with_text / len(page_analyses) if page_analyses else 0

    has_embedded_text = fraction_with_text >= MIN_PAGE_FRACTION_WITH_TEXT
    kind = DocumentKind.DIGITAL_PDF if has_embedded_text else DocumentKind.SCANNED_PDF

    doc.close()

    result = AnalysisResult(
        document_kind=kind.value,
        pages=len(page_analyses),
        has_embedded_text=has_embedded_text,
        embedded_text_chars=total_chars,
    )
    return result, page_analyses


def analyze_image() -> AnalysisResult:
    return AnalysisResult(
        document_kind=DocumentKind.IMAGE.value,
        pages=1,
        has_embedded_text=False,
        embedded_text_chars=0,
    )
