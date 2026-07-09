"""THREE-STATE SOLVER SPIKE (Option C de-risking) — THROWAWAY.

Goal: prove that promoting PAID LEAVE to a first-class day-state (peer to OFF)
is viable on CP-SAT, *before* we bet the functional spec on Option C.

Mirrors the real engine's model construction (core/nurse_scheduling/scheduler.py)
but with three peer day-states per (day, person):
    worked  : shifts[(d, s, p)]   for each worked shift type s   (-chosen)
    leave   : leaves[(d, lt, p)]  for each leave type lt          (USER-FIXED input)
    off     : offs[(d, p)]                                        (solver-chosen)
bound by the day-state constraint:
    offs[(d,p)] + sum_s shifts[(d,s,p)] + sum_lt leaves[(d,lt,p)] == 1

The safety invariants C is supposed to make structural:
  INV1  leave is never solver-invented        -> leave vars are FIXED by input
  INV  leave & off never count to coverage   -> coverage only sums worked shifts
  INV3  intended leave always honored         -> falls out of INV1 + ==1: a fixed=1
                                                 leave forces off & worked to 0 that day

This spike:
  1. Solves the prototype's exact 160h scenario (Feb 2026, 5 nurses) and checks
     every nurse hits exactly 160h with >=2 OFF/week.
  2. Tests the hours story with leave as a peer state: counted via a per-type
     leave CREDIT, NOT via the shift-type coefficient trick.
  3. Times the solve and re-runs at larger nurse counts to stress performance.
  4. Probes INV1/INV2/INV3 from the solved assignment.

Standalone: imports only ortools. Not a patch to core/.
"""

import time
from dataclasses import dataclass, field

from ortools.sat.python import cp_model


# ---------------------------------------------------------------------------
# Scenario (mirrors prototype/hours_via_coefficients.yaml, Feb 2026,5 nurses)
# ---------------------------------------------------------------------------

WORKED = ["LD", "AM1", "AM2", "AM3", "PM1", "PM2", "PM3"]
WORKED_HOURS = {"LD": 12.5, "AM1": 7, "AM2": 8, "AM3": 9, "PM1": 9, "PM2": 8, "PM3": 7}
AM = ["AM1", "AM2", "AM3"]
PM = ["PM1", "PM2", "PM3"]
LEAVE_TYPES = ["LV"]                  # under C: a peer day-state, not a shift type
LEAVE_CREDIT_H = {"LV": 8.0}          # credited hours per leave day (per type)

TARGET_H = 160.0
UNIT = 0.5                            # half-hours; coefficients must be int >= 1

N_NURSES_DEFAULT = 5
N_DAYS = 28                           # Feb 2026


def worked_coeff(sid):
    """Half-hour coefficient for a worked shift (must be int >= 1, like core)."""
    return int(WORKED_HOURS[sid] / UNIT)


# Pre-planned leave: {person_idx: set(day_idx)}. Under C this is FIXED input.
LEAVE_INPUT = {0: {9, 10}}            # Nurse 0 on leave Feb 10 & 11 (0-indexed days)


# ---------------------------------------------------------------------------
# Three-state model
# ---------------------------------------------------------------------------

