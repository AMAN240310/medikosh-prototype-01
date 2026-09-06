"""
Stage 4: Document Classification.

IMPORTANT: this is metadata-only. It never gates or filters what gets
extracted in the extraction layer — every document, regardless of
predicted category, goes through full-text extraction. This module is
a simple, transparent keyword scorer on purpose: it's easy to audit and
easy to extend, and a demo prototype has no business pretending to run
a trained classifier it doesn't have.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

from .models import Classification

_SIGNALS: Dict[Classification, List[str]] = {
    Classification.PRESCRIPTION: [
        "rx", "prescription", "sig:", "take one tablet", "tab.", "cap.",
        "dosage", "dispense", "refill", "mg twice daily", "mg once daily",
        "morning afternoon night", "before food", "after food",
    ],
    Classification.LAB_REPORT: [
        "complete blood count", "hemoglobin", "haemoglobin", "wbc count",
        "platelet count", "biochemistry", "fasting blood sugar", "hba1c",
        "lipid profile", "reference range", "specimen", "sample collected",
        "test name", "result", "units", "pathology", "laboratory",
    ],
    Classification.DISCHARGE_SUMMARY: [
        "discharge summary", "date of admission", "date of discharge",
        "diagnosis on discharge", "hospital course", "condition on discharge",
        "discharge medication", "follow up advice",
    ],
    Classification.RADIOLOGY_REPORT: [
        "radiology", "impression:", "findings:", "x-ray", "ultrasound",
        "ct scan", "mri", "sonography", "contrast", "radiologist",
    ],
}


def classify_text(text: str) -> Tuple[Classification, List[str]]:
    lowered = text.lower()
    scores: Dict[Classification, List[str]] = {}

    for category, keywords in _SIGNALS.items():
        hits = [kw for kw in keywords if kw in lowered]
        if hits:
            scores[category] = hits

    if not scores:
        if lowered.strip():
            return Classification.GENERAL_MEDICAL_DOCUMENT, []
        return Classification.UNKNOWN, []

    best_category = max(scores.items(), key=lambda kv: len(kv[1]))[0]
    return best_category, scores[best_category]
