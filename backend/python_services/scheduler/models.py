"""
Pydantic models for the Smart Scheduling Engine.

The Node.js backend sends a SchedulingRequest containing the top eligible,
ranked doctors (Steps 2-4 already done in Node). This service is only
responsible for turning "doctor + existing appointments" into "doctor + time
slot", and for making the final joint doctor/time decision (Step 6).
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Urgency = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class WorkingHours(BaseModel):
    start: str = Field(..., description="HH:MM, 24-hour clock")
    end: str = Field(..., description="HH:MM, 24-hour clock")


class Appointment(BaseModel):
    patientId: str
    start: str  # ISO 8601 datetime
    end: str  # ISO 8601 datetime


class SchedulingRequestDoctor(BaseModel):
    doctorId: str
    name: str
    specialty: str
    rankScore: float = Field(..., ge=0, le=100)
    workingHours: WorkingHours
    appointments: List[Appointment] = Field(default_factory=list)
    currentPatients: int = Field(..., ge=0)
    maxPatientsPerDay: int = Field(..., ge=0)
    emergencyCapable: bool = False


class SchedulingRequest(BaseModel):
    urgency: Urgency
    durationMinutes: int = Field(..., gt=0, le=240)
    requestDate: Optional[str] = Field(
        default=None, description="ISO date (YYYY-MM-DD). Defaults to today if omitted."
    )
    doctors: List[SchedulingRequestDoctor]

    @field_validator("doctors")
    @classmethod
    def must_have_doctors(cls, v: List[SchedulingRequestDoctor]) -> List[SchedulingRequestDoctor]:
        if not v:
            raise ValueError("At least one candidate doctor is required")
        return v


class SchedulingResultOption(BaseModel):
    doctorId: str
    start: str  # ISO 8601 datetime
    end: str  # ISO 8601 datetime
    combinedScore: float
    waitMinutes: float


class SchedulingResponse(BaseModel):
    best: Optional[SchedulingResultOption]
    alternatives: List[SchedulingResultOption]
