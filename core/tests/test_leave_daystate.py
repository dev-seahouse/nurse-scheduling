"""Focused tests for the first-class LEAVE day-state (Option C).

These assert the three leave invariants directly, rather than via the
snapshot-based regression harness (which also requires a unique optimal
solution that a symmetric scheduling scenario does not have):

  INV1  Leave is input-only: the solver never invents leave. Only the
        (person, date) cells pinned by a LEAVE shift request render "Leave".
  INV2  Leave provides no coverage: a nurse on leave does not satisfy any
        shift-type requirement, so someone else must cover.
  INV3  Leave is always honored: a LEAVE shift request is a hard pin.

Plus the shift-count hour credit and the coverage-forbid validation rules.
"""

# This file is part of Nurse Scheduling Project, see <https://github.com/j3soon/nurse-scheduling>.
#
# Copyright (C) 2023-2026 Johnson Sun
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nurse_scheduling
import pytest


def _run(yaml_text: str):
    df, solution, score, status, _cell_export_info = nurse_scheduling.schedule(yaml_text.encode("utf-8"))
    return df, status


def _cell(df, person_row: int, date_col: int):
    # Non-prettify layout: 2 leading rows (day number, weekday), 1 leading
    # column (person id), no history columns.
    return df.iloc[2 + person_row, 1 + date_col]


def _count_leave_cells(df) -> int:
    return int((df == "Leave").to_numpy().sum())


# --- INV1 (input-only) + INV2 (no coverage) + INV3 (honored) + rendering ---
LEAVE_COVERAGE_SCENARIO = """
apiVersion: alpha
description: Leave honored, excluded from coverage, never invented
dates:
  range:
    startDate: 2026-02-01
    endDate: 2026-02-04
people:
  items:
    - id: 0
    - id: 1
shiftTypes:
  items:
    - id: D
preferences:
  - type: at most one shift per day
  - type: shift type requirement
    description: Exactly one nurse on D every date
    shiftType: D
    requiredNumPeople: 1
  - type: shift request
    description: Nurse 0 on paid leave Feb 2 (hard pin)
    person: 0
    date: 2
    shiftType: LEAVE
    weight: .inf
"""


def test_leave_is_honored_excluded_from_coverage_and_not_invented():
    df, status = _run(LEAVE_COVERAGE_SCENARIO)
    assert status in ("OPTIMAL", "FEASIBLE")

    # INV3: the pinned leave day renders "Leave".
    assert _cell(df, person_row=0, date_col=1) == "Leave"

    # INV1: leave is not invented anywhere else. Exactly one "Leave" cell.
    assert _count_leave_cells(df) == 1

    # INV2: nurse 0 provides no coverage on the leave day, so nurse 1 must be
    # the single required person on D that date.
    assert _cell(df, person_row=1, date_col=1) == "D"


# --- Hour credit: leave contributes its credited hours to a shift count. ---
LEAVE_HOURS_SCENARIO = """
apiVersion: alpha
description: Exact monthly hours only reachable if leave credits 8h (16 half-hours)
dates:
  range:
    startDate: 2026-02-01
    endDate: 2026-02-02
people:
  items:
    - id: 0
shiftTypes:
  items:
    - id: D
      description: 8h day shift
preferences:
  - type: at most one shift per day
  - type: shift type requirement
    description: Nurse 0 works D on Feb 2
    shiftType: D
    date: 2
    requiredNumPeople: 1
  - type: shift request
    description: Nurse 0 on paid leave Feb 1 (hard pin)
    person: 0
    date: 1
    shiftType: LEAVE
    weight: .inf
  - type: shift count
    description: >-
      Worked hours + paid-leave credit must equal exactly 16h (32 half-hours).
      Only reachable if the leave day credits 16 half-hours.
    person: 0
    countDates: ALL
    countShiftTypes: [D, LEAVE]
    countShiftTypeCoefficients:
      - [D, 16]
      - [LEAVE, 16]
    expression: 'x = T'
    target: 32
    weight: .inf
"""


def test_leave_credits_hours_toward_shift_count():
    df, status = _run(LEAVE_HOURS_SCENARIO)
    # If leave credited 0 (like OFF), x would be 16 != 32 and the hard exact
    # target would be infeasible. OPTIMAL proves the 16-half-hour leave credit.
    assert status == "OPTIMAL"
    assert _cell(df, person_row=0, date_col=0) == "Leave"
    assert _cell(df, person_row=0, date_col=1) == "D"


# --- Validation: LEAVE forbidden as a reserved id and in coverage rules. ---
LEAVE_AS_SHIFT_TYPE_SCENARIO = """
apiVersion: alpha
dates:
  range:
    startDate: 2026-02-01
    endDate: 2026-02-01
people:
  items:
    - id: 0
shiftTypes:
  items:
    - id: LEAVE
preferences:
  - type: at most one shift per day
"""

LEAVE_IN_REQUIREMENT_SCENARIO = """
apiVersion: alpha
dates:
  range:
    startDate: 2026-02-01
    endDate: 2026-02-01
people:
  items:
    - id: 0
shiftTypes:
  items:
    - id: D
preferences:
  - type: at most one shift per day
  - type: shift type requirement
    shiftType: LEAVE
    requiredNumPeople: 1
"""

LEAVE_IN_COVERING_SCENARIO = """
apiVersion: alpha
dates:
  range:
    startDate: 2026-02-01
    endDate: 2026-02-01
people:
  items:
    - id: 0
    - id: 1
shiftTypes:
  items:
    - id: D
preferences:
  - type: at most one shift per day
  - type: shift type covering
    preceptors: [0]
    preceptees: [1]
    shiftTypes: [LEAVE]
"""


def test_leave_cannot_be_a_user_shift_type():
    with pytest.raises(ValueError, match="reserved"):
        _run(LEAVE_AS_SHIFT_TYPE_SCENARIO)


def test_leave_forbidden_in_shift_type_requirement():
    with pytest.raises(ValueError, match="LEAVE"):
        _run(LEAVE_IN_REQUIREMENT_SCENARIO)


def test_leave_forbidden_in_shift_type_covering():
    with pytest.raises(ValueError, match="LEAVE"):
        _run(LEAVE_IN_COVERING_SCENARIO)


# --- ALL excludes leave (INV2) in shift type successions, not just coverage. ---
LEAVE_DOES_NOT_SATISFY_ALL_SUCCESSION_SCENARIO = """
apiVersion: alpha
description: A pinned leave day must not satisfy a hard 'work any shift' (ALL) succession
dates:
  range:
    startDate: 2026-02-01
    endDate: 2026-02-01
people:
  items:
    - id: 0
shiftTypes:
  items:
    - id: D
preferences:
  - type: at most one shift per day
  - type: shift request
    description: Nurse 0 on paid leave Feb 1 (hard pin)
    person: 0
    date: 1
    shiftType: LEAVE
    weight: .inf
  - type: shift type successions
    description: Nurse 0 must work any shift (ALL) - a leave day must NOT satisfy this
    person: 0
    pattern: [ALL]
    weight: .inf
"""


def test_leave_does_not_satisfy_all_succession():
    # The leave pin forces leaves==1; the hard ALL succession forces a worked
    # shift. Since ALL excludes leave, these conflict and the model is infeasible.
    _df, status = _run(LEAVE_DOES_NOT_SATISFY_ALL_SUCCESSION_SCENARIO)
    assert status == "INFEASIBLE"
