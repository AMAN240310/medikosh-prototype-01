"""
Configuration for the SIH 26047 clinical structuring & validation pipeline.

Settings are read from environment variables (see .env.example). If you want
file-based config, load a .env file yourself (e.g. via python-dotenv's
load_dotenv()) before calling get_settings().
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

# Automatically locate and load .env
_current_dir = Path(__file__).resolve().parent
_candidates = [
    _current_dir / ".env",
    _current_dir.parent / ".env",
    _current_dir.parent.parent / ".env",
]
for _candidate in _candidates:
    if _candidate.is_file():
        load_dotenv(dotenv_path=_candidate)
load_dotenv()


@dataclass(frozen=True)
class Settings:
    gemini_api_keys: list[str]
    gemini_model: str
    rxnorm_base_url: str
    request_timeout_seconds: float


def _load_gemini_keys() -> list[str]:
    # Supports either a single GEMINI_API_KEY or a comma-separated
    # GEMINI_API_KEYS pool, mirroring the key-pool failover pattern already
    # used in the SIH 26047 voice intake agent's backend.
    raw = os.getenv("GEMINI_API_KEYS", "").strip()
    if not raw:
        raw = os.getenv("GEMINI_API_KEY", "").strip()
    return [key.strip() for key in raw.split(",") if key.strip()]


def get_settings() -> Settings:
    return Settings(
        gemini_api_keys=_load_gemini_keys(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        rxnorm_base_url=os.getenv("RXNORM_BASE_URL", "https://rxnav.nlm.nih.gov/REST"),
        request_timeout_seconds=float(os.getenv("REQUEST_TIMEOUT_SECONDS", "20")),
    )
