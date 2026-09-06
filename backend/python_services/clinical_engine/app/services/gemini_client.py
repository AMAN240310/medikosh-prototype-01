"""
Thin async client for the Gemini Developer API's generateContent endpoint.

Cycles through a pool of API keys on failure, mirroring the key-pool
failover pattern already used in the SIH 26047 voice intake agent. Two
entry points are exposed:

  - generate_json(prompt, response_schema) -> dict   (stage 1)
  - generate_text(prompt)                  -> str    (stage 4)

Reuses one httpx.AsyncClient across every call (pass one in via
`http_client=` when you have a shared, lifespan-managed client - e.g. from
a FastAPI app; otherwise this owns and lazily creates its own, and
aclose() tears down only what it created itself).
"""
from __future__ import annotations

import itertools
import json
from dataclasses import dataclass
from typing import Any, Optional

import httpx

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"


@dataclass(frozen=True)
class GeminiAttemptError:
    """One failed attempt within a (possibly multi-key) Gemini call. Never
    carries the API key itself - only which position in the pool it was."""

    key_index: int
    error_type: str  # "timeout" | "connection" | "http_status" | "invalid_response"
    http_status: Optional[int]
    message: str
    schema_retry_attempted: bool


class GeminiCallError(RuntimeError):
    """Raised when Gemini cannot produce a usable response after every key
    in the pool (and, where applicable, the no-schema retry) has been
    exhausted - or immediately, if no keys are configured at all."""

    def __init__(
        self,
        model: str,
        attempts: Optional[list[GeminiAttemptError]] = None,
        message: Optional[str] = None,
    ):
        self.model = model
        self.attempts = attempts or []
        super().__init__(message or self._build_message())

    def _build_message(self) -> str:
        if not self.attempts:
            return f"Gemini request failed. Model: {self.model}."
        lines = [
            f"Gemini request failed for all {len(self.attempts)} API key(s). "
            f"Model: {self.model}."
        ]
        for attempt in self.attempts:
            line = f"  - key #{attempt.key_index + 1}: {attempt.error_type}"
            if attempt.http_status is not None:
                line += f" (HTTP {attempt.http_status})"
            if attempt.schema_retry_attempted:
                line += " [schema retry attempted]"
            line += f" - {attempt.message}"
            lines.append(line)
        return "\n".join(lines)


class _AttemptFailed(Exception):
    """Internal-only: one HTTP attempt within _call_once failed. Caught and
    converted into a GeminiAttemptError by the calling key-pool loop."""

    def __init__(self, error_type: str, http_status: Optional[int], message: str,
                 schema_retry_attempted: bool):
        self.error_type = error_type
        self.http_status = http_status
        self.message = message
        self.schema_retry_attempted = schema_retry_attempted
        super().__init__(message)


