"""
Stage 3.5: deterministic relevance prioritization. Sits between SAFE_FACTS
and the stage-4 doctor summary, and MUST NOT call an LLM - everything here
is plain code operating only on facts SAFE_FACTS already contains.

What it does, in order:
  1. Identify the chief concern - the value of a `chief_complaint` fact if
     one exists, else the first `symptom` fact, else None. Never invented:
     if neither exists, chief_concern stays null and nothing downstream
     pretends otherwise.
  2. Reduce redundancy - within each canonical field, drop a fact whose
     value is a strictly less-specific restatement of another fact's
     value in the same field (e.g. "knee pain" folds into "persistent
     right knee pain"). Only ever drops a near-duplicate; never rewrites
     or merges values into new text - that stays out of deterministic
     code, and stage 4's own prompt is what asks the LLM to phrase the
     surviving facts as flowing prose.
  3. Tier and order - every surviving fact gets a HIGH/MEDIUM/LOW tier
     from field_taxonomy's priority table. Within a tier, facts whose
     value shares a topic word with the chief concern sort first.
     MEDIUM-tier "context" fields (allergy, surgical/social/family
     history) that share no topic word with an identified chief concern
     are demoted to LOW for the concise summary - not deleted, just
     deprioritized; the full SAFE_FACTS result upstream is untouched and
     low_priority_facts is still returned for inspection.

Evidence is preserved on every fact through all of this - nothing here
ever discards or rewrites the `evidence` field.
"""
from __future__ import annotations

from collections import defaultdict

from app.models.schemas import (
    PrioritizedFact,
    PrioritizedSafeFacts,
    PriorityTier,
    SafeFact,
    SafeValidatedData,
)
from app.services.field_taxonomy import (
    content_tokens,
    get_field_priority,
    is_relevance_gated,
    normalize_field,
)


def prioritize_safe_facts(safe_data: SafeValidatedData) -> PrioritizedSafeFacts:
    if not safe_data.safe_facts:
        # Nothing to group/rank/dedupe - skip straight to an (almost)
        # empty result rather than doing pointless work over empty lists.
        return PrioritizedSafeFacts(
            validated_medicines=safe_data.validated_medicines,
            excluded_information=safe_data.excluded_information,
            conflicts=safe_data.conflicts,
        )

    chief_concern = _identify_chief_concern(safe_data.safe_facts)
    focus_tokens = content_tokens(chief_concern) if chief_concern else set()

    deduped = _deduplicate_within_field(safe_data.safe_facts)

    tiered: dict[PriorityTier, list[tuple[tuple[int, int], PrioritizedFact]]] = {
        PriorityTier.HIGH: [],
        PriorityTier.MEDIUM: [],
        PriorityTier.LOW: [],
    }

    for fact in deduped:
        canonical = normalize_field(fact.field)
        tier, rank = get_field_priority(canonical)
        overlaps_focus = bool(focus_tokens & content_tokens(fact.value))

        # Only "context" MEDIUM fields get relevance-gated, and only when
        # we actually have a chief concern to compare against - never
        # demote HIGH-tier clinical facts, and never guess relevance when
        # there's nothing identified to be relevant to.
        if (
            tier is PriorityTier.MEDIUM
            and is_relevance_gated(canonical)
            and focus_tokens
            and not overlaps_focus
        ):
            tier = PriorityTier.LOW

        prioritized_fact = PrioritizedFact(
            field=canonical,
            value=fact.value,
            evidence=fact.evidence,
            source_type=fact.source_type,
            tier=tier,
        )
        sort_key = (0 if overlaps_focus else 1, rank)
        tiered[tier].append((sort_key, prioritized_fact))

    def ordered(tier: PriorityTier) -> list[PrioritizedFact]:
        return [fact for _, fact in sorted(tiered[tier], key=lambda pair: pair[0])]

    return PrioritizedSafeFacts(
        chief_concern=chief_concern,
        high_priority_facts=ordered(PriorityTier.HIGH),
        medium_priority_facts=ordered(PriorityTier.MEDIUM),
        low_priority_facts=ordered(PriorityTier.LOW),
        validated_medicines=safe_data.validated_medicines,
        excluded_information=safe_data.excluded_information,
        conflicts=safe_data.conflicts,
    )


def _identify_chief_concern(safe_facts: list[SafeFact]) -> str | None:
    for fact in safe_facts:
        if normalize_field(fact.field) == "chief_complaint":
            return fact.value
    for fact in safe_facts:
        if normalize_field(fact.field) == "symptom":
            return fact.value
    return None


def _deduplicate_within_field(facts: list[SafeFact]) -> list[SafeFact]:
    grouped: dict[str, list[SafeFact]] = defaultdict(list)
    for fact in facts:
        grouped[normalize_field(fact.field)].append(fact)

    kept: list[SafeFact] = []
    for group in grouped.values():
        # Most content-token-rich (most specific) first, so a shorter
        # restatement gets the chance to fold into a fuller one already
        # marked "keep" rather than the other way around.
        ordered_group = sorted(group, key=lambda f: len(content_tokens(f.value)), reverse=True)
        kept_in_group: list[SafeFact] = []
        for fact in ordered_group:
            fact_tokens = content_tokens(fact.value)
            is_subsumed = bool(fact_tokens) and any(
                fact_tokens <= content_tokens(k.value) for k in kept_in_group
            )
            if not is_subsumed:
                kept_in_group.append(fact)
        kept.extend(kept_in_group)
    return kept
