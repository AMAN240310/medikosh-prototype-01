"""
FastAPI Smart Scheduling Engine.

Receives the top eligible/ranked doctors from the Node.js allocation engine
and returns the best available doctor + time slot, plus alternatives.
Gemini and Node.js never touch time slots directly — this service owns all
scheduling logic so it can later be swapped for a Google OR-Tools solver
without changing anything upstream.
"""

from fastapi import FastAPI, HTTPException

from .models import SchedulingRequest, SchedulingResponse
from .scheduler import find_best_doctor_and_slot

app = FastAPI(
    title="Doctor Allocation - Smart Scheduling Engine",
    description="Generates conflict-free appointment slots and performs the final doctor+time selection.",
    version="1.0.0",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/schedule", response_model=SchedulingResponse)
def schedule(request: SchedulingRequest) -> SchedulingResponse:
    """
    Steps 5 & 6: given the top-ranked eligible doctors, generate available
    time slots and jointly select the best doctor + time pairing.
    """
    try:
        return find_best_doctor_and_slot(request)
    except Exception as exc:  # noqa: BLE001 - deliberately surfaced to the caller
        raise HTTPException(status_code=500, detail=str(exc)) from exc
