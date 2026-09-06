from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

import cv2
import pymupdf

from . import analysis, confidence, extraction, preprocessing, quality, validation
from .models import DocumentKind, ExtractionMethod, PageResult

logger = logging.getLogger("extraction_service")


@dataclass
class DocumentExtractionOutput:
    filename: str
    file_type: str
    document_kind: str
    page_count: int
    full_text: str
    overall_confidence: float
    warnings: List[str]


def extract_text_from_bytes(filename: str, content_type: str, data: bytes) -> DocumentExtractionOutput:
    """Synchronous pipeline that turns raw file bytes (PDF, PNG, JPG) into clean extracted text.

    Uses PyMuPDF direct parser for digital PDFs, and OpenCV + Tesseract OCR for scans/images.
    """
    outcome = validation.validate_upload(filename, content_type, data)
    file_ext = outcome.file_ext
    warnings: List[str] = list(outcome.warnings or [])

    if file_ext == "pdf":
        analysis_result, _ = analysis.analyze_pdf(data)
    else:
        analysis_result = analysis.analyze_image()

    needs_ocr = analysis_result.document_kind in (DocumentKind.SCANNED_PDF.value, DocumentKind.IMAGE.value)
    page_results: List[PageResult] = []

    if not needs_ocr:
        # Fast direct extraction for digital PDFs
        page_results = extraction.extract_direct_text(data)
    else:
        # OCR Path
        page_images = []
        if file_ext == "pdf":
            pdf_doc = pymupdf.open(stream=data, filetype="pdf")
            for i in range(pdf_doc.page_count):
                img = extraction.pdf_page_to_image(pdf_doc, i)
                page_images.append((i + 1, img))
            pdf_doc.close()
        else:
            img = extraction.bytes_to_image(data)
            page_images.append((1, img))

        # Check quality and preprocess
        for page_number, original_img in page_images:
            q_assess = quality.assess_quality(original_img)
            if q_assess.overall == "poor":
                warnings.append(f"Page {page_number} had image quality warnings (blur/contrast).")

            processed_img, _ = preprocessing.preprocess_page(original_img)
            try:
                text, conf, word_count = extraction.ocr_image(processed_img)
            except extraction.OcrTimeoutError:
                text, conf, word_count = "", 0.0, 0
                warnings.append(f"OCR timed out on page {page_number}.")

            handwriting_suspected = extraction.looks_like_handwriting(q_assess.overall, conf, word_count)
            if handwriting_suspected:
                warnings.append(f"Page {page_number} text appears to be handwritten.")

            page_results.append(
                PageResult(
                    page_number=page_number,
                    text=text,
                    confidence=round(conf, 4),
                    method=ExtractionMethod.OCR.value,
                    word_count=word_count,
                    low_confidence=conf < confidence.LOW_CONFIDENCE_PAGE_THRESHOLD,
                    warnings=[],
                )
            )

    full_text = confidence.assemble_full_text(page_results)
    overall_conf = confidence.compute_document_confidence(
        page_results, quality.QualityAssessment(overall="good") if not needs_ocr else quality.assess_quality(page_images[0][1])
    )

    return DocumentExtractionOutput(
        filename=filename,
        file_type=file_ext,
        document_kind=analysis_result.document_kind,
        page_count=len(page_results),
        full_text=full_text,
        overall_confidence=overall_conf,
        warnings=warnings,
    )
