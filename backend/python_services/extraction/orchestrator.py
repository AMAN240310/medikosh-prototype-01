"""
Runs the full pipeline for one document, mutating and persisting the
MedicalDocument record as it goes so that GET /api/documents/{id} always
reflects live progress (Section 19: Processing Status).

Stage ordering follows the architecture diagram in the spec:

    validate -> analyze -> quality -> classify -> preprocess -> extract -> check -> finalize

One deliberate deviation, called out here rather than hidden: true
"classify before extract" is only free for digital PDFs, where direct
text extraction is cheap enough to just run early. For scanned PDFs and
images, classification instead runs a fast, low-resolution, single-page
OCR pass purely to get keyword signal — it is discarded afterwards and
never reused as the final extracted text, which still comes from the
full-resolution extraction stage later in the pipeline. This keeps
classification's place in the pipeline honest without ever letting a
throwaway low-quality pass contaminate the real output.
"""
from __future__ import annotations

import logging
import traceback
from pathlib import Path

import cv2
import pymupdf

from app.models import (
    DocumentKind,
    ExtractionMethod,
    MedicalDocument,
    ProcessingStage,
)
from app.pipeline import analysis, classification, confidence, extraction, preprocessing, quality
from app.pipeline.extraction import (
    bytes_to_image,
    ocr_image,
    pdf_page_to_image,
    vision_ai_available,
    vision_ai_transcribe,
)
from app.storage import store

logger = logging.getLogger("pipeline")

QUICK_CLASSIFY_DPI = 110


def _step(doc: MedicalDocument, key: str, status: str, detail: str | None = None) -> None:
    for s in doc.steps:
        if s.key == key:
            s.status = status
            s.detail = detail
            break
    doc.touch()
    store.save(doc)


def _fail(doc: MedicalDocument, key: str, message: str) -> None:
    _step(doc, key, "failed", message)
    doc.stage = ProcessingStage.FAILED.value
    doc.error = message
    doc.touch()
    store.save(doc)


def run_pipeline(document_id: str) -> None:
    doc = store.get(document_id)
    if doc is None:
        logger.error("run_pipeline: document %s not found", document_id)
        return

    try:
        _run(doc)
    except Exception as exc:  # last-resort guard: never leave a doc stuck "processing"
        logger.exception("Pipeline crashed for %s", document_id)
        doc.error = f"Unexpected processing error: {exc}"
        doc.stage = ProcessingStage.FAILED.value
        for s in doc.steps:
            if s.status in ("pending", "active"):
                s.status = "failed"
        doc.touch()
        store.save(doc)


