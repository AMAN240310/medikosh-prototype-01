"""
Stage 5: Preprocessing.

Operates on copies of page images only — the original upload on disk is
never modified. Each step is individually guarded so that a failure in
one (e.g. document-edge detection on a document that fills the whole
frame) degrades gracefully instead of destroying the image.

Pipeline: crop (if a clear document boundary is found) -> deskew ->
denoise -> contrast enhancement (CLAHE). Sharpening/thresholding is
intentionally left out of the default path because aggressive binarization
tends to destroy thin strokes in printed medical text (spec: "do not
over-process images in a way that destroys text").
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import cv2
import numpy as np


@dataclass
class PreprocessingLog:
    steps_applied: List[str] = field(default_factory=list)
    skew_corrected_degrees: float = 0.0
    cropped: bool = False


def _order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _detect_and_crop(image: np.ndarray, log: PreprocessingLog) -> np.ndarray:
    """Find the largest quadrilateral contour and perspective-warp to it.

    Falls back to the original image if no confident document boundary
    is found (e.g. the document already fills the frame, which is the
    common case for direct scans/photos of a single sheet).
    """
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image

    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    image_area = h * w

    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4:
            area = cv2.contourArea(approx)
            # Only trust this as "the document" if it's a substantial,
            # but not implausible, fraction of the frame.
            if 0.35 * image_area <= area <= 0.98 * image_area:
                pts = approx.reshape(4, 2).astype("float32")
                rect = _order_points(pts)
                (tl, tr, br, bl) = rect

                width_a = np.linalg.norm(br - bl)
                width_b = np.linalg.norm(tr - tl)
                max_width = max(int(width_a), int(width_b))

                height_a = np.linalg.norm(tr - br)
                height_b = np.linalg.norm(tl - bl)
                max_height = max(int(height_a), int(height_b))

                if max_width < 100 or max_height < 100:
                    continue

                dst = np.array(
                    [[0, 0], [max_width - 1, 0], [max_width - 1, max_height - 1], [0, max_height - 1]],
                    dtype="float32",
                )
                m = cv2.getPerspectiveTransform(rect, dst)
                warped = cv2.warpPerspective(image, m, (max_width, max_height))
                log.cropped = True
                log.steps_applied.append("document_detection_and_crop")
                return warped

    return image


def _deskew(image: np.ndarray, log: PreprocessingLog) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.shape[0] < 50:
        return image

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    if abs(angle) < 0.3 or abs(angle) > 20:
        # Not worth correcting / heuristic likely unreliable
        return image

    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    m = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(
        image, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    log.skew_corrected_degrees = round(float(angle), 2)
    log.steps_applied.append(f"deskew({angle:.2f} deg)")
    return rotated


def _denoise(image: np.ndarray, log: PreprocessingLog) -> np.ndarray:
    denoised = cv2.fastNlMeansDenoisingColored(image, None, 4, 4, 7, 21)
    log.steps_applied.append("denoise")
    return denoised


def _enhance_contrast(image: np.ndarray, log: PreprocessingLog) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)
    enhanced = cv2.merge((l_channel, a, b))
    result = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
    log.steps_applied.append("contrast_enhancement (CLAHE)")
    return result


def preprocess_page(image_bgr: np.ndarray, allow_crop: bool = True) -> tuple[np.ndarray, PreprocessingLog]:
    """Run the full preprocessing chain on a *copy* of the page image."""
    log = PreprocessingLog()
    working = image_bgr.copy()

    try:
        if allow_crop:
            working = _detect_and_crop(working, log)
    except Exception:
        pass

    try:
        working = _deskew(working, log)
    except Exception:
        pass

    try:
        working = _denoise(working, log)
    except Exception:
        pass

    try:
        working = _enhance_contrast(working, log)
    except Exception:
        pass

    return working, log
