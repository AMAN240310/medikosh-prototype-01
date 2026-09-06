"""
Controlled, explicit (never fuzzy) vocabulary for the `field` values that
show up in Gemini's structured extraction. Three things live here because
they're all facets of the same underlying table and are used together by
both stage 3 (conflict detection) and stage 3.5 (prioritization):

  1. Field normalization - collapses known synonyms ("medication",
     "medicine", "medicines") onto one canonical name ("current_medication").
     Anything not in the map is left as-is, not dropped - see
     normalize_field().
  2. Field arity - whether a field is allowed to hold several different
     values at once (MULTI: symptom, medical_history, ...) or should
     normally hold exactly one (SINGLE: age, sex, date_of_birth,
     blood_type). This is what stops "knee pain" + "swelling" +
     "stiffness" from being treated as conflicting symptoms.
  3. Field priority - which of the doctor-summary's HIGH/MEDIUM/LOW tiers
     a field belongs to, and a stable rank within that tier, used by stage
     3.5 to decide what a concise summary should lead with.

Also home to a couple of small, explicit text helpers (negation-cue
detection, stopword-stripped content tokens) shared by:
  - stage 3's contradiction check (a negated statement vs. an affirmed one
    about the same topic, even within a MULTI-value field)
  - stage 3.5's relevance boosting and near-duplicate reduction

These are deliberately simple keyword/substring checks, not NLP or an LLM
call - "do not use fuzzy matching" / "keep the conflict system
deterministic and auditable" applies here too. See the README for the
known limitations that come with that choice.
"""
from __future__ import annotations

import re
from enum import Enum

from app.models.schemas import PriorityTier


class FieldArity(str, Enum):
    SINGLE = "SINGLE"
    MULTI = "MULTI"


# ---------------------------------------------------------------------------
# 1. Normalization - explicit synonym map, never fuzzy-matched
# ---------------------------------------------------------------------------

FIELD_NORMALIZATION_MAP: dict[str, str] = {
    # chief complaint
    "chief complaint": "chief_complaint",
    "presenting complaint": "chief_complaint",
    "main complaint": "chief_complaint",
    # symptoms
    "symptom": "symptom",
    "symptoms": "symptom",
    "current symptom": "symptom",
    "associated symptom": "associated_symptom",
    "associated symptoms": "associated_symptom",
    "duration": "symptom_duration",
    "symptom duration": "symptom_duration",
    "duration of symptom": "symptom_duration",
    "severity": "symptom_severity",
    "symptom severity": "symptom_severity",
    "pain severity": "symptom_severity",
    "aggravating factor": "symptom_aggravating_factor",
    "aggravating factors": "symptom_aggravating_factor",
    "worsening factor": "symptom_aggravating_factor",
    "relieving factor": "symptom_relieving_factor",
    "relieving factors": "symptom_relieving_factor",
    "improving factor": "symptom_relieving_factor",
    # history
    "medical history": "medical_history",
    "history": "medical_history",
    "past medical history": "medical_history",
    "family history": "family_history",
    "social history": "social_history",
    "surgical history": "surgical_history",
    "past surgical history": "surgical_history",
    # medication
    "medication": "current_medication",
    "medications": "current_medication",
    "medicine": "current_medication",
    "medicines": "current_medication",
    "current medication": "current_medication",
    "current medications": "current_medication",
    # findings / labs
    "document finding": "document_finding",
    "document findings": "document_finding",
    "finding": "document_finding",
    "findings": "document_finding",
    "lab": "recent_lab",
    "labs": "recent_lab",
    "lab result": "recent_lab",
    "recent lab": "recent_lab",
    "investigation": "recent_lab",
    "investigations": "recent_lab",
    # allergy
    "allergy": "allergy",
    "allergies": "allergy",
    # demographics (single-value)
    "age": "age",
    "sex": "sex",
    "gender": "sex",
    "date of birth": "date_of_birth",
    "dob": "date_of_birth",
    "blood type": "blood_type",
    "blood group": "blood_type",
}

# Fields already in canonical form map to themselves so a lookup never
# needs a branch for "already normalized".
for _canonical in set(FIELD_NORMALIZATION_MAP.values()):
    FIELD_NORMALIZATION_MAP.setdefault(_canonical.replace("_", " "), _canonical)


def _clean(field: str) -> str:
    return re.sub(r"[\s_]+", " ", (field or "").strip().lower())


def normalize_field(raw_field: str) -> str:
    """Maps a raw field name onto the controlled vocabulary when it's a
    known synonym. Unknown fields are returned cleaned (whitespace/case
    normalized) but otherwise UNCHANGED - never silently dropped or
    force-classified, per "unknown fields should remain traceable"."""
    cleaned = _clean(raw_field)
    return FIELD_NORMALIZATION_MAP.get(cleaned, cleaned)


