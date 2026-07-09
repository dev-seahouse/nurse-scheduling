# Monthly Contracted Hours, Paid Leave, and Shift Variants

A design + reference document for scheduling nurses against a **monthly contracted-hours
target** (e.g. exactly 160h/month) where shifts come in **variable lengths**, and where a
day can be *worked*, *paid leave*, or a *weekly rest day* — each counting differently
toward the monthly total.

This document explains the requirement, how the existing solver can already satisfy it
(no engine changes), how the "coefficient" trick works, a runnable sample test case, how
to configure the current frontend to build it, and the recommended UI change to make it
ergonomic.

The accompanying files:

- [`hours_via_coefficients.yaml`](./hours_via_coefficients.yaml) — a runnable sample scenario.
- [`verify_hours.py`](./verify_hours.py) — solves it and independently re-checks the hours.

---

## Table of contents

1. [The use case](#1-the-use-case)
2. [Domain concepts](#2-domain-concepts)
3. [How the scheduling algorithm works](#3-how-the-scheduling-algorithm-works)
4. [How coefficients work](#4-how-coefficients-work)
5. [Modelling the use case](#5-modelling-the-use-case)
6. [Feasibility: the arithmetic that must close](#6-feasibility-the-arithmetic-that-must-close)
7. [Sample test case and how to run it](#7-sample-test-case-and-how-to-run-it)
8. [Configuring the current frontend (no code changes)](#8-configuring-the-current-frontend-no-code-changes)
9. [Recommended frontend changes](#9-recommended-frontend-changes)
10. [Important notes, limits, and gotchas](#10-important-notes-limits-and-gotchas)

---

## 1. The use case

A ward wants schedules that respect a **monthly working-hours contract** rather than a
simple shift count. Concretely:

- Every nurse must be scheduled for **exactly 160h in a 28-day month** (≈ 40h/week).
- Shifts are **not** a fixed length. There is a long day and several AM/PM variants, and
  more variants may be added later:
  - **Long day (LD):** 08:00–20:30 (12.5h)
  - **AM variants:** 08:00–15:00 (7h), 08:00–16:00 (8h), 08:00–17:00 (9h)
  - **PM variants:** 12:00–21:00 (9h), 13:00–21:00 (8h), 14:00–21:00 (7h)
- Nurses get **at least 2 rest days per week**. Rest days are unpaid time off and do
  **not** count toward the 160h.
- Nurses may also take **paid leave**. Because leave is paid, a leave day **does** count
  toward the 160h (credited at a standard 8h here).

The key subtlety is that "off" is two different things:

| Day type            | Paid? | Counts toward 160h? |
| ------------------- | ----- | ------------------- |
| Worked shift        | yes   | yes — its real length |
| **Paid leave**      | yes   | **yes — credited 8h** |
| **Weekly rest day** | no    | **no — 0h**         |

Getting this distinction right is what makes the 160h target both meaningful and feasible
(see [§6](#6-feasibility-the-arithmetic-that-must-close)).

---

## 2. Domain concepts

### 2.1 Shift types are opaque labels

In the model a shift type has only an `id` and an optional `description`
(`core/nurse_scheduling/models.py`, `ShiftType`). There is **no start/end time and no
duration** stored on a shift type. Every "AM 08:00–16:00 (8h)" fact lives in your head or
in the `description`; the solver only sees a label.

Consequently, each variant is just its own shift type:

```
LD, AM1, AM2, AM3, PM1, PM2, PM3
```

You can group them (`ShiftTypeGroup`) for convenience, e.g. an `AM` group `[AM1, AM2, AM3]`
and a `PM` group `[PM1, PM2, PM3]`. Groups are set membership, not time semantics.

Adding more variants later is purely additive: define a new shift type and (optionally) add
it to a group.

### 2.2 Paid leave as a shift type

Because "leave counts as paid hours," the cleanest representation is to make **paid leave
its own shift type**, e.g. `LV`. A nurse "assigned" to `LV` on a day is on paid leave that
day. `LV` provides no ward coverage, but it carries hours (see coefficients below).

### 2.3 Rest day = `OFF`

The model has a built-in notion of a day with no assignment: `OFF`. Internally each
(day, person) has an `offs` boolean, and the mandatory *at most one shift per day* rule ties
it to the shift variables (`scheduler.py`):

```
offs[(d, p)] + Σ_s shifts[(d, s, p)] == 1
```

So on any given day a nurse is in exactly one state: **one worked shift**, **`LV`**, or
**`OFF`**. That three-way split maps precisely onto worked / paid-leave / rest.

---

## 3. How the scheduling algorithm works

### 3.1 Solver

The backend uses **Google OR-Tools CP-SAT** (a constraint / integer programming solver),
via `core/nurse_scheduling/solver_ortools_cp_sat.py`. (cuOpt is not used by the core solver.)

### 3.2 Decision variables

For every (day `d`, shift type `s`, person `p`) there is one boolean
(`scheduler.py`):

```python
shifts[(d, s, p)] = 1  # person p works shift type s on day d
```

plus the derived `offs[(d, p)]`. The granularity is **day × shift-type × person**. There
is no sub-day / hourly resolution.

### 3.3 Preferences become constraints and objective terms

Each entry in `preferences` is dispatched to a handler in
`core/nurse_scheduling/preference_types.py` that adds constraints and/or objective terms.
The types used here:

- **`shift type requirement`** — hard staffing: "exactly / at least N people on this shift
  type each date." Used for coverage.
- **`shift count`** — the workhorse for hours: a weighted count of assignments over a set
  of dates and shift types, compared to a target (see [§4](#4-how-coefficients-work)).
- **`shift request`** — push a specific person toward/away from a shift on given dates.
  Used to pin leave.
- **`at most one shift per day`** — mandatory; encodes the one-state-per-day rule.

### 3.4 Hard vs soft: the `weight` field

Every soft preference has a `weight`. The handler routes it through `utils.add_objective`:

| `weight`      | Effect                                                            |
| ------------- | ----------------------------------------------------------------- |
| `.inf`        | **Hard**: the underlying boolean is forced to 1 (constraint met). |
| `-.inf`       | **Hard**: forced to 0 (constraint must *not* hold).               |
| finite (±N)   | **Soft**: `objective += weight × term` — rewarded/penalised.      |

So `expression: 'x = T'` with `weight: .inf` is a **hard equality** the solver cannot
violate; a large finite weight would make it a strong preference instead (e.g. allow paid
overtime at a cost).

---

## 4. How coefficients work

This is the crux of turning a hours-unaware model into an hours-aware one.

### 4.1 The `shift count` expression

The `shift count` handler builds this quantity (`preference_types.py`):

```python
x = sum(
    coefficient[s] * (shifts[(d, s, p)] if s != OFF else offs[(d, p)])
    for d in countDates
    for s in countShiftTypes
)
```

`x` is a **weighted sum of 0/1 assignment variables**. If `coefficient[s]` is the *duration
of shift `s`*, then each term is "duration × (did they work it?)" and `x` collapses to
**total hours** over the selected dates and shift types. We are not adding hours to the
model — we choose coefficients so that a shift-counting feature *computes hours as a side
effect*.

`x` is then compared to a target `T` via `expression`, one of:

```
|x - T|^2 ,  x >= T ,  x <= T ,  x > T ,  x < T ,  x = T
```

### 4.2 Coefficients must be positive integers → use half-hour units

The coefficient validator requires **integers ≥ 1**. A 12.5h long day cannot be a
coefficient directly, so we pick the **unit = half-hours** (multiply every duration by 2):

| Shift | Hours | Coefficient (½h) |
| ----- | ----- | ---------------- |
| LD    | 12.5  | 25 |
| AM1   | 7.0   | 14 |
| AM2   | 8.0   | 16 |
| AM3   | 9.0   | 18 |
| PM1   | 9.0   | 18 |
| PM2   | 8.0   | 16 |
| PM3   | 7.0   | 14 |
| LV    | 8.0   | 16 |

Targets are in the same unit: **160h = 320 units**, **40h = 80 units**. If you ever need
finer granularity (e.g. 15-minute boundaries) switch the unit to quarter-hours (×4) and
every number scales the same way.

### 4.3 `OFF` is a real shift id — include it to count it, omit it to ignore it

`OFF` is registered as a shift id (`scheduler.py`), and the `x` expression substitutes the
`offs` variable when it sees `OFF`. Therefore:

- **List `OFF` in `countShiftTypes` with a coefficient** ⇒ off days contribute hours.
- **Omit `OFF`** ⇒ off days contribute nothing.

This single choice is exactly how we make **paid leave count** (it is the `LV` shift type,
included) while **weekly rest does not count** (`OFF`, omitted).

> Gotcha: the `ALL` selector expands to real shift types **only** — it does **not** include
> `OFF`. To count off days you must list `OFF` explicitly.

---

## 5. Modelling the use case

Putting it together (see the full file in
[`hours_via_coefficients.yaml`](./hours_via_coefficients.yaml)):

**Shift types:** `LD, AM1..AM3, PM1..PM3` (worked) + `LV` (paid leave). Groups `AM`, `PM`.

**Coverage** — hard `shift type requirement`, one per date. `LV`/`OFF` give no coverage, so
they are naturally excluded:

```yaml
- type: shift type requirement    # 1 long day / date
  shiftType: LD
  requiredNumPeople: 1
- type: shift type requirement    # 1 AM variant / date (group => aggregate across AM1/2/3)
  shiftType: AM
  requiredNumPeople: 1
- type: shift type requirement    # 1 PM variant / date
  shiftType: PM
  requiredNumPeople: 1
```

**Monthly contract** — hard `shift count` over all dates; worked shifts + `LV` count, `OFF`
omitted; target 320 units (160h):

```yaml
- type: shift count
  person: ALL
  countDates: ALL
  countShiftTypes: [LD, AM1, AM2, AM3, PM1, PM2, PM3, LV]   # note: OFF omitted
  countShiftTypeCoefficients:
    - [LD, 25]
    - [AM1, 14]
    - [AM2, 16]
    - [AM3, 18]
    - [PM1, 18]
    - [PM2, 16]
    - [PM3, 14]
    - [LV, 16]      # paid leave day counts as 8h
  expression: 'x = T'
  target: 320       # 160h in half-hour units
  weight: .inf      # hard equality
```

**Weekly rest** — at least 2 `OFF` days per week; one preference per week using the
`YYYY-MM-DD~YYYY-MM-DD` date-range syntax:

```yaml
- type: shift count
  person: ALL
  countDates: 2026-02-01~2026-02-07
  countShiftTypes: OFF
  expression: 'x >= T'
  target: 2
  weight: .inf
# ... repeat for the other 3 weeks
```

**Paid leave is an input, not the solver's choice** — pin it. A hard `shift request` places
a nurse on `LV` on the requested dates, and a `shift count: LV = 0` for everyone else stops
the solver from inventing leave to game the hour total:

```yaml
- type: shift request       # Nurse 0 takes paid leave on Feb 10 and 11
  person: 0
  date: 10
  shiftType: LV
  weight: .inf
- type: shift request
  person: 0
  date: 11
  shiftType: LV
  weight: .inf
- type: shift count          # no unplanned leave for the others
  person: [1, 2, 3, 4]
  countDates: ALL
  countShiftTypes: LV
  expression: 'x = T'
  target: 0
  weight: .inf
```

In production, real leave requests plug into exactly this spot.

---

## 6. Feasibility: the arithmetic that must close

Exact-hours targets are only satisfiable if the numbers close. Two facts drove the design:

**a) Exact worked-hours is a bin-packing problem.** "Everyone works exactly 160h" means
total staffed hours must equal `n_nurses × 160`. With 1 LD + 1 AM + 1 PM per day over 28
days, total worked hours = `350 (long days) + Σ(AM) + Σ(PM)`, and each AM/PM is 7–9h, giving
a range of `[742, 854]h`. The variant freedom (choosing AM1 vs AM2 vs AM3, etc.) is the
slack the solver uses to hit an exact multiple.

**b) "Off days count" is only feasible when *rest* is excluded.** If *every* non-worked day
counted (rest included, at ~8h), then every one of the 28 days would contribute ≥ ~7h, so a
nurse's month would floor at ~196h — **160h becomes impossible**. The requirement is saved
precisely by the leave/rest split: paid leave counts, but weekly rest is free, and those
uncounted rest days are the release valve that lets the month settle at exactly 160h.

The balancing identity for the monthly constraint is simply:

```
worked_hours(p) + 8h × leave_days(p) = 160h,     for each nurse p
```

with rest days making up the remaining calendar days at 0h.

**Parity note:** the long day is 12.5h, so its half-hour coefficient (25) is odd. For a
nurse's total to be an integer number of half-hours matching an even target (320), each
nurse works an **even number of long days**. The total long-day count across the team is 28
(even), so this always closes — but it is why you occasionally see the solver assign 0, 2,
4… long days to a person rather than an arbitrary count.

---

## 7. Sample test case and how to run it

The scenario in [`hours_via_coefficients.yaml`](./hours_via_coefficients.yaml): Feb 2026
(28 days), 5 nurses, coverage of 1 LD + 1 AM + 1 PM per day, exact 160h/month, ≥2 rest
days/week, and Nurse 0 pinned to 2 paid-leave days.

Run the solver directly:

```bash
cd core
.venv/bin/python -m nurse_scheduling.cli ../prototype/hours_via_coefficients.yaml
```

Or run the independent verifier, which solves and then **re-computes each nurse's hours
from the real shift lengths** (not the coefficients), so it is a genuine check rather than a
tautology:

```bash
cd core
.venv/bin/python ../prototype/verify_hours.py
```

Expected output:

```
Solver status: OPTIMAL   score: 0

Per-nurse monthly accounting (paid leave credited at 8.0h, rest = 0h):
Nurse | work d leave d rest d | work h leave h |  =160h?
    0 |     16       2     10 |  144.0    16.0 |     YES   <- 2 paid-leave days
    1 |     16       0     12 |  160.0     0.0 |     YES
    2 |     16       0     12 |  160.0     0.0 |     YES
    3 |     17       0     11 |  160.0     0.0 |     YES
    4 |     19       0      9 |  160.0     0.0 |     YES

Weekly rest days (OFF) per nurse  [need >= 2 each week]:
  Nurse 0: [4, 2, 2, 2]   OK
  ... all nurses OK

Every nurse totals exactly 160h (work + paid leave): True
Every nurse has >= 2 rest days every week:            True
```

The headline result: **Nurse 0 physically worked only 144h but satisfies the 160h contract**
because 2 paid-leave days credit 16h; the others worked the full 160h; everyone got ≥2 rest
days each week, and those rest days added nothing to the total.

---

## 8. Configuring the current frontend (no code changes)

Everything above is expressible in today's UI. Tab numbers refer to the navigation bar.

1. **Tab 3 — Shift Types.** Add the worked variants (`LD`, `AM1..AM3`, `PM1..PM3`) and the
   paid-leave type `LV`, each with a clear `description` including its hours (there is no
   duration field, so the description is where you record "08:00–16:00 (8h)"). Create groups
   `AM` and `PM`. `OFF` is built in — no need to define it.

2. **Tab 4 — Shift Type Requirements.** Add the three coverage rules (1 `LD`, 1 `AM` group,
   1 `PM` group per date), `requiredNumPeople: 1`.

3. **Tab 7 — Shift Counts.** This is where coefficients live.
   - **Monthly contract:** People = ALL, Count Dates = ALL, Count Shift Types = the seven
     worked types **plus `LV`** (do **not** tick `OFF`). After ticking them a
     **"Coefficients"** row of number boxes appears — enter the half-hour values from the
     table in [§4.2](#42-coefficients-must-be-positive-integers--use-half-hour-units).
     Expression `x = T`, Target `320`, Weight `∞`.
   - **Weekly rest:** one Shift Count per week. Count Dates = that week, Count Shift Types =
     `OFF` only, Expression `x >= T`, Target `2`, Weight `∞`. Use **Duplicate** on the card
     to clone it across the four weeks and just change the dates.
   - **Block unplanned leave:** People = the non-leave nurses, Count Shift Types = `LV`,
     `x = T`, Target `0`, Weight `∞`.

4. **Tab (Shift Requests).** Pin each nurse's actual paid-leave days: person, the date(s),
   Shift Type `LV`, Weight `∞`.

**The friction:** coefficients are unitless and must be re-typed into every Shift Count
preference; the target is also in half-hour units (`320`, not `160`). There is no single
place that says "LD is 12.5h." That is what the recommended change below fixes.

---

## 9. Recommended frontend changes

The mechanism works today; the goal of a change is only to make it **ergonomic and
less error-prone** for this use case.

### Background from the code

- Coefficient editing already exists: `web-frontend/src/components/CountShiftTypeCoefficientFields.tsx`,
  used by both `src/app/shift-counts/page.tsx` and `src/app/shift-type-requirements/page.tsx`.
- A coefficient is a **per-preference weighting**, not a property of the shift type — which
  is why it is retyped everywhere.
- Persistence is field-agnostic: localStorage (`schedulingStorage.ts`), YAML
  (`utils/yamlGenerator.ts`), and the solver payload (`app/optimize-and-export/page.tsx`)
  all serialize shift-type objects wholesale, so a new scalar field flows through
  automatically.
- **But** the backend `ShiftType` model uses `ConfigDict(extra="forbid")`
  (`core/nurse_scheduling/models.py`), so any new field is **rejected** unless added there.
- No `API_VERSION` bump is needed for an optional additive field (it is hard-coded `'alpha'`
  on both sides).

### Options

| Option | What it buys | Effort |
| ------ | ------------ | ------ |
| **A. Use as-is** | Nothing new; rely on Duplicate + descriptions. | Zero code |
| **B. Shift-type duration + "auto-fill coefficients"** *(recommended)* | Define each shift's length **once** on the Shift Types tab; a button fills the coefficient boxes from durations. Removes retyping and unit ambiguity. | Moderate |
| **C. Dedicated "Working Hours" preference type** | A first-class rule: pick people, period, and an **hours** target; hides coefficients entirely and knows worked vs leave vs rest. | Large |

### Recommended: Option B, file by file

**Backend (required because of `extra="forbid"`):**

- `core/nurse_scheduling/models.py` — add `durationMinutes: int | None = None` to
  `ShiftType`. The solver need not consume it (coefficients still carry the number); it must
  only *accept* it.

**Frontend — store duration on a shift type (the bulk of the work, because the editor is
generic):**

- `web-frontend/src/types/scheduling.ts` — add `durationMinutes?: number` to the shared
  `Item` interface.
- `web-frontend/src/components/ItemGroupEditorPage.tsx` and
  `web-frontend/src/components/AddEditItemGroupForm.tsx` — the shared editor is hard-coded to
  `id` + `description`; add an **optional extra-field mechanism** (a render-prop, or a prop
  enabled only for `SHIFT_TYPES`) so People/Dates are unaffected.
- `web-frontend/src/hooks/useSchedulingData.ts` — `addItem` and `updateItem` currently keep
  only `{ id, description }`; thread the new field through. (`duplicateItem` deep-clones, so
  it is preserved for free.)

**Frontend — the payoff (small):**

- `web-frontend/src/components/CountShiftTypeCoefficientFields.tsx` — add an **"Auto-fill
  from shift durations"** button that sets each selected shift type's coefficient to
  `duration ÷ unit` (e.g. half-hours), reading from `shiftTypeData`. Reuses the existing
  `updateCoefficientPair` util in `src/utils/countShiftTypeCoefficients.ts`.
- Optionally let the **Target** field read in hours on the two consumer pages (small,
  independent tweak).

**No changes needed:** save/load, YAML generation, payload build, anonymize (preserves
non-`description` keys), `loadFromYaml`.

Recommendation: **B** is the smallest change that removes the real pain and stays entirely
within the existing architecture. A lighter first step is just the auto-fill button plus a
half-hour/hour unit toggle in the coefficient editor (delivers most of the value without
touching the generic item editor); the shift-type duration field can follow.

---

## 10. Important notes, limits, and gotchas

Collected caveats that matter when extending this:

- **No time-of-day / clock.** The model is day-granular. It cannot express "at least 2
  nurses physically present at 14:00" — coverage is by counts of assigned shift types, not
  by who overlaps in wall-clock time. You translate "present at 14:00" into the relevant
  shift-type groups yourself.
- **Rest between shifts is not computed from times.** "No PM→next-morning-AM" (too little
  rest) is expressed by forbidding that shift-type **sequence** via a
  `shift type successions` preference with `weight: -.inf`, not by subtracting clock times.
- **At most one shift per day is mandatory.** A nurse works at most one shift per calendar
  day. If a real workflow ever needs two separate shifts in one day, that is not supported.
- **Coefficients are positive integers.** Choose a time unit fine enough for all your shift
  lengths (half-hours here; quarter-hours if needed) and scale every number, including the
  target.
- **`ALL` excludes `OFF`.** List `OFF` explicitly to count rest/off days.
- **Exact targets need the arithmetic to close.** `n_nurses × target` must be reachable
  given coverage and shift lengths; watch the long-day parity described in
  [§6](#6-feasibility-the-arithmetic-that-must-close). If a scenario is over-constrained the
  solver returns no solution — loosen a hard (`∞`) constraint or adjust staffing.
- **Hard vs soft is the weight.** Use `∞`/`-∞` for contractual rules; use finite weights to
  model "preferred but not mandatory" (e.g. paid overtime allowed at a penalty).
- **Backend schema is strict.** `ShiftType` (and the top-level model) forbid unknown fields;
  any new attribute must be added to `core/nurse_scheduling/models.py`. The schema version is
  the single string `apiVersion: alpha`, enforced by the backend.
- **Verify independently.** When validating an hours model, recompute hours from real shift
  lengths (as `verify_hours.py` does) rather than trusting the coefficient sum, which the
  solver satisfies by construction.