def _run(doc: MedicalDocument) -> None:
    original_path = Path(doc.stored_path)
    data = original_path.read_bytes()
    doc_dir = store.doc_dir(doc.document_id)

    # ---- validate (already performed synchronously at upload time) ----
    _step(doc, "validate", "done")

    # ---- analyze ----
    doc.stage = ProcessingStage.ANALYZING.value
    _step(doc, "analyze", "active")

    if doc.file_type == "pdf":
        analysis_result, page_analyses = analysis.analyze_pdf(data)
    else:
        analysis_result = analysis.analyze_image()
        page_analyses = None

    doc.analysis = analysis_result
    doc.stage = ProcessingStage.ANALYZED.value
    _step(
        doc,
        "analyze",
        "done",
        f"{analysis_result.pages} page(s) \u00b7 {analysis_result.document_kind.replace('_', ' ')}",
    )

    needs_ocr = analysis_result.document_kind in (DocumentKind.SCANNED_PDF.value, DocumentKind.IMAGE.value)

    # ---- quality check ----
    doc.stage = ProcessingStage.QUALITY_CHECK.value
    _step(doc, "quality", "active")

    page_images: list = []  # list of (page_number, original_bgr_image)

    if needs_ocr:
        if doc.file_type == "pdf":
            pdf_doc = pymupdf.open(stream=data, filetype="pdf")
            for i in range(pdf_doc.page_count):
                img = pdf_page_to_image(pdf_doc, i)
                page_images.append((i + 1, img))
            pdf_doc.close()
        else:
            img = bytes_to_image(data)
            page_images.append((1, img))

        # Assess quality per page, keep the worst-case as the document-level rating
        assessments = [quality.assess_quality(img) for _, img in page_images]
        severity_rank = {"good": 0, "acceptable": 1, "poor": 2, "unknown": 0}
        worst = max(assessments, key=lambda a: severity_rank.get(a.overall, 0))
        doc.quality = worst

        if worst.overall == "poor" and not doc.accept_low_quality:
            _step(doc, "quality", "done", "Quality issues detected \u2014 awaiting decision")
            doc.stage = ProcessingStage.AWAITING_USER_DECISION.value
            doc.touch()
            store.save(doc)
            return  # pause here; POST /continue resumes with accept_low_quality=True
    else:
        # Digital PDFs skip pixel-level quality checks entirely — there's no
        # scan/photo quality to assess when the text is already embedded.
        doc.quality.overall = "good"
        doc.quality.issues = []

    doc.stage = ProcessingStage.QUALITY_CHECKED.value
    _step(doc, "quality", "done", doc.quality.overall.capitalize())

    # ---- classify ----
    doc.stage = ProcessingStage.CLASSIFYING.value
    _step(doc, "classify", "active")

    classify_text_source = ""
    if not needs_ocr:
        prelim_pages = extraction.extract_direct_text(data)
        classify_text_source = "\n".join(p.text for p in prelim_pages)
    elif page_images:
        first_page_num, first_img = page_images[0]
        try:
            small = cv2.resize(
                first_img,
                None,
                fx=QUICK_CLASSIFY_DPI / extraction.OCR_RENDER_DPI,
                fy=QUICK_CLASSIFY_DPI / extraction.OCR_RENDER_DPI,
                interpolation=cv2.INTER_AREA,
            )
            classify_text_source, _conf, _wc = ocr_image(small)
        except Exception:
            classify_text_source = ""

    predicted_class, signals = classification.classify_text(classify_text_source)
    doc.analysis.classification = predicted_class.value
    doc.analysis.classification_signals = signals
    doc.stage = ProcessingStage.CLASSIFIED.value
    _step(doc, "classify", "done", predicted_class.value)

    # ---- preprocess + extract ----
    doc.stage = ProcessingStage.PREPROCESSING.value
    _step(doc, "preprocess", "active")
    _step(doc, "extract", "pending")

    page_results = []

    if not needs_ocr:
        _step(doc, "preprocess", "skipped", "Not needed for digital PDF text")
        doc.stage = ProcessingStage.EXTRACTING.value
        _step(doc, "extract", "active")
        page_results = extraction.extract_direct_text(data)
        method = ExtractionMethod.DIRECT_TEXT.value
    else:
        method = ExtractionMethod.OCR.value
        used_vision = False
        pages_dir = doc_dir / "pages"
        pages_dir.mkdir(exist_ok=True)

        for page_number, original_img in page_images:
            cv2.imwrite(str(pages_dir / f"page_{page_number}_original.png"), original_img)

        processed_images = {}
        for page_number, original_img in page_images:
            processed_img, log = preprocessing.preprocess_page(original_img)
            processed_images[page_number] = processed_img
            cv2.imwrite(str(pages_dir / f"page_{page_number}_processed.png"), processed_img)

        doc.stage = ProcessingStage.PREPROCESSED.value
        _step(doc, "preprocess", "done", f"{len(page_images)} page(s) prepared")

        doc.stage = ProcessingStage.EXTRACTING.value
        _step(doc, "extract", "active")

        for page_number, _ in page_images:
            processed_img = processed_images[page_number]
            warnings = []

            try:
                text, conf, word_count = ocr_image(processed_img)
            except extraction.OcrTimeoutError:
                # Never let one pathological page hang the whole document.
                # Fail that page cleanly and keep going with the rest.
                text, conf, word_count = "", 0.0, 0
                warnings.append(
                    f"OCR did not finish within {extraction.OCR_TIMEOUT_SECONDS}s on this page and was stopped. "
                    "This is usually caused by very dense, complex, or handwritten content."
                )

            handwriting_suspected = extraction.looks_like_handwriting(doc.quality.overall, conf, word_count)
            should_escalate = vision_ai_available() and (
                conf < extraction.VISION_ESCALATION_THRESHOLD or handwriting_suspected
            )

            if should_escalate:
                vision_text = vision_ai_transcribe(processed_img)
                if vision_text:
                    text = vision_text
                    conf = max(conf, 0.75)  # vision pass replaces the raw OCR confidence floor
                    method = ExtractionMethod.MIXED.value
                    used_vision = True
                    warnings.append(
                        "Likely handwritten content was re-read with Vision AI assistance."
                        if handwriting_suspected
                        else "Low-confidence OCR page was re-read with Vision AI assistance."
                    )
            elif handwriting_suspected:
                # No Vision AI configured — say so plainly rather than just
                # showing a mysteriously low confidence score with no context.
                warnings.append(
                    "This page's text may be handwritten. Standard OCR (Tesseract) is unreliable on "
                    "handwriting by nature, not because of image quality. Set ANTHROPIC_API_KEY to enable "
                    "the Vision AI layer for meaningfully better handwriting transcription, or use Edit to "
                    "transcribe this page manually."
                )

            from app.models import PageResult

            page_results.append(
                PageResult(
                    page_number=page_number,
                    text=text,
                    confidence=round(conf, 4),
                    method=method if not used_vision else ExtractionMethod.MIXED.value,
                    word_count=word_count,
                    low_confidence=conf < confidence.LOW_CONFIDENCE_PAGE_THRESHOLD,
                    warnings=warnings,
                    source_image_path=str(pages_dir / f"page_{page_number}_original.png"),
                    processed_image_path=str(pages_dir / f"page_{page_number}_processed.png"),
                )
            )

    doc.extraction.method = method
    doc.extraction.pages = page_results
    doc.extraction.full_text = confidence.assemble_full_text(page_results)
    doc.extraction.overall_confidence = confidence.compute_document_confidence(page_results, doc.quality)
    doc.stage = ProcessingStage.EXTRACTED.value
    _step(doc, "extract", "done", f"{len(page_results)} page(s) extracted")

    # ---- extraction check ----
    doc.stage = ProcessingStage.CHECKING_EXTRACTION.value
    _step(doc, "check", "active")
    doc.verification = confidence.run_extraction_check(page_results)

    if doc.verification.status == "failed":
        # No readable text anywhere in the document. Per spec (Section 21 /
        # Rule: never show a fake successful result), this is a genuine
        # pipeline failure, not a "complete" result with warnings attached.
        _step(doc, "check", "failed", "No readable text found")
        doc.error = (
            "No readable text could be extracted from this document. It may be "
            "blank, entirely illegible, or not a text document at all."
        )
        doc.stage = ProcessingStage.FAILED.value
        _step(doc, "finalize", "skipped")
        doc.touch()
        store.save(doc)
        return

    _step(doc, "check", "done", doc.verification.status.capitalize())

    # ---- finalize ----
    _step(doc, "finalize", "active")
    if doc.user_edited_text is None:
        doc.user_edited_text = doc.extraction.full_text
    doc.stage = ProcessingStage.COMPLETE.value
    _step(doc, "finalize", "done")
