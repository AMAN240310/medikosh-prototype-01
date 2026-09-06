"""
Central configuration for the scheduling engine.

Kept separate so slot-generation granularity, buffers, and (later) solver
parameters can be tuned without touching business logic in scheduler.py.
"""

from datetime import time

# Granularity used when scanning for open slots (minutes).
SLOT_STEP_MINUTES = 5

# Small buffer inserted after an appointment before the next one can start,
# to avoid unrealistic zero-gap back-to-back scheduling. Set to 0 to disable.
BUFFER_MINUTES = 0

# How many days ahead to search if a doctor has no room on the requested day.
# This is what guarantees "return the earliest suitable option" even when
# today is fully booked, rather than failing outright.
MAX_DAYS_AHEAD = 5

# Default clinic day boundaries used only as a fallback if a doctor record
# is somehow missing working hours.
DEFAULT_DAY_START = time(9, 0)
DEFAULT_DAY_END = time(17, 0)

# Timezone used for all slot generation. Change to match the deployment
# region; all doctor working hours and appointments are treated as local.
TIMEZONE = "Asia/Kolkata"

# --- Reserved for future Google OR-Tools integration ------------------------
# When multi-doctor, multi-constraint optimization is needed (e.g. balancing
# load across an entire department, or solving many patients at once), swap
# `scheduler.find_best_doctor_and_slot` for a CP-SAT model built here. The
# request/response schemas in models.py are already shaped so a solver-backed
# implementation can be a drop-in replacement without touching main.py or the
# Node.js caller.
USE_OR_TOOLS = False
