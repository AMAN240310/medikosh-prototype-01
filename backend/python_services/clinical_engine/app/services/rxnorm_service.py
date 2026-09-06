"""
Async client for validating medicine names against the public RxNorm REST
API (NIH/NLM, no API key required).

Validation strategy, chosen to respect the "do not silently correct the
medicine name" rule from the spec:

  1. Normalized-match lookup (search=1): ignores case, punctuation, word
     order, salt forms, and known abbreviations - NOT spelling. If this
     finds a concept, the medicine is VALID and validated_name is RxNorm's
     own canonical name for it.
  2. If nothing is found, we optionally ask RxNorm's approximate-match
     endpoint for a "did you mean" candidate, purely for human review.
     status stays UNVERIFIED and validated_name stays null either way -
     the suggestion is never auto-applied as the validated name.

Reuses one httpx.AsyncClient across every call (pass one in via
`http_client=` for a shared, lifespan-managed client; otherwise this owns
and lazily creates its own - see aclose()). validate_many() also caches
within its own call, keyed by normalized raw medicine name, so the same
drug name appearing more than once in one batch only triggers one RxNorm
lookup - the cached verdict never changes what the safety result would
have been for an uncached lookup, only how many times it's fetched.
"""
from __future__ import annotations

import asyncio
import re
from typing import Optional

import httpx

from app.models.schemas import MedicineToValidate, RxNormResult, RxNormStatus


def _normalize_medicine_name(raw_name: str) -> str:
    return re.sub(r"\s+", " ", (raw_name or "").strip().lower())


class RxNormService:
    def __init__(
        self,
        base_url: str,
        http_client: Optional[httpx.AsyncClient] = None,
        timeout: float = 15.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._owns_http_client = http_client is None
        self._http_client = http_client or httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        if self._owns_http_client:
            await self._http_client.aclose()

    async def validate_medicine(
        self,
        raw_name: str,
        dosage: Optional[str] = None,
        frequency: Optional[str] = None,
        evidence: Optional[str] = None,
    ) -> RxNormResult:
        cleaned = (raw_name or "").strip()
        if not cleaned:
            return RxNormResult(
                raw_name=raw_name,
                dosage=dosage,
                frequency=frequency,
                evidence=evidence,
                exists_in_rxnorm=False,
                validated_name=None,
                status=RxNormStatus.UNVERIFIED,
            )

        rxcui = await self._normalized_lookup(cleaned)
        if rxcui:
            canonical_name = await self._get_canonical_name(rxcui)
            return RxNormResult(
                raw_name=raw_name,
                dosage=dosage,
                frequency=frequency,
                evidence=evidence,
                exists_in_rxnorm=True,
                validated_name=canonical_name or cleaned,
                status=RxNormStatus.VALID,
                rxcui=rxcui,
            )

        suggestion = await self._approximate_suggestion(cleaned)
        return RxNormResult(
            raw_name=raw_name,
            dosage=dosage,
            frequency=frequency,
            evidence=evidence,
            exists_in_rxnorm=False,
            validated_name=None,
            status=RxNormStatus.UNVERIFIED,
            suggested_name=suggestion,
        )

    async def validate_many(self, medicines: list[MedicineToValidate]) -> list[RxNormResult]:
        if not medicines:
            # No medicines extracted -> skip RxNorm entirely, no network
            # calls at all, straight back to an empty result list.
            return []

        # One representative MedicineToValidate per normalized raw name;
        # every occurrence of "Metformin" (however many times it repeats
        # in this batch) shares one concurrent RxNorm lookup below.
        representative_by_key: dict[str, MedicineToValidate] = {}
        for med in medicines:
            key = _normalize_medicine_name(med.raw_name)
            representative_by_key.setdefault(key, med)

        unique_keys = list(representative_by_key.keys())
        unique_verdicts = await asyncio.gather(
            *[
                self.validate_medicine(representative_by_key[key].raw_name)
                for key in unique_keys
            ]
        )
        verdict_by_key = dict(zip(unique_keys, unique_verdicts))

        # Re-attach each occurrence's own dosage/frequency/evidence to the
        # shared verdict - the cache only ever short-circuits the network
        # call, never the per-occurrence data that stage 3 needs to match
        # a result back to a specific medicines_to_validate entry.
        results: list[RxNormResult] = []
        for med in medicines:
            verdict = verdict_by_key[_normalize_medicine_name(med.raw_name)]
            results.append(
                RxNormResult(
                    raw_name=med.raw_name,
                    dosage=med.dosage,
                    frequency=med.frequency,
                    evidence=med.evidence,
                    exists_in_rxnorm=verdict.exists_in_rxnorm,
                    validated_name=verdict.validated_name,
                    status=verdict.status,
                    rxcui=verdict.rxcui,
                    suggested_name=verdict.suggested_name,
                )
            )
        return results

    async def _normalized_lookup(self, name: str) -> Optional[str]:
        try:
            resp = await self._http_client.get(
                f"{self.base_url}/rxcui.json", params={"name": name, "search": 1}
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError:
            return None
        rxnorm_ids = (data.get("idGroup") or {}).get("rxnormId")
        return rxnorm_ids[0] if rxnorm_ids else None

    async def _get_canonical_name(self, rxcui: str) -> Optional[str]:
        try:
            resp = await self._http_client.get(f"{self.base_url}/rxcui/{rxcui}/properties.json")
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError:
            return None
        return (data.get("properties") or {}).get("name")

    async def _approximate_suggestion(self, name: str) -> Optional[str]:
        try:
            resp = await self._http_client.get(
                f"{self.base_url}/approximateTerm.json",
                params={"term": name, "maxEntries": 1},
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError:
            return None
        candidates = (data.get("approximateGroup") or {}).get("candidate") or []
        if not candidates:
            return None
        top = candidates[0]
        if top.get("name"):
            return top["name"]
        rxcui = top.get("rxcui")
        if rxcui:
            return await self._get_canonical_name(rxcui)
        return None
