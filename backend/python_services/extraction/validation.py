"""
Stage 1: File Validation.

Checks the raw uploaded bytes before any processing is attempted.
Never fails silently -- every failure returns a clear, specific reason.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import List, Optional

import pymupdf

SUPPORTED_MIME_TO_EXT = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

SUPPORTED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png", "webp"}

MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB — generous for a scanned document
MIN_FILE_SIZE_BYTES = 100  # anything smaller cannot be a real document


class ValidationError(Exception):
    """Raised with a user-facing reason. Message is shown verbatim in the UI."""

    def __init__(self, reason: str, code: str = "validation_failed"):
        super().__init__(reason)
        self.reason = reason
        self.code = code


@dataclass
class ValidationOutcome:
    ok: bool
    file_ext: str
    file_hash: str
    page_count: Optional[int] = None
    warnings: Optional[List[str]] = None


def guess_extension(filename: str, content_type: Optional[str]) -> str:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if ext in SUPPORTED_EXTENSIONS:
        return "jpg" if ext == "jpeg" else ext
    if content_type in SUPPORTED_MIME_TO_EXT:
        return SUPPORTED_MIME_TO_EXT[content_type]
    return ext


def validate_upload(filename: str, content_type: Optional[str], data: bytes) -> ValidationOutcome:
    warnings: List[str] = []

    if not data or len(data) < MIN_FILE_SIZE_BYTES:
        raise ValidationError(
            "The uploaded file is empty or unreadably small.",
            code="empty_file",
        )

    if len(data) > MAX_FILE_SIZE_BYTES:
        raise ValidationError(
            f"The file is too large ({len(data) / (1024*1024):.1f} MB). "
            f"The maximum supported size is {MAX_FILE_SIZE_BYTES / (1024*1024):.0f} MB.",
            code="file_too_large",
        )

    ext = guess_extension(filename, content_type)
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValidationError(
            f"Unsupported file type ({ext or 'unknown'}). "
            f"Supported formats: PDF, JPG, JPEG, PNG, WEBP.",
            code="unsupported_type",
        )

    file_hash = hashlib.sha256(data).hexdigest()
    page_count = None

    if ext == "pdf":
        try:
            doc = pymupdf.open(stream=data, filetype="pdf")
        except Exception as exc:
            raise ValidationError(
                "The PDF appears to be corrupted and could not be opened.",
                code="corrupted_pdf",
            ) from exc

        if doc.is_encrypted:
            # needs_pass is true even if PyMuPDF could open it read-only
            if doc.needs_pass:
                doc.close()
                raise ValidationError(
                    "The PDF is password protected. Please upload an unlocked copy.",
                    code="password_protected",
                )
            warnings.append("This PDF is encrypted but did not require a password to open.")

        page_count = doc.page_count
        if page_count == 0:
            doc.close()
            raise ValidationError(
                "The PDF has no pages.",
                code="empty_pdf",
            )
        if page_count > 50:
            warnings.append(
                f"This document has {page_count} pages. Processing may take longer than usual."
            )
        doc.close()
    else:
        try:
            from PIL import Image
            import io

            img = Image.open(io.BytesIO(data))
            img.verify()
        except Exception as exc:
            raise ValidationError(
                "The image file could not be read. It may be corrupted or in an unsupported format.",
                code="corrupted_image",
            ) from exc
        page_count = 1

    return ValidationOutcome(
        ok=True,
        file_ext=ext,
        file_hash=file_hash,
        page_count=page_count,
        warnings=warnings,
    )
