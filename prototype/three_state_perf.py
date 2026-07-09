"""PERFORMANCE STRESS (risk #6) - HONEST version.

The naive stress (fixed 3-shift coverage, scale nurses) is infeasible above 5
nurses in BOTH models - a scenario-arithmetic artifact, not a C defect
(see three_state_control.py). So that does not measure solver performance.

This file builds a scenario that STAYS FEASIBLE as nurses scale: light coverage
(>=1 LD, >=1 AM, >=1 PM per day) and hours as a soft upper bound, so the full
three-state (C variable structure is exercised at scale and we can compare
real solve time vs the original two-state model at 5 / 20 / 50 / 100 nurses
(the app targets ~100). The point is to measure whether the extra leave-variable
family per se slows CP-SAT - the actual risk #6 question.
"""

import time
from ortools.sat.python import cp_model

WORKED = ["LD", "AM1", "AM2", "AM3", "PM1", "PM2", "PM3"]
WORKED_HOURS = {"LD": 12.5, "AM1": 7, "AM2": 8, "AM3": 9, "PM1": 9, "PM2": 8, "PM3": 7}
AM = ["AM1", "AM2", "AM3"]
PM = ["PM1", "PM2", "PM3"]
UNIT = 0.5
TARGET_H = 160.0
N_DAYS = 28
LV_CREDIT_H = 8.0
LEAVE_INPUT = {0: {9, 10}}


def coeff(sid):
    return int(WORKED_HOURS[sid] / UNIT)


def daily_required(n_nurses):
    """Light coverage, always feasible at any scale: >=1 of each per day."""
    return 1, 1, 1  # (LD_req, AM_req, PM_req)


def build_three_state(n_nurses):
    m = cp_model.CpModel()
    shifts, leaves, offs = {}, {}, {}
    for d in range(N_DAYS):
        for p in range(n_nurses):
            offs[(d, p)] = m.new_bool_var(f"o_{d}_{p}")
            for s in range(len(WORKED)):
                shifts[(d, s, p)] = m.new_bool_var(f"s_{d}_{s}_{p}")
            leaves[(d, 0, p)] = m.new_bool_var(f"l_{d}_{p}")
    for d in range(N_DAYS):
        for p in range(n_nurses):
            ws = sum(shifts[(d, s, p)] for s in range(len(WORKED)))
            m.add(offs[(d, p)] + ws + leaves[(d, 0, p)] == 1)
    sid = {s: i for i, s in enumerate(WORKED)}
    am = [sid[x] for x in AM]
    pm = [sid[x] for x in PM]
    ld_r, am_r, pm_r = daily_required(n_nurses)
    for d in range(N_DAYS):
        m.add(sum(shifts[(d, sid["LD"], p)] for p in range(n_nurses)) >= ld_r)
        m.add(sum(shifts[(d, s, p)] for s in am for p in range(n_nurses)) >= am_r)
        m.add(sum(shifts[(d, s, p)] for s in pm for p in range(n_nurses)) >= pm_r)
    for w in range(N_DAYS // 7):
        for p in range(n_nurses):
            m.add(sum(offs[(d, p)] for d in range(w * 7, w * 7 + 7)) >= 2)
    for d in range(N_DAYS):
        for p in range(n_nurses):
            if p in LEAVE_INPUT and d in LEAVE_INPUT[p]:
                m.add(leaves[(d, 0, p)] == 1)
            else:
                m.add(leaves[(d, 0, p)] == 0)
    target_units = int(TARGET_H / UNIT)
    for p in range(n_nurses):
        worked = sum(coeff(WORKED[s]) * shifts[(d, s, p)] for d in range(N_DAYS) for s in range(len(WORKED)))
        m.add(worked <= target_units)
    return m, len(shifts) + len(leaves) + len(offs)


def build_original(n_nurses):
    ALL = WORKED + ["LV"]
    LV = len(WORKED)
    m = cp_model.CpModel()
    shifts, offs = {}, {}
    for d in range(N_DAYS):
        for s in range(len(ALL)):
            for p in range(n_nurses):
                shifts[(d, s, p)] = m.new_bool_var(f"s_{d}_{s}_{p}")
    for d in range(N_DAYS):
        for p in range(n_nurses):
            dp = sum(shifts[(d, s, p)] for s in range(len(ALL)))
            offs[(d, p)] = m.new_bool_var(f"o_{d}_{p}")
            m.add(offs[(d, p)] + dp == 1)
    sid = {s: i for i, s in enumerate(ALL)}
    am = [sid[x] for x in AM]
    pm = [sid[x] for x in PM]
    ld_r, am_r, pm_r = daily_required(n_nurses)
    for d in range(N_DAYS):
        m.add(sum(shifts[(d, sid["LD"], p)] for p in range(n_nurses)) >= ld_r)
        m.add(sum(shifts[(d, s, p)] for s in am for p in range(n_nurses)) >= am_r)
        m.add(sum(shifts[(d, s, p)] for s in pm for p in range(n_nurses)) >= pm_r)
    for w in range(N_DAYS // 7):
        for p in range(n_nurses):
            m.add(sum(offs[(d, p)] for d in range(w * 7, w * 7 + 7)) >= 2)
    for d in range(N_DAYS):
        for p in range(n_nurses):
            if p in LEAVE_INPUT and d in LEAVE_INPUT[p]:
                m.add(shifts[(d, LV, p)] == 1)
            else:
                m.add(shifts[(d, LV, p)] == 0)
    target_units = int(TARGET_H / UNIT)
    for p in range(n_nurses):
        worked = sum(coeff(WORKED[s]) * shifts[(d, s, p)] for d in range(N_DAYS) for s in range(len(WORKED)))
        m.add(worked <= target_units)
    return m, len(shifts) + len(offs)


def run(builder, name):
    print(f"\n{name}")
    print(f"{'nurses':>7} | {'status':>9} | {'time(s)':>8} | {'vars':>7}")
    for n in (5, 20, 50, 100):
        m, nvars = builder(n)
        s = cp_model.CpSolver()
        s.parameters.max_time_in_seconds = 60
        s.parameters.num_search_workers = 8
        t0 = time.perf_counter()
        st = s.solve(m)
        el = time.perf_counter() - t0
        print(f"{n:>7} | {s.status_name(st):>9} | {el:>8.3f} | {nvars:>7}")


if __name__ == "__main__":
    run(build_original, "ORIGINAL shift-type model (LV is a shift type)")
    run(build_three_state, "THREE-STATE model (C: leave is a peer day-state)")
