"""
Stage 6: Extraction Layer.

Three extraction methods feed one shared output shape (RAW FULL TEXT,
page by page):

  - Direct text parser  -> digital PDFs with an embedded text layer (PyMuPDF)
  - OCR                 -> scanned PDFs and images (Tesseract)
  - Vision AI            -> OPTIONAL escalation for low-confidence OCR pages

Engineering note on OCR engine choice
--------------------------------------
The product spec recommends PaddleOCR with Tesseract as a fallback. This
prototype ships with **Tesseract as the primary OCR engine**. PaddleOCR
pulls in the full PaddlePaddle deep-learning framework (multi-GB of
dependencies, GPU-oriented build chain) which is impractical to install
in a lightweight demo/sandbox environment and overkill for proving out
the pipeline. The `OCREngine` interface below is intentionally the only
place OCR is called from, so swapping in PaddleOCR (or any other engine)
later means implementing one class, not touching the pipeline.

Vision AI is implemented as a genuinely optional escalation path. It is
only invoked if `ANTHROPIC_API_KEY` is set in the environment AND a
page's OCR confidence falls below a threshold. It is instructed, under
all circumstances, to never invent text it cannot clearly read.
"""
from __future__ import annotations

import base64
import io
import os
import platform
import shutil
from dataclasses import dataclass
from typing import List, Optional

import cv2
import numpy as np
import pymupdf
import pytesseract
from PIL import Image
from pytesseract import Output

from .models import ExtractionMethod, PageResult

OCR_RENDER_DPI = 300
LOW_CONFIDENCE_THRESHOLD = 0.55  # below this, a page is flagged low-confidence
VISION_ESCALATION_THRESHOLD = 0.45  # below this AND vision available -> escalate

# --- Hang/slowness guards -----------------------------------------------
# Modern phone photos can be huge (4000x3000+). Big images make every
# preprocessing step (denoise especially) and OCR itself dramatically
# slower without a proportional accuracy gain past a point, and in the
# worst case have caused Tesseract to run for minutes on a single page.
# Downscaling before the OCR path bounds worst-case runtime.
MAX_OCR_DIMENSION_PX = 3200

# Tesseract has no built-in timeout by default, so a pathological page
# (dense noise, complex layout, some handwriting) can hang indefinitely
# with no error and no progress. This forces every OCR call to return
# within a bounded time — on timeout, the page is marked failed/low
# confidence with a clear warning instead of freezing the pipeline.
OCR_TIMEOUT_SECONDS = 40


def _configure_tesseract_binary() -> None:
    """Make OCR work out of the box on Windows even when the Tesseract
    installer didn't add itself to PATH (a common gotcha). No-op on
    Linux/macOS where `tesseract` is normally already resolvable."""
    if shutil.which("tesseract"):
        return
    if platform.system() != "Windows":
        return
    for candidate in (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ):
        if os.path.exists(candidate):
            pytesseract.pytesseract.tesseract_cmd = candidate
            return


_configure_tesseract_binary()


# --------------------------------------------------------------------------
# Utilities
# --------------------------------------------------------------------------

def cap_image_size(image_bgr: np.ndarray, max_dimension: int = MAX_OCR_DIMENSION_PX) -> np.ndarray:
    """Downscale an image if its longer edge exceeds max_dimension. This is
    the main defense against pathologically slow preprocessing/OCR on huge
    phone-camera photos — bounds worst-case runtime without materially
    hurting accuracy (OCR_RENDER_DPI=300 already renders PDFs well under
    this cap; this only kicks in for oversized photo uploads)."""
    h, w = image_bgr.shape[:2]
    long_edge = max(h, w)
    if long_edge <= max_dimension:
        return image_bgr
    scale = max_dimension / long_edge
    new_size = (int(w * scale), int(h * scale))
    return cv2.resize(image_bgr, new_size, interpolation=cv2.INTER_AREA)


def pdf_page_to_image(doc: "pymupdf.Document", page_index: int, dpi: int = OCR_RENDER_DPI) -> np.ndarray:
    page = doc[page_index]
    zoom = dpi / 72.0
    matrix = pymupdf.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, colorspace=pymupdf.csRGB)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    else:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    return cap_image_size(img)


def bytes_to_image(data: bytes) -> np.ndarray:
    pil_img = Image.open(io.BytesIO(data))
    pil_img = pil_img.convert("RGB")
    arr = np.array(pil_img)
    return cap_image_size(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))


