"""
Core slot-generation & doctor+time selection algorithm (Steps 5 & 6).

This is intentionally a straightforward greedy/scoring algorithm rather than
a constraint solver. `config.USE_OR_TOOLS` and the shaped request/response
models in models.py make it straightforward to swap in a CP-SAT (Google
OR-Tools) model later without changing the API contract that Node.js talks to.

FIX (past-slot prevention): all "current time" comparisons go through a single
`now` reference that is always timezone-aware in `Asia/Kolkata`. `now` is an
optional parameter on the public entry points specifically so tests can pin
it to a fixed instant instead of depending on the wall clock — the production
code path (main.py) never passes it, so it always defaults to the real
current time.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from . import config
from .models import (
    Appointment,
    SchedulingRequest,
    SchedulingRequestDoctor,
    SchedulingResponse,
    SchedulingResultOption,
)

LOCAL_TZ = ZoneInfo(config.TIMEZONE)


def current_time() -> datetime:
    """Single source of truth for 'now', always timezone-aware in LOCAL_TZ."""
    return datetime.now(LOCAL_TZ)


def _parse_hhmm(value: str) -> time:
    hour, minute = value.split(":")
    return time(int(hour), int(minute))


def _parse_iso(value: str) -> datetime:
    """Parse an ISO datetime and ensure it is timezone-aware in LOCAL_TZ.

    Naive strings (no offset) are assumed to already represent LOCAL_TZ wall
    time. Aware strings are converted. This function is the only place where
    a naive datetime is allowed to exist in this module — everything it
    returns is timezone-aware, per the "all datetime values must be
    timezone-aware" requirement.
    """
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=LOCAL_TZ)
    return dt.astimezone(LOCAL_TZ)


def _overlaps(start: datetime, end: datetime, appt: Appointment) -> bool:
    appt_start = _parse_iso(appt.start)
    appt_end = _parse_iso(appt.end)
    return start < appt_end and end > appt_start


def _round_up_to_step(cursor: datetime, grid_origin: datetime, step: timedelta) -> datetime:
    """Round `cursor` up to the next boundary of a step-minute grid anchored
    at `grid_origin` (so slots land on natural times like 09:00, 09:05, ...
    rather than an arbitrary "now" second)."""
    if step.total_seconds() <= 0:
        return cursor
    remainder = (cursor - grid_origin) % step
    if remainder != timedelta(0):
        cursor += step - remainder
    return cursor


def _generate_slots_for_doctor(
    doctor: SchedulingRequestDoctor,
    duration_minutes: int,
    search_date: date,
    earliest_start: datetime,
    now: datetime,
) -> List[datetime]:
    """
    Generate conflict-free candidate slot start times for one doctor on one
    calendar day, respecting working hours, existing appointments, and the
    hard rule that a slot can never start at or before `now`.
    """
    day_start_t = _parse_hhmm(doctor.workingHours.start)
    day_end_t = _parse_hhmm(doctor.workingHours.end)

    day_start = datetime.combine(search_date, day_start_t, tzinfo=LOCAL_TZ)
    day_end = datetime.combine(search_date, day_end_t, tzinfo=LOCAL_TZ)

    step = timedelta(minutes=config.SLOT_STEP_MINUTES)

    cursor = max(day_start, earliest_start)
    cursor = _round_up_to_step(cursor, day_start, step)

    # Hard guarantee: never return a slot at or before "now", even if the
    # rounding above happened to land exactly on `now` (e.g. now is already
    # slot-aligned). Keep bumping forward until strictly in the future.
    if search_date == now.date():
        while cursor <= now:
            cursor += step if step.total_seconds() > 0 else timedelta(minutes=1)

    duration = timedelta(minutes=duration_minutes)
    buffer_after = timedelta(minutes=config.BUFFER_MINUTES)

    slots: List[datetime] = []
    while cursor + duration <= day_end:
        candidate_end = cursor + duration
        conflict = any(
            _overlaps(cursor, candidate_end + buffer_after, appt) for appt in doctor.appointments
        )
        if not conflict and cursor > now:
            slots.append(cursor)
        cursor += step

    return slots


def _workload_fraction(doctor: SchedulingRequestDoctor) -> float:
    """0 (empty schedule) .. 1 (fully booked) — used to avoid dogpiling one doctor."""
    if doctor.maxPatientsPerDay <= 0:
        return 0.0
    return min(1.0, doctor.currentPatients / doctor.maxPatientsPerDay)


# Weight profiles for Step 6's joint doctor+time scoring, keyed by urgency.
# HIGH weighs availability more heavily than normal cases (waiting time
# matters more); CRITICAL weighs it more heavily still.
_SCORE_WEIGHTS = {
    "LOW": {"suitability": 0.55, "availability": 0.30, "workload": 0.15},
    "MEDIUM": {"suitability": 0.55, "availability": 0.30, "workload": 0.15},
    "HIGH": {"suitability": 0.45, "availability": 0.42, "workload": 0.13},
    "CRITICAL": {"suitability": 0.25, "availability": 0.65, "workload": 0.10},
}

_MAX_WAIT_REFERENCE_MINUTES = {
    "LOW": 240.0,
    "MEDIUM": 240.0,
    "HIGH": 120.0,
    "CRITICAL": 60.0,
}


def _score_option(doctor: SchedulingRequestDoctor, wait_minutes: float, urgency: str) -> float:
    """
    STEP 6: joint doctor+time scoring.

    Combines the Node.js suitability rank (0-100 — which already encodes
    clinical eligibility, since Node never sends a clinically-ineligible
    doctor here) with how soon the slot is and how loaded the doctor already
    is, so a slightly-lower-ranked doctor with a much earlier opening can
    beat the #1-ranked doctor. Clinical eligibility itself is never
    re-litigated here — it was already enforced upstream in Node.js before
    this doctor was ever included in the request.
    """
    suitability = doctor.rankScore / 100.0

    max_wait_reference = _MAX_WAIT_REFERENCE_MINUTES.get(urgency, 240.0)
    waiting_penalty = min(1.0, wait_minutes / max_wait_reference)
    availability = 1.0 - waiting_penalty

    workload = 1.0 - _workload_fraction(doctor)

    weights = _SCORE_WEIGHTS.get(urgency, _SCORE_WEIGHTS["MEDIUM"])

    score = (
        suitability * weights["suitability"]
        + availability * weights["availability"]
        + workload * weights["workload"]
    )
    return score * 100.0


def find_best_doctor_and_slot(
    request: SchedulingRequest, now: Optional[datetime] = None
) -> SchedulingResponse:
    """
    Steps 5 + 6 combined.

    Generates conflict-free, never-in-the-past candidate slots for every
    candidate doctor on the requested day, and if none of them have room,
    walks forward day by day (up to config.MAX_DAYS_AHEAD) so the system
    always returns the earliest suitable option rather than failing
    outright. Doctor + slot pairs are then jointly scored so the final pick
    balances suitability, wait time, and workload.

    `now` is injectable for tests; production code always uses the real
    current time in Asia/Kolkata.
    """
    now = now if now is not None else current_time()
    if now.tzinfo is None:
        raise ValueError("`now` must be timezone-aware")

    start_date = date.fromisoformat(request.requestDate) if request.requestDate else now.date()

    for day_offset in range(config.MAX_DAYS_AHEAD + 1):
        search_date = start_date + timedelta(days=day_offset)

        if search_date == now.date():
            # Today: never search earlier than the current moment.
            earliest_start = now
        elif search_date < now.date():
            # A requestDate in the past was explicitly provided — treat "now"
            # as the floor so we still never return a past slot, but keep
            # searching forward from today rather than from the stale date.
            search_date = now.date()
            earliest_start = now
        else:
            earliest_start = datetime.combine(search_date, time(0, 0), tzinfo=LOCAL_TZ)

        all_options: List[SchedulingResultOption] = []

        for doctor in request.doctors:
            slots = _generate_slots_for_doctor(
                doctor, request.durationMinutes, search_date, earliest_start, now
            )
            if not slots:
                continue

            # Only the doctor's earliest slot is worth surfacing — later
            # slots for the same doctor are strictly dominated by it.
            slot_start = slots[0]
            slot_end = slot_start + timedelta(minutes=request.durationMinutes)
            wait_minutes = max(0.0, (slot_start - now).total_seconds() / 60.0)

            all_options.append(
                SchedulingResultOption(
                    doctorId=doctor.doctorId,
                    start=slot_start.isoformat(),
                    end=slot_end.isoformat(),
                    combinedScore=round(_score_option(doctor, wait_minutes, request.urgency), 2),
                    waitMinutes=round(wait_minutes, 1),
                )
            )

        if all_options:
            all_options.sort(key=lambda o: o.combinedScore, reverse=True)
            return SchedulingResponse(best=all_options[0], alternatives=all_options[1:4])

    # No candidate doctor had any room within the search window at all.
    return SchedulingResponse(best=None, alternatives=[])
