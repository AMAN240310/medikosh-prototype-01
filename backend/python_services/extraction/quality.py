"""
Stage 3: Quality Check.

Runs cheap, well-understood computer-vision heuristics against a page
image and turns them into a human-readable quality assessment. This is
deliberately conservative: it is meant to catch documents where OCR is
likely to fail, not to be a perfect image-quality model.

Nothing here claims poor-quality extraction is reliable — a "poor"
overall rating surfaces a retake/continue-anyway choice up in the API
layer rather than being silently absorbed.
"""
from __future__ import annotations

import cv2
import numpy as np

from .models import QualityAssessment, QualityIssue

# Thresholds tuned empirically for phone-camera / flatbed-scan documents.
BLUR_LAPLACIAN_LOW = 60.0
BLUR_LAPLACIAN_MEDIUM = 150.0

# Document scans are dominated by a bright white background, so a much
# higher "high" ceiling than general photography is appropriate here —
# a clean, well-lit page scan often averages 235-252. True overexposure
# (blown-out, unreadable) sits above that.
BRIGHTNESS_LOW = 70.0
BRIGHTNESS_HIGH = 253.0

CONTRAST_LOW = 30.0

MIN_LONG_EDGE_GOOD = 1400
MIN_LONG_EDGE_ACCEPTABLE = 900


def _blur_score(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _estimate_skew_degrees(gray: np.ndarray) -> float:
    """Rough skew estimate via minAreaRect over thresholded ink pixels."""
    try:
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        coords = np.column_stack(np.where(thresh > 0))
        if coords.shape[0] < 50:
            return 0.0
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
        # Clamp: extreme values usually mean the heuristic failed, not real skew
        if abs(angle) > 45:
            return 0.0
        return float(angle)
    except Exception:
        return 0.0


def assess_quality(image_bgr: np.ndarray) -> QualityAssessment:
    issues: list[QualityIssue] = []
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    long_edge = max(h, w)

    blur_metric = _blur_score(gray)
    brightness_metric = float(np.mean(gray))
    contrast_metric = float(np.std(gray))
    skew = _estimate_skew_degrees(gray)

    # --- Resolution ---
    if long_edge >= MIN_LONG_EDGE_GOOD:
        resolution = "good"
    elif long_edge >= MIN_LONG_EDGE_ACCEPTABLE:
        resolution = "acceptable"
        issues.append(QualityIssue("low_resolution", "Image resolution is on the low side.", "warning"))
    else:
        resolution = "poor"
        issues.append(QualityIssue("low_resolution", "Image resolution is too low for reliable text extraction.", "error"))

    # --- Blur ---
    if blur_metric >= BLUR_LAPLACIAN_MEDIUM:
        blur = "low"
    elif blur_metric >= BLUR_LAPLACIAN_LOW:
        blur = "medium"
        issues.append(QualityIssue("blur", "The image is somewhat blurry.", "warning"))
    else:
        blur = "high"
        issues.append(QualityIssue("blur", "The image is too blurry to read reliably.", "error"))

    # --- Brightness ---
    if BRIGHTNESS_LOW <= brightness_metric <= BRIGHTNESS_HIGH:
        brightness = "good"
    elif brightness_metric < BRIGHTNESS_LOW:
        brightness = "low"
        issues.append(QualityIssue("brightness", "The image is too dark.", "warning"))
    else:
        brightness = "high"
        issues.append(QualityIssue("brightness", "The image is overexposed / too bright.", "warning"))

    # --- Contrast ---
    if contrast_metric >= CONTRAST_LOW:
        contrast = "good"
    else:
        contrast = "low"
        issues.append(QualityIssue("contrast", "Contrast is low; text may blend into the background.", "warning"))

    # --- Rotation ---
    if abs(skew) <= 2.0:
        rotation = "correct"
    elif abs(skew) <= 8.0:
        rotation = "slight_skew"
        issues.append(QualityIssue("rotation", f"The page appears slightly rotated ({skew:.1f}\u00b0).", "info"))
    else:
        rotation = "skewed"
        issues.append(QualityIssue("rotation", f"The page appears significantly rotated ({skew:.1f}\u00b0).", "warning"))

    # --- Overall ---
    error_count = sum(1 for i in issues if i.severity == "error")
    warning_count = sum(1 for i in issues if i.severity == "warning")

    if error_count > 0:
        overall = "poor"
    elif warning_count >= 2:
        overall = "acceptable"
    else:
        overall = "good"

    return QualityAssessment(
        resolution=resolution,
        blur=blur,
        brightness=brightness,
        contrast=contrast,
        rotation_degrees=round(skew, 2),
        rotation=rotation,
        overall=overall,
        issues=issues,
        metrics={
            "blur_laplacian_variance": round(blur_metric, 2),
            "brightness_mean": round(brightness_metric, 2),
            "contrast_std": round(contrast_metric, 2),
            "long_edge_px": float(long_edge),
        },
    )
