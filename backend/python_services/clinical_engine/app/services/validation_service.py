"""
Stage 3: deterministic backend validation that fuses Gemini's structured
extraction with RxNorm's medicine validation results into SAFE_FACTS.

This is plain code, not another LLM call - conflict detection uses only
the field arity table and the explicit keyword/negation helpers in
field_taxonomy, never semantic/fuzzy matching, so every decision here
stays fully explainable and reproducible. Nothing is ever silently
dropped: anything that doesn't make it into safe_facts / validated_medicines
shows up in excluded_information (or conflicts) with a reason, so the
trail stays auditable end to end.

Conflict detection, in short:
  - SINGLE-value fields (age, sex, date_of_birth, blood_type): any two
    distinct values under the same field is a conflict, same as a plain
    "these should agree and don't" check.
  - MULTI-value fields (symptom, medical_history, current_medication, ...):
    multiple DIFFERENT values coexist fine (knee pain + swelling +
    stiffness is three symptoms, not a conflict). A conflict is only
    raised when one value reads as a negation of a topic another value in
    the same field affirms (e.g. "no history of diabetes" vs. "Type 2
    Diabetes Mellitus, diagnosed 2021") - see field_taxonomy.is_negated /
    content_tokens for exactly what "reads as" means here.
"""
from __future__ import annotations

from collections import defaultdict

from app.models.schemas import (
    ConflictingValue,
    ConflictRecord,
    ExcludedInformation,
    Fact,
    RxNormResult,
    RxNormStatus,
    SafeFact,
    SafeValidatedData,
    StructuredExtraction,
    ValidatedMedicine,
)
from app.services.field_taxonomy import (
    FieldArity,
    content_tokens,
    get_field_arity,
    is_negated,
    normalize_field,
)


def build_safe_facts(
    structured: StructuredExtraction, rxnorm_results: list[RxNormResult]
) -> SafeValidatedData:
    excluded: list[ExcludedInformation] = []

    validated_medicines = _validate_medicines(structured, rxnorm_results, excluded)
    safe_facts, conflicts = _resolve_facts(structured.facts, excluded)
    _passthrough_uncertain_information(structured.uncertain_information, excluded)

    return SafeValidatedData(
        safe_facts=safe_facts,
        validated_medicines=validated_medicines,
        excluded_information=excluded,
        conflicts=conflicts,
    )


def _validate_medicines(
    structured: StructuredExtraction,
    rxnorm_results: list[RxNormResult],
    excluded: list[ExcludedInformation],
) -> list[ValidatedMedicine]:
    # Match RxNorm results back to the medicine that was sent for
    # validation by (raw_name, evidence) rather than raw_name alone, in
    # case the same drug name appears twice with different evidence (e.g.
    # once patient-reported, once in a document). Falls back to a
    # name-only match if that pairing doesn't line up.
    results_by_key: dict[tuple[str, str], RxNormResult] = {
        (r.raw_name, r.evidence or ""): r for r in rxnorm_results
    }

    validated: list[ValidatedMedicine] = []
    for med in structured.medicines_to_validate:
        key = (med.raw_name, med.evidence or "")
        result = results_by_key.get(key)
        if result is None:
            result = next((r for r in rxnorm_results if r.raw_name == med.raw_name), None)

        if result is not None and result.status == RxNormStatus.VALID:
            validated.append(
                ValidatedMedicine(
                    name=result.validated_name or med.raw_name,
                    dosage=med.dosage,
                    status=RxNormStatus.VALID,
                    evidence=med.evidence,
                )
            )
        else:
            detail = f"'{med.raw_name}' was not found in RxNorm."
            if result is not None and result.suggested_name:
                detail += (
                    f" A possible match was '{result.suggested_name}', but it was"
                    " not applied automatically."
                )
            excluded.append(
                ExcludedInformation(
                    field=f"medicine: {med.raw_name}",
                    reason="Could not be validated",
                    detail=detail,
                )
            )
    return validated