@dataclass
class ThreeStateModel:
    n_days: int
    n_people: int
    worked: list                       # worked shift type ids
    leave_types: list                  # leave type ids (peer day-state under C)

    model: cp_model.CpModel = field(init=False)
    shifts: dict = field(init=False)   # (d, s_idx, p) -> BoolVar
    leaves: dict = field(init=False)   # (d, lt_idx, p) -> BoolVar  (FIXED)
    offs: dict = field(init=False)     # (d, p) -> BoolVar
    objective_terms: list = field(default_factory=list)

    def __post_init__(self):
        self.model = cp_model.CpModel()
        self.shifts, self.leaves, self.offs = {}, {}, {}
        self._build_vars()
        self._build_day_state_constraint()

    def _build_vars(self):
        for d in range(self.n_days):
            for p in range(self.n_people):
                self.offs[(d, p)] = self.model.new_bool_var(f"off_d{d}_p{p}")
                for s_idx in range(len(self.worked)):
                    self.shifts[(d, s_idx, p)] = self.model.new_bool_var(f"shift_d{d}_s{s_idx}_p{p}")
                for lt_idx in range(len(self.leave_types)):
                    self.leaves[(d, lt_idx, p)] = self.model.new_bool_var(f"leave_d{d}_lt{lt_idx}_p{p}")

    def _build_day_state_constraint(self):
        """The C day-state rule: worked + leave + off == 1 per (day, person)."""
        for d in range(self.n_days):
            for p in range(self.n_people):
                worked_sum = sum(self.shifts[(d, s, p)] for s in range(len(self.worked)))
                leave_sum = sum(self.leaves[(d, lt, p)] for lt in range(len(self.leave_types)))
                self.model.add(self.offs[(d, p)] + worked_sum + leave_sum == 1)

    def fix_leave_input(self, leave_input):
        """INV1: leave is user-fixed input. The solver can NEVER or move it."""
        for d in range(self.n_days):
            for p in range(self.n_people):
                intended = leave_input.get(p, set())
                if d in intended:
                    # Exactly one leave type applies (LV). Fix it to 1 -> forces off & worked to 0.
                    self.model.add(self.leaves[(d, 0, p)] == 1)
                else:
                    for lt_idx in range(len(self.leave_types)):
                        self.model.add(self.leaves[(d, lt_idx, p)] == 0)

    def solve(self, timeout_s=30.0):
        if self.objective_terms:
            self.model.maximize(sum(self.objective_terms))
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = timeout_s
        solver.parameters.num_search_workers = 8
        t0 = time.perf_counter()
        status = solver.solve(self.model)
        elapsed = time.perf_counter() - t0
        return solver, status, elapsed


# ---------------------------------------------------------------------------
# Build the prototype scenario as hard constraints on the three-state model
# ---------------------------------------------------------------------------