def image_to_png_bytes(image_bgr: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", image_bgr)
    if not ok:
        raise RuntimeError("Failed to encode image")
    return buf.tobytes()


# --------------------------------------------------------------------------
# Direct text extraction (digital PDFs)
# --------------------------------------------------------------------------

def extract_direct_text(data: bytes) -> List[PageResult]:
    doc = pymupdf.open(stream=data, filetype="pdf")
    results: List[PageResult] = []

    for i, page in enumerate(doc):
        # "blocks" gives us paragraph-ish groupings with reading order,
        # which we use to preserve structure rather than dumping one
        # giant run-on string.
        blocks = page.get_text("blocks")
        blocks_sorted = sorted(blocks, key=lambda b: (round(b[1], 1), round(b[0], 1)))
        paragraphs = []
        for b in blocks_sorted:
            block_text = (b[4] or "").strip()
            if block_text:
                paragraphs.append(block_text)

        text = "\n\n".join(paragraphs) if paragraphs else (page.get_text("text") or "").strip()
        word_count = len(text.split())

        confidence = 0.97 if word_count > 0 else 0.0

        results.append(
            PageResult(
                page_number=i + 1,
                text=text,
                confidence=confidence,
                method=ExtractionMethod.DIRECT_TEXT.value,
                word_count=word_count,
                low_confidence=confidence < LOW_CONFIDENCE_THRESHOLD,
            )
        )

    doc.close()
    return results


# --------------------------------------------------------------------------
# OCR extraction (Tesseract)
# --------------------------------------------------------------------------

def _reconstruct_structured_text(ocr_data: dict) -> tuple[str, float]:
    """Turn pytesseract's word-level TSV output into readable, structured text.

    Groups words into lines (block_num, par_num, line_num) and lines into
    paragraphs (block_num, par_num), inserting a blank line between
    paragraphs. Returns the text plus the mean confidence across all
    words that tesseract considered real text (conf >= 0).
    """
    n = len(ocr_data["text"])
    lines: dict[tuple[int, int, int], list[tuple[int, str]]] = {}
    confidences: list[float] = []

    for idx in range(n):
        word = ocr_data["text"][idx].strip()
        conf_raw = ocr_data["conf"][idx]
        try:
            conf = float(conf_raw)
        except (TypeError, ValueError):
            conf = -1.0

        if conf >= 0:
            confidences.append(conf)

        if not word:
            continue

        key = (ocr_data["block_num"][idx], ocr_data["par_num"][idx], ocr_data["line_num"][idx])
        lines.setdefault(key, []).append((ocr_data["left"][idx], word))

    # Sort lines in natural reading order
    ordered_keys = sorted(lines.keys())
    paragraph_key = None
    output_lines: list[str] = []

    for key in ordered_keys:
        block, par, _line = key
        words = sorted(lines[key], key=lambda t: t[0])
        line_text = " ".join(w for _, w in words)

        if paragraph_key is not None and (block, par) != paragraph_key:
            output_lines.append("")  # blank line between paragraphs

        output_lines.append(line_text)
        paragraph_key = (block, par)

    text = "\n".join(output_lines).strip()
    mean_conf = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0
    return text, mean_conf


class OcrTimeoutError(Exception):
    """Raised when Tesseract doesn't return within OCR_TIMEOUT_SECONDS.
    Callers should treat this like a failed/zero-confidence page rather
    than letting it propagate and kill the whole pipeline run."""


def ocr_image(image_bgr: np.ndarray, lang: str = "eng") -> tuple[str, float, int]:
    """Run Tesseract OCR on a preprocessed BGR image.

    Returns (structured_text, confidence_0_to_1, word_count). Bounded by
    OCR_TIMEOUT_SECONDS — Tesseract has no default timeout, and dense/
    complex/handwritten content has been observed to run for minutes or
    longer on a single page with zero feedback. Raises OcrTimeoutError
    instead of hanging so the caller can fail that page gracefully.
    """
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(rgb)

    config = "--oem 3 --psm 3"
    try:
        ocr_data = pytesseract.image_to_data(
            pil_img,
            lang=lang,
            config=config,
            output_type=Output.DICT,
            timeout=OCR_TIMEOUT_SECONDS,
        )
    except RuntimeError as exc:
        # pytesseract raises RuntimeError("Tesseract process timeout") on timeout
        if "timeout" in str(exc).lower():
            raise OcrTimeoutError(f"OCR did not finish within {OCR_TIMEOUT_SECONDS}s") from exc
        raise

    text, confidence = _reconstruct_structured_text(ocr_data)
    word_count = len([w for w in ocr_data["text"] if w.strip()])
    return text, confidence, word_count


def looks_like_handwriting(quality_overall: str, ocr_confidence: float, word_count: int) -> bool:
    """Heuristic: if the *image itself* checked out fine (not blurry, not
    dark, not low-res) but Tesseract still came back with very low
    confidence and it did find some words (so it's not just a blank page),
    the most likely explanation isn't image quality — it's content Tesseract
    fundamentally struggles with, and handwriting is the common case.
    Traditional OCR engines are trained on printed glyphs; this is a real
    limitation, not something a config flag fixes."""
    return quality_overall in ("good", "acceptable") and 0 < word_count and ocr_confidence < 0.4


# --------------------------------------------------------------------------
# Vision AI (optional escalation layer)
# --------------------------------------------------------------------------

VISION_SYSTEM_PROMPT = (
    "You are a strict document transcription engine used in a medical document "
    "digitization pipeline. Transcribe ONLY the text that is clearly, legibly "
    "visible in the image, INCLUDING handwritten text if present — read "
    "handwriting carefully and do your best with it, the same way a careful "
    "human transcriber would. Preserve line breaks and section structure. "
    "Do NOT infer, guess, autocomplete, or hallucinate any text you cannot "
    "clearly read, even if it seems like an obvious medical term. For any "
    "word, phrase, or region you cannot read with confidence — handwritten or "
    "printed — output the literal marker [UNCLEAR TEXT] in its place instead "
    "of guessing. Do not add commentary, translation, interpretation, or "
    "diagnosis of any kind — transcription only."
)


def vision_ai_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def vision_ai_transcribe(image_bgr: np.ndarray) -> Optional[str]:
    """Optional escalation for low-confidence pages.

    Requires ANTHROPIC_API_KEY. Returns None (rather than raising) on any
    failure so the pipeline can gracefully fall back to the OCR result —
    Vision AI is an enhancement, never a hard dependency.
    """
    if not vision_ai_available():
        return None

    try:
        import anthropic  # imported lazily: optional dependency

        client = anthropic.Anthropic()
        png_bytes = image_to_png_bytes(image_bgr)
        b64 = base64.b64encode(png_bytes).decode("utf-8")

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=VISION_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": b64},
                        },
                        {
                            "type": "text",
                            "text": "Transcribe this medical document page exactly as instructed.",
                        },
                    ],
                }
            ],
        )
        parts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip() or None
    except Exception:
        return None