class GeminiClient:
    def __init__(
        self,
        api_keys: list[str],
        model: str,
        http_client: Optional[httpx.AsyncClient] = None,
        timeout: float = 20.0,
    ):
        # Deliberately does NOT raise on an empty key list here: this
        # lets a FastAPI app construct (and lifespan-manage) a
        # GeminiClient at startup even before .env is filled in. The
        # clear, specific error instead comes from _generate(), the
        # moment a call actually needs a key.
        self._keys = list(api_keys)
        self._key_cycle = itertools.cycle(self._keys) if self._keys else None
        self.model = model
        self.timeout = timeout
        self._endpoint = f"{GEMINI_API_BASE}/models/{model}:generateContent"
        self._owns_http_client = http_client is None
        self._http_client = http_client or httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        if self._owns_http_client:
            await self._http_client.aclose()

    async def generate_json(
        self,
        prompt: str,
        response_schema: Optional[dict] = None,
        temperature: float = 0.0,
    ) -> dict[str, Any]:
        text = await self._generate(
            prompt,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=response_schema,
        )
        return _parse_json(text, model=self.model)

    async def generate_text(self, prompt: str, temperature: float = 0.2) -> str:
        text = await self._generate(
            prompt,
            temperature=temperature,
            response_mime_type=None,
            response_schema=None,
        )
        return text.strip()

    async def _generate(
        self,
        prompt: str,
        *,
        temperature: float,
        response_mime_type: Optional[str],
        response_schema: Optional[dict],
    ) -> str:
        if not self._keys:
            raise GeminiCallError(
                self.model,
                message=(
                    f"Gemini is not configured: no API key found for model "
                    f"'{self.model}'. Set GEMINI_API_KEYS or GEMINI_API_KEY."
                ),
            )

        attempts: list[GeminiAttemptError] = []
        for key_index in range(len(self._keys)):
            api_key = next(self._key_cycle)
            try:
                return await self._call_once(
                    prompt, api_key, temperature, response_mime_type, response_schema
                )
            except _AttemptFailed as exc:
                attempts.append(
                    GeminiAttemptError(
                        key_index=key_index,
                        error_type=exc.error_type,
                        http_status=exc.http_status,
                        message=self._redact(exc.message),
                        schema_retry_attempted=exc.schema_retry_attempted,
                    )
                )
                continue
        raise GeminiCallError(self.model, attempts=attempts)

    async def _call_once(
        self,
        prompt: str,
        api_key: str,
        temperature: float,
        response_mime_type: Optional[str],
        response_schema: Optional[dict],
    ) -> str:
        generation_config: dict[str, Any] = {"temperature": temperature}
        if response_mime_type:
            generation_config["responseMimeType"] = response_mime_type
        if response_schema is not None:
            generation_config["responseSchema"] = response_schema

        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": generation_config,
        }
        headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}

        resp = await self._post(headers, body, schema_retry_attempted=False)

        if resp.status_code == 400 and response_schema is not None:
            # The schema may have been rejected outright - retry once
            # without it. The prompt text already spells out the exact
            # OUTPUT shape, so responseMimeType alone still steers the
            # model toward valid, correctly-shaped JSON.
            generation_config = dict(generation_config)
            generation_config.pop("responseSchema", None)
            body["generationConfig"] = generation_config
            resp = await self._post(headers, body, schema_retry_attempted=True)

        if resp.status_code >= 400:
            raise _AttemptFailed(
                "http_status", resp.status_code, _safe_body_excerpt(resp),
                schema_retry_attempted=(resp.status_code == 400 and response_schema is not None),
            )

        try:
            data = resp.json()
        except ValueError as exc:
            raise _AttemptFailed(
                "invalid_response", resp.status_code,
                f"Response body was not valid JSON: {exc}", schema_retry_attempted=False,
            ) from exc

        try:
            return _extract_text(data)
        except _ResponseShapeError as exc:
            raise _AttemptFailed(
                "invalid_response", resp.status_code, str(exc), schema_retry_attempted=False,
            ) from exc

    async def _post(self, headers: dict, body: dict, *, schema_retry_attempted: bool) -> httpx.Response:
        try:
            return await self._http_client.post(self._endpoint, headers=headers, json=body)
        except httpx.TimeoutException as exc:
            raise _AttemptFailed(
                "timeout", None, f"Request timed out after {self.timeout}s",
                schema_retry_attempted,
            ) from exc
        except httpx.HTTPError as exc:
            raise _AttemptFailed(
                "connection", None, f"{type(exc).__name__}: {exc}", schema_retry_attempted,
            ) from exc

    def _redact(self, text: str) -> str:
        # Defense in depth on top of the fact that the key only ever
        # travels in a request header (never the URL or body we might
        # echo back): if a configured key's literal value ever shows up
        # in an error string for any reason, scrub it before it can reach
        # a log or an API response.
        redacted = text
        for key in self._keys:
            if key:
                redacted = redacted.replace(key, "***REDACTED***")
        return redacted


class _ResponseShapeError(Exception):
    """Internal-only: the response was valid JSON but not shaped like a
    normal generateContent response."""


def _extract_text(data: dict) -> str:
    try:
        candidates = data["candidates"]
        parts = candidates[0]["content"]["parts"]
        return "".join(part.get("text", "") for part in parts)
    except (KeyError, IndexError, TypeError) as exc:
        raise _ResponseShapeError(f"Unexpected Gemini response shape: {data}") from exc


def _safe_body_excerpt(resp: httpx.Response, limit: int = 300) -> str:
    try:
        body = resp.text
    except Exception:
        return "(response body unavailable)"
    return body[:limit] + ("..." if len(body) > limit else "")


def _parse_json(text: str, model: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Defensive: strip markdown fences in case the model adds them
        # despite JSON mode being requested.
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise GeminiCallError(
            model=model,
            message=(
                f"Gemini request succeeded (Model: {model}) but the response text "
                f"wasn't valid JSON: {exc}\nRaw text (first 500 chars): {cleaned[:500]}"
            ),
        ) from exc