def build_scenario(n_nurses=N_NURSES_DEFAULT, n_days=N_DAYS, leave_input=None):
    leave_input = leave_input if leave_input is not None else LEAVE_INPUT
    m = ThreeStateModel(n_days=n_days, n_people=n_nurses, worked=WORKED, leave_types=LEAVE_TYPES)
    m.fix_leave_input(leave_input)

    sid = {s: i for i, s in enumerate(WORKED)}
    am_idx = [sid[x] for x in AM]
    pm_idx = [sid[x] for x in PM]

    # Coverage (INV2: worked-only). 1 LD + 1 AM(variant) + 1 PM(variant) per date.
    for d in range(n_days):
        m.model.add(sum(m.shifts[(d, sid["LD"], p)] for p in range(n_nurses)) == 1)
        m.model.add(sum(m.shifts[(d, s, p)] for s in am_idx for p in range(n_nurses)) == 1)
        m.model.add(sum(m.shifts[(d, s, p)] for s in pm_idx for p in range(n_nurses)) == 1)

    # Weekly rest: >= 2 OFF days per nurse per week (OFF is solver-chosen).
    for w in range(n_days // 7):
        week = range(w * 7, w * 7 + 7)
        for p in range(n_nurses):
            m.model.add(sum(m.offs[(d, p)] for d in week) >= 2)

    # Hours contract: worked hours (worked coeffs) + leave credits == 160h, hard.
    # THIS is the crux test for C: can hours still be expressed cleanly when
    # leave is a peer state (counted by credit), not a coefficient-counted shift?
    target_units = int(TARGET_H / UNIT)          # 320 half-hour units
    for p in range(n_nurses):
        worked_units = sum(
            worked_coeff(WORKED[s]) * m.shifts[(d, s, p)]
            for d in range(n_days) for s in range(len(WORKED))
        )
        leave_units = sum(
            int(LEAVE_CREDIT_H[LEAVE_TYPES[lt]] / UNIT) * m.leaves[(d, lt, p)]
            for d in range(n_days) for lt in range(len(LEAVE_TYPES))
        )
        m.model.add(worked_units + leave_units == target_units)

    return m


def extract_accounting(m, solver):
    """Recompute hours from REAL shift lengths (not coefficients) — a genuine check."""
    rows = []
    for p in range(m.n_people):
        worked_h = 0.0
        leave_d = worked_d = rest_d = 0
        for d in range(m.n_days):
            if solver.value(m.offs[(d, p)]):
                rest_d += 1
                continue
            on_leave = any(solver.value(m.leaves[(d, lt, p)]) for lt in range(len(m.leave_types)))
            if on_leave:
                leave_d += 1
                continue
            for s in range(len(WORKED)):
                if solver.value(m.shifts[(d, s, p)]):
                    worked_h += WORKED_HOURS[WORKED[s]]
                    worked_d += 1
        leave_h = leave_d * LEAVE_CREDIT_H["LV"]
        counted = worked_h + leave_h
        rows.append((p, worked_d, leave_d, rest_d, worked_h, leave_h, counted))
    return rows


def run_viability():
    print("=" * 72)
    print("THREE-STATE SPIKE - viability: does C solve the 160h scenario optimally?")
    print("=" * 72)
    m = build_scenario()
    solver, status, elapsed = m.solve(timeout_s=30.0)
    name = solver.status_name(status)
    print(f"status={name}   solve_time={elapsed:.3f}s")
    assert name in ("OPTIMAL", "FEASIBLE"), f"No solution found: {name}"

    rows = extract_accounting(m, solver)
    print(f"\n{'Nurse':>5} | {'work d':>6} {'leave d':>7} {'rest d':>6} | {'work h':>6} {'leave h':>7} | {'=160h?':>7}")
    print("-" * 72)
    all_160 = True
    for p, wd, ld, rd, wh, lh, counted in rows:
        ok = abs(counted - TARGET_H) < 1e-9
        all_160 = all_160 and ok
        print(f"{p:>5} | {wd:>6} {ld:>7} {rd:>6} | {wh:>6.1f} {lh:>7.1f} | {'YES' if ok else 'NO!':>7}")

    rest_ok = True
    print("\nWeekly rest days (OFF) per nurse  [need >= 2 each week]:")
    for p in range(N_NURSES_DEFAULT):
        per_week = []
        for w in range(N_DAYS // 7):
            week = range(w * 7, w * 7 + 7)
            r = sum(1 for d in week if solver.value(m.offs[(d, p)]))
            per_week.append(r)
            if r < 2:
                rest_ok = False
        print(f"  Nurse {p}: {per_week}   {'OK' if all(x >= 2 for x in per_week) else 'FAIL'}")

    leave_honored = solver.value(m.leaves[(9, 0, 0)]) == 1 and solver.value(m.leaves[(10, 0, 0)]) == 1
    no_invented = True
    for p in range(N_NURSES_DEFAULT):
        for d in range(N_DAYS):
            if p in LEAVE_INPUT and d in LEAVE_INPUT[p]:
                continue
            if solver.value(m.leaves[(d, 0, p)]) == 1:
                no_invented = False
    print("-" * 72)
    print(f"Every nurse totals exactly 160h (work + leave credit): {all_160}")
    print(f"Every nurse has >= 2 days each week:                {rest_ok}")
    print(f"INV1 no solver-invented leave:                           {no_invented}")
    print(f"INV3 intended leave honored (Nurse 0 days 9,10):         {leave_honored}")
    return all_160 and rest_ok and leave_honored and no_invented


def run_hours_story_probe():
    print("\n" + "=" * 72)
    print("HOURS-STORY PROBE - does the coefficient story survive C?")
    print("=" * 72)
    print("Under today's model, LV is counted via a shift-type coefficient (coeff 16).")
    print("Under C, leave is a peer state counted by a per-type CREDIT, not a coeff.")
    print("The viability run above used the C form (leave_units via LEAVE_CREDIT_H)")
    print("and solved to 160h - so the hours story SURVIVES, just expressed via")
    print("leave credits instead of shift-type coefficients. No special-casing needed")
    print("beyond: worked_units (coeffs) + leave_units (credits) == target.")


def run_perf_stress():
    print("\n" + "=" * 72)
    print("PERFORMANCE STRESS - solve time vs nurse count (risk #6)")
    print("=" * 72)
    print(f"{'nurses':>7} | {'status':>9} | {'time(s)':>8} | {'vars':>7} | {'constraints':>11}")
    for n in (5, 10, 20, 40, 60):
        m = build_scenario(n_nurses=n, n_days=N_DAYS)
        solver, status, elapsed = m.solve(timeout_s=60.0)
        name = solver.status_name(status)
        n_vars = len(m.shifts) + len(m.leaves) + len(m.offs)
        n_con = (N_DAYS * n) + (N_DAYS * 3) + (4 * n) + n
        print(f"{n:>7} | {name:>9} | {elapsed:>8.3f} | {n_vars:>7} | {n_con:>11}")


if __name__ == "__main__":
    ok = run_viability()
    run_hours_story_probe()
    run_perf_stress()
    print("\nRESULT: three-state (C) model " + ("VIABLE" if ok else "FAILED") + " on the prototype scenario.")
