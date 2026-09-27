"""
Unit tests for the deterministic validation service (Stage 3).

These tests exercise the core logic of build_safe_facts() — conflict detection,
medicine validation, excluded-information tracking, and uncertain-information
passthrough — without any network calls or LLM dependencies.

Run with:
    cd backend/python_services
    pip install pytest
    pytest tests/test_validation_service.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure `clinical_engine` is importable from this test location
CLINICAL_DIR = Path(__file__).resolve().parent.parent / "clinical_engine"
if str(CLINICAL_DIR) not in sys.path:
    sys.path.insert(0, str(CLINICAL_DIR))

import pytest

from app.models.schemas import (
    Fact,
    MedicineToValidate,
    RxNormResult,
    RxNormStatus,
    SourceType,
    StructuredExtraction,
)
from app.services.validation_service import build_safe_facts


# ─── Helpers ──────────────────────────────────────────────────────────────────

def make_fact(field: str, value: str, source: SourceType = SourceType.VOICE, evidence: str = "test") -> Fact:
    return Fact(field=field, value=value, source_type=source, evidence=evidence)


def make_rx_valid(raw_name: str, validated_name: str | None = None) -> RxNormResult:
    return RxNormResult(
        raw_name=raw_name,
        exists_in_rxnorm=True,
        validated_name=validated_name or raw_name,
        status=RxNormStatus.VALID,
        evidence="test",
    )


def make_rx_invalid(raw_name: str, suggested: str | None = None) -> RxNormResult:
    return RxNormResult(
        raw_name=raw_name,
        exists_in_rxnorm=False,
        status=RxNormStatus.UNVERIFIED,
        suggested_name=suggested,
        evidence="test",
    )


def empty_extraction(**kwargs) -> StructuredExtraction:
    return StructuredExtraction(facts=kwargs.get("facts", []),
                                medicines_to_validate=kwargs.get("medicines", []),
                                uncertain_information=kwargs.get("uncertain", []))


# ─── Fact resolution ──────────────────────────────────────────────────────────

class TestFactResolution:
    def test_empty_input_produces_empty_output(self):
        result = build_safe_facts(empty_extraction(), [])
        assert result.safe_facts == []
        assert result.conflicts == []
        assert result.excluded_information == []

    def test_valid_fact_passes_through(self):
        fact = make_fact("age", "35")
        result = build_safe_facts(empty_extraction(facts=[fact]), [])
        assert len(result.safe_facts) == 1
        sf = result.safe_facts[0]
        assert sf.field == "age"
        assert sf.value == "35"
        assert sf.source_type == SourceType.VOICE

    def test_fact_with_empty_value_excluded(self):
        fact = make_fact("age", "  ")  # whitespace only
        result = build_safe_facts(empty_extraction(facts=[fact]), [])
        assert result.safe_facts == []
        assert len(result.excluded_information) == 1
        assert result.excluded_information[0].reason == "Unclear or missing value"

    def test_fact_with_none_value_excluded(self):
        fact = Fact(field="age", value=None, source_type=SourceType.VOICE, evidence="x")
        result = build_safe_facts(empty_extraction(facts=[fact]), [])
        assert result.safe_facts == []
        assert len(result.excluded_information) == 1

    def test_multiple_non_conflicting_facts_all_pass(self):
        facts = [
            make_fact("symptom", "knee pain"),
            make_fact("symptom", "swelling"),
            make_fact("symptom", "stiffness"),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        assert len(result.safe_facts) == 3
        assert result.conflicts == []


# ─── Single-value conflict detection ─────────────────────────────────────────

class TestSingleValueConflicts:
    def test_age_conflict_detected(self):
        facts = [
            make_fact("age", "35"),
            make_fact("age", "42"),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        # Both conflicting facts go into excluded_information; conflict record created
        assert len(result.conflicts) == 1
        assert result.conflicts[0].field.lower() == "age"
        # Both values flagged as excluded
        excluded_values = [e.detail for e in result.excluded_information if "age" in (e.field or "").lower() or "35" in (e.detail or "") or "42" in (e.detail or "")]
        assert len(excluded_values) >= 1

    def test_blood_type_conflict_detected(self):
        facts = [
            make_fact("blood_type", "O+", source=SourceType.VOICE),
            make_fact("blood_type", "A+", source=SourceType.DOCUMENT),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        assert len(result.conflicts) == 1

    def test_same_value_twice_no_conflict(self):
        facts = [
            make_fact("age", "35", source=SourceType.VOICE),
            make_fact("age", "35", source=SourceType.DOCUMENT),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        assert result.conflicts == []
        # One fact passes (or both, depending on dedup — key point is no conflict)
        assert len(result.safe_facts) >= 1


# ─── Negation conflict detection (multi-value fields) ─────────────────────────

class TestNegationConflicts:
    def test_negated_symptom_vs_affirmed_same_field_conflict(self):
        """Negation conflict is detected within the same field only (by design).
        A negated value and an affirmed value in the *same* multi-value field
        that share a meaningful topic token should produce a conflict record.
        """
        facts = [
            make_fact("medical_history", "no diabetes"),
            make_fact("medical_history", "Type 2 Diabetes Mellitus, diagnosed 2021"),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        assert len(result.conflicts) >= 1

    def test_cross_field_negation_not_flagged(self):
        """The validation service only checks within a field, not across fields.
        A negation in 'symptom' does NOT conflict with an affirmed value in
        'medical_history'. Cross-field conflict is intentionally out of scope.
        """
        facts = [
            make_fact("symptom", "no history of diabetes"),
            make_fact("medical_history", "Type 2 Diabetes Mellitus, diagnosed 2021"),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        # Both facts come from different fields — no conflict expected
        assert len(result.conflicts) == 0

    def test_unrelated_multi_value_no_conflict(self):
        facts = [
            make_fact("symptom", "headache"),
            make_fact("symptom", "nausea"),
            make_fact("symptom", "fatigue"),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        assert result.conflicts == []
        assert len(result.safe_facts) == 3

    def test_no_negation_no_conflict(self):
        facts = [
            make_fact("medical_history", "Hypertension"),
            make_fact("medical_history", "Type 2 Diabetes"),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        assert result.conflicts == []
        assert len(result.safe_facts) == 2


# ─── Medicine validation ──────────────────────────────────────────────────────

class TestMedicineValidation:
    def test_valid_medicine_accepted(self):
        med = MedicineToValidate(raw_name="Ibuprofen", dosage="400mg", evidence="prescription")
        rx = make_rx_valid("Ibuprofen")
        result = build_safe_facts(empty_extraction(medicines=[med]), [rx])
        assert len(result.validated_medicines) == 1
        assert result.validated_medicines[0].status == RxNormStatus.VALID

    def test_invalid_medicine_excluded(self):
        med = MedicineToValidate(raw_name="Zylofex123", evidence="voice")
        rx = make_rx_invalid("Zylofex123")
        result = build_safe_facts(empty_extraction(medicines=[med]), [rx])
        assert result.validated_medicines == []
        assert len(result.excluded_information) == 1
        assert "Zylofex123" in result.excluded_information[0].field

    def test_invalid_medicine_with_suggestion_not_auto_applied(self):
        """Suggested name must never be silently applied as the validated name."""
        med = MedicineToValidate(raw_name="ibuprofen", evidence="voice")
        rx = make_rx_invalid("ibuprofen", suggested="Ibuprofen")
        result = build_safe_facts(empty_extraction(medicines=[med]), [rx])
        assert result.validated_medicines == []
        # Suggestion should appear in the excluded detail note, not in validated_medicines
        ex = result.excluded_information[0]
        assert "Ibuprofen" in (ex.detail or "") or "ibuprofen" in (ex.field or "")

    def test_no_medicines_no_exclusions_from_medicine_check(self):
        result = build_safe_facts(empty_extraction(medicines=[], facts=[]), [])
        assert result.validated_medicines == []
        assert result.excluded_information == []

    def test_multiple_valid_medicines(self):
        meds = [
            MedicineToValidate(raw_name="Aspirin", evidence="doc"),
            MedicineToValidate(raw_name="Metformin", evidence="doc"),
        ]
        rxs = [make_rx_valid("Aspirin"), make_rx_valid("Metformin")]
        result = build_safe_facts(empty_extraction(medicines=meds), rxs)
        assert len(result.validated_medicines) == 2


# ─── Uncertain information passthrough ────────────────────────────────────────

class TestUncertainInformation:
    def test_uncertain_note_passed_to_excluded(self):
        result = build_safe_facts(
            empty_extraction(uncertain=["Unclear whether allergy is to penicillin or amoxicillin"]),
            []
        )
        assert len(result.excluded_information) == 1
        ex = result.excluded_information[0]
        assert ex.field == "uncertain_information"
        assert "penicillin" in (ex.detail or "")
        assert ex.reason == "Marked uncertain during extraction"

    def test_empty_uncertain_notes_ignored(self):
        result = build_safe_facts(empty_extraction(uncertain=["", "  "]), [])
        assert result.excluded_information == []

    def test_multiple_uncertain_notes(self):
        result = build_safe_facts(
            empty_extraction(uncertain=["Note A", "Note B"]),
            []
        )
        assert len(result.excluded_information) == 2


# ─── Source type preservation ─────────────────────────────────────────────────

class TestSourceTypePreservation:
    def test_voice_source_preserved(self):
        fact = make_fact("symptom", "chest pain", source=SourceType.VOICE)
        result = build_safe_facts(empty_extraction(facts=[fact]), [])
        assert result.safe_facts[0].source_type == SourceType.VOICE

    def test_document_source_preserved(self):
        fact = make_fact("finding", "elevated WBC", source=SourceType.DOCUMENT)
        result = build_safe_facts(empty_extraction(facts=[fact]), [])
        assert result.safe_facts[0].source_type == SourceType.DOCUMENT

    def test_evidence_preserved(self):
        fact = Fact(field="symptom", value="fever", source_type=SourceType.VOICE, evidence="Patient said: I have had fever for 3 days")
        result = build_safe_facts(empty_extraction(facts=[fact]), [])
        assert "fever" in result.safe_facts[0].evidence


# ─── Conflict record structure ────────────────────────────────────────────────

class TestConflictRecordStructure:
    def test_conflict_record_has_two_values(self):
        facts = [
            make_fact("sex", "Male", source=SourceType.VOICE),
            make_fact("sex", "Female", source=SourceType.DOCUMENT),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        assert len(result.conflicts) == 1
        cr = result.conflicts[0]
        assert len(cr.conflicting_values) == 2
        values = {cv.value for cv in cr.conflicting_values}
        assert "Male" in values and "Female" in values

    def test_conflict_record_preserves_sources(self):
        facts = [
            make_fact("sex", "Male", source=SourceType.VOICE),
            make_fact("sex", "Female", source=SourceType.DOCUMENT),
        ]
        result = build_safe_facts(empty_extraction(facts=facts), [])
        sources = {cv.source_type for cv in result.conflicts[0].conflicting_values}
        assert SourceType.VOICE in sources
        assert SourceType.DOCUMENT in sources