# ---------------------------------------------------------------------------
# 2. Arity - only the fields explicitly called out as single-value are
#    SINGLE; everything else (including anything outside the controlled
#    vocabulary) defaults to MULTI, which is the safe default: it means an
#    unrecognized field can never be wrongly flagged as conflicting just
#    for holding more than one value.
# ---------------------------------------------------------------------------

_SINGLE_VALUE_FIELDS = frozenset({"age", "sex", "date_of_birth", "blood_type"})


def get_field_arity(canonical_field: str) -> FieldArity:
    return FieldArity.SINGLE if canonical_field in _SINGLE_VALUE_FIELDS else FieldArity.MULTI


# ---------------------------------------------------------------------------
# 3. Priority - (tier, rank) per canonical field. Rank is only for stable
#    ordering within a tier; lower shows up first. Unknown fields default
#    to MEDIUM rather than LOW, so a fact Gemini phrased outside the
#    controlled vocabulary isn't buried out of the concise summary just
#    for being unrecognized - it's still deprioritized relative to the
#    fields we're confident matter most, but not hidden.
# ---------------------------------------------------------------------------

_FIELD_PRIORITY: dict[str, tuple[PriorityTier, int]] = {
    "chief_complaint": (PriorityTier.HIGH, 1),
    "symptom": (PriorityTier.HIGH, 2),
    "symptom_duration": (PriorityTier.HIGH, 3),
    "symptom_severity": (PriorityTier.HIGH, 4),
    "associated_symptom": (PriorityTier.HIGH, 5),
    "symptom_aggravating_factor": (PriorityTier.HIGH, 6),
    "symptom_relieving_factor": (PriorityTier.HIGH, 6),
    "document_finding": (PriorityTier.HIGH, 7),
    "medical_history": (PriorityTier.HIGH, 8),
    "current_medication": (PriorityTier.HIGH, 9),
    "recent_lab": (PriorityTier.HIGH, 10),
    "allergy": (PriorityTier.MEDIUM, 11),
    "surgical_history": (PriorityTier.MEDIUM, 12),
    "social_history": (PriorityTier.MEDIUM, 13),
    "family_history": (PriorityTier.MEDIUM, 14),
    "age": (PriorityTier.MEDIUM, 15),
    "sex": (PriorityTier.MEDIUM, 16),
    "date_of_birth": (PriorityTier.MEDIUM, 17),
    "blood_type": (PriorityTier.MEDIUM, 18),
}
_DEFAULT_PRIORITY: tuple[PriorityTier, int] = (PriorityTier.MEDIUM, 50)

# Only these MEDIUM-tier fields get relevance-gated against the chief
# concern (demoted to LOW for the concise summary when they share no
# topic overlap with it). HIGH-tier fields are always clinically relevant
# regardless of keyword overlap; demographics (age/sex/dob/blood_type)
# are always kept since they're basic identity facts, not context-specific.
_RELEVANCE_GATED_FIELDS = frozenset({"allergy", "surgical_history", "social_history", "family_history"})


def get_field_priority(canonical_field: str) -> tuple[PriorityTier, int]:
    return _FIELD_PRIORITY.get(canonical_field, _DEFAULT_PRIORITY)


def is_relevance_gated(canonical_field: str) -> bool:
    return canonical_field in _RELEVANCE_GATED_FIELDS


# ---------------------------------------------------------------------------
# Shared text helpers - explicit keyword checks, not NLP/LLM
# ---------------------------------------------------------------------------

_NEGATION_CUES = (
    "no ", "not ", "denies", "denied", "absent", "negative for",
    "without ", "no history of", "no evidence of", "ruled out",
)

_STOPWORDS = frozenset({
    "a", "an", "the", "of", "in", "on", "at", "for", "to", "with", "and",
    "or", "is", "was", "were", "are", "be", "been", "being", "has", "have",
    "having", "this", "that", "these", "those", "patient", "reports",
    "reported", "report", "reporting", "states", "stated", "complains",
    "complained", "complaining", "experiencing", "experiences", "feels",
    "feeling", "history", "denies", "denied", "no", "not", "present",
    "absent", "since", "approximately", "about",
})

_TOKEN_RE = re.compile(r"[a-zA-Z]+")


def is_negated(value: str) -> bool:
    """Explicit substring check against a small, fixed cue list - not a
    classifier. A value that doesn't use one of these cues (e.g. a bare
    "denied" is fine, but paraphrased negation the model didn't phrase
    this way isn't) won't be caught; see README limitations."""
    lowered = (value or "").lower()
    return any(cue in lowered for cue in _NEGATION_CUES)


def content_tokens(value: str) -> set[str]:
    """Lowercased, stopword-stripped word tokens (len > 2) - the shared
    basis for both contradiction matching and relevance/redundancy
    comparisons. Never used to change or invent a value, only to compare
    already-stated text against other already-stated text."""
    words = _TOKEN_RE.findall((value or "").lower())
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}
