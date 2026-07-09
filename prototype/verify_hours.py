"""Solve the prototype and prove the 160h/month contract holds, where PAID
LEAVE counts toward the total but WEEKLY REST days do not.

Recomputes each nurse's counted hours independently of the coefficient trick:
  counted = sum(worked shift lengths) + LEAVE_CREDIT_H * (paid-leave days)
Rest days (OFF) are excluded and carry 0h. Then checks:
  - every nurse totals EXACTLY 160h/month
  - every nurse has >= 2 rest days each week
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))
from nurse_scheduling import scheduler  # noqa: E402

# Real clock length of worked shift types, in hours (ground truth, NOT the
# coefficients the solver used). LV/OFF are handled separately below.
SHIFT_HOURS = {"LD": 12.5, "AM1": 7, "AM2": 8, "AM3": 9, "PM1": 9, "PM2": 8, "PM3": 7}
SHIFT_ORDER = ["LD", "AM1", "AM2", "AM3", "PM1", "PM2", "PM3", "LV"]  # s-index order in the YAML
LEAVE_CREDIT_H = 8.0
TARGET_H = 160.0

yaml_path = Path(__file__).with_name("hours_via_coefficients.yaml")
df, solution, score, status, _ = scheduler.schedule(yaml_path.read_bytes())
print(f"Solver status: {status}   score: {score}\n")

n_people = 5
n_days = 28

worked_hours = {p: 0.0 for p in range(n_people)}
worked_days = {p: 0 for p in range(n_people)}
leave_days = {p: 0 for p in range(n_people)}
# rest days per (person, week): a rest day = a day with no assignment at all
assigned_day = {p: set() for p in range(n_people)}

for (d, s, p), on in solution.items():
    if not on:
        continue
    assigned_day[p].add(d)
    if SHIFT_ORDER[s] == "LV":
        leave_days[p] += 1
    else:
        worked_hours[p] += SHIFT_HOURS[SHIFT_ORDER[s]]
        worked_days[p] += 1

print(f"Per-nurse monthly accounting (paid leave credited at {LEAVE_CREDIT_H}h, rest = 0h):")
print(f"{'Nurse':>5} | {'work d':>6} {'leave d':>7} {'rest d':>6} | {'work h':>6} {'leave h':>7} | {'=160h?':>7}")
print("-" * 72)
all_ok = True
for p in range(n_people):
    rest_days = n_days - len(assigned_day[p])
    leave_h = leave_days[p] * LEAVE_CREDIT_H
    counted = worked_hours[p] + leave_h
    ok = abs(counted - TARGET_H) < 1e-9
    all_ok = all_ok and ok
    print(
        f"{p:>5} | {worked_days[p]:>6} {leave_days[p]:>7} {rest_days:>6} | "
        f"{worked_hours[p]:>6.1f} {leave_h:>7.1f} | {'YES' if ok else 'NO!':>7}"
    )

# Weekly rest-day check
print("\nWeekly rest days (OFF) per nurse  [need >= 2 each week]:")
rest_ok = True
for p in range(n_people):
    per_week = []
    for w in range(4):
        week_days = set(range(w * 7, w * 7 + 7))
        rest = len(week_days - assigned_day[p])
        per_week.append(rest)
        if rest < 2:
            rest_ok = False
    print(f"  Nurse {p}: {per_week}   {'OK' if all(r >= 2 for r in per_week) else 'FAIL'}")

print("-" * 72)
print(f"\nEvery nurse totals exactly 160h (work + paid leave): {all_ok}")
print(f"Every nurse has >= 2 rest days every week:            {rest_ok}")
print(f"Nurse 0 took {leave_days[0]} paid-leave days -> {leave_days[0] * LEAVE_CREDIT_H:.0f}h of the 160h "
      f"came from leave, so only {worked_hours[0]:.1f}h was actually worked.")
