"""CONTROL for the three-state spike: the ORIGINAL shift-type model
(LV is a normal shift type, today's approach) under the SAME fixed coverage
(1 LD + 1 AM + 1 PM per day), scaled across nurse counts.

Purpose: if this control is ALSO infeasible above 5 nurses, then the three-state
spike's infeasibility is a scenario-arithmetic artifact (the coverage/hours
numbers simply don't close with more people and only 3 shifts/day), NOT a defect
introduced by the three-state (C) model. That isolates risk #6 (performance)
from feasibility artifacts.
"""

import time
from ortools.sat.python import cp_model

WORKED = ["LD", "AM1", "AM2", "AM3", "PM1", "PM2", "PM3"]
WORKED_HOURS = {"LD": 12.5, "AM1": 7, "AM2": 8, "AM3": 9, "PM1": 9, "PM2": 8, "PM3": 7}
ALL_SHIFT_TYPES = WORKED + ["LV"]          # LV is a normal shift type (today)
LV_IDX = len(WORKED)
AM = ["AM1", "AM2", "AM3"]
PM = ["PM1", "PM2", "PM3"]
UNIT = 0.5
TARGET_H = 160.0
N_DAYS = 28


def coeff(sid):
    return int(WORKED_HOURS[sid] / UNIT)


LEAVE_INPUT = {0: {9, 10}}


def build(n):
    m = cp_model.CpModel()
    shifts = {}
    for d in range(N_DAYS):
        for s in range(len(ALL_SHIFT_TYPES)):
            for p in range(n):
                shifts[(d, s, p)] = m.new_bool_var(f"s_{d}_{s}_{p}")
    offs = {}
    for d in range(N_DAYS):
        for p in range(n):
            dp = sum(shifts[(d, s, p)] for s in range(len(ALL_SHIFT_TYPES)))
            offs[(d, p)] = m.new_bool_var(f"o_{d}_{p}")
            m.add(offs[(d, p)] + dp == 1)
    sid = {s: i for i, s in enumerate(ALL_SHIFT_TYPES)}
    am = [sid[x] for x in AM]
    pm = [sid[x] for x in PM]
    for d in range(N_DAYS):
        m.add(sum(shifts[(d, sid["LD"], p)] for p in range(n)) == 1)
        m.add(sum(shifts[(d, s, p)] for s in am for p in range(n)) == 1)
        m.add(sum(shifts[(d, s, p)] for s in pm for p in range(n)) == 1)
    for w in range(N_DAYS // 7):
        for p in range(n):
            m.add(sum(offs[(d, p)] for d in range(w * 7, w * 7 + 7)) >= 2)
    # pin leave (LV) + block unplanned leave for everyone else
    for d in range(N_DAYS):
        for p in range(n):
            if p in LEAVE_INPUT and d in LEAVE_INPUT[p]:
                m.add(shifts[(d, LV_IDX, p)] == 1)
            else:
                m.add(shifts[(d, LV_IDX, p)] == 0)
    target_units = int(TARGET_H / UNIT)
    for p in range(n):
        worked = sum(coeff(WORKED[s]) * shifts[(d, s, p)] for d in range(N_DAYS) for s in range(len(WORKED)))
        leave = 16 * sum(shifts[(d, LV_IDX, p)] for d in range(N_DAYS))
        m.add(worked + leave == target_units)
    return m


if __name__ == "__main__":
    print("CONTROL (original shift-type model, same fixed coverage 1LD+1AM+1PM/day):")
    print(f"{'nurses':>7} | {'status':>9} | {'time(s)':>8}")
    for n in (5, 10, 20, 40, 60):
        m = build(n)
        s = cp_model.CpSolver()
        s.parameters.max_time_in_seconds = 60
        s.parameters.num_search_workers = 8
        t0 = time.perf_counter()
        st = s.solve(m)
        el = time.perf_counter() - t0
        print(f"{n:>7} | {s.status_name(st):>9} | {el:>8.3f}")