def _resolve_facts(
    facts: list[Fact], excluded: list[ExcludedInformation]
) -> tuple[list[SafeFact], list[ConflictRecord]]:
    usable: list[Fact] = []
    for fact in facts:
        has_value = fact.value is not None and fact.value.strip() != ""
        has_field = fact.field is not None and fact.field.strip() != ""
        if has_value and has_field:
            usable.append(fact)
        else:
            excluded.append(
                ExcludedInformation(
                    field=fact.field or "(unnamed field)",
                    reason="Unclear or missing value",
                    detail=fact.evidence or None,
                )
            )

    groups: dict[str, list[Fact]] = defaultdict(list)
    for fact in usable:
        groups[normalize_field(fact.field)].append(fact)

    safe_facts: list[SafeFact] = []
    conflicts: list[ConflictRecord] = []

    for canonical_field, grouped_facts in groups.items():
        if get_field_arity(canonical_field) is FieldArity.SINGLE:
            conflicting_pairs = _single_value_conflicts(grouped_facts)
        else:
            conflicting_pairs = _negation_conflicts(grouped_facts)

        conflicted_facts = {id(f) for pair in conflicting_pairs for f in pair}

        for fact_a, fact_b in conflicting_pairs:
            conflicts.append(_build_conflict_record(canonical_field, fact_a, fact_b))

        for fact in grouped_facts:
            if id(fact) in conflicted_facts:
                excluded.append(
                    ExcludedInformation(
                        field=fact.field,
                        reason="Conflicting information",
                        detail=(
                            f"Value '{fact.value}' ({fact.source_type.value}) conflicts with "
                            "another reported value for this field."
                        ),
                    )
                )
            else:
                safe_facts.append(
                    SafeFact(
                        field=fact.field,
                        value=fact.value,
                        evidence=fact.evidence,
                        source_type=fact.source_type,
                    )
                )

    return safe_facts, conflicts


def _single_value_conflicts(grouped_facts: list[Fact]) -> list[tuple[Fact, Fact]]:
    """SINGLE-value fields: any two facts with a different value conflict
    with each other. Returns the anchor fact (the first one seen) paired
    with every later fact that disagrees with it, which is enough to mark
    every disagreeing fact as excluded without also flagging entries that
    merely repeat the same value twice."""
    if len(grouped_facts) < 2:
        return []
    anchor = grouped_facts[0]
    anchor_value = anchor.value.strip().lower()
    pairs = [
        (anchor, fact)
        for fact in grouped_facts[1:]
        if fact.value.strip().lower() != anchor_value
    ]
    return pairs


def _negation_conflicts(grouped_facts: list[Fact]) -> list[tuple[Fact, Fact]]:
    """MULTI-value fields: only flag a pair when one fact's value reads as
    a negation and shares a meaningful topic word with an affirmed value
    in the same field. Different-but-unrelated values (the normal case
    for a multi-value field) never conflict."""
    negated = [f for f in grouped_facts if is_negated(f.value)]
    if not negated:
        return []
    affirmed = [f for f in grouped_facts if not is_negated(f.value)]
    pairs: list[tuple[Fact, Fact]] = []
    for neg in negated:
        neg_tokens = content_tokens(neg.value)
        if not neg_tokens:
            continue
        for aff in affirmed:
            if neg_tokens & content_tokens(aff.value):
                pairs.append((neg, aff))
    return pairs


def _build_conflict_record(field_label: str, fact_a: Fact, fact_b: Fact) -> ConflictRecord:
    display_field = fact_a.field or field_label
    return ConflictRecord(
        field=display_field,
        description=f"Multiple differing values were reported for '{display_field}'.",
        conflicting_values=[
            ConflictingValue(value=f.value, source_type=f.source_type, evidence=f.evidence)
            for f in (fact_a, fact_b)
        ],
    )


def _passthrough_uncertain_information(
    uncertain_information: list[str], excluded: list[ExcludedInformation]
) -> None:
    for note in uncertain_information:
        if note and note.strip():
            excluded.append(
                ExcludedInformation(
                    field="uncertain_information",
                    reason="Marked uncertain during extraction",
                    detail=note,
                )
            )
