# HANDOFF — Nurse-Scheduling Rebuild: design done → rebuild kickoff

## Session Closed
**Closed at:** 2026-07-15
**Commit:** (uncommitted — closed without commit)
**Session status:** Handed off to next session


**Chain:** epic-8b2235d5 · **Seq:** 2 · **Parent:** `HANDOFF_rebuild-design-track_2026-07-14.md` (seq 1)
**Date:** 2026-07-15
**Traycer epic:** `8b2235d5-8943-4f6d-a61e-3b671836217a`
**Auto:** false

**Repos / locations in play:**
- **🆕 Rebuild workspace (where the rebuild happens):** `/home/kenan/work/nursing-sheduler` — branch `main`. Now **bare/greenfield** — the user just removed the stale in-repo corpus copy and the old-app `reference/` snapshot (see "Since Last Handoff").
- **Old/current app (running parity reference + still-active feature work):** `/home/kenan/work/nurse-scheduling` — branch `feature/genie`
- **Authoritative spec corpus + design artifacts:** the **Traycer epic** at `/home/kenan/.traycer/epics/8b2235d5-.../artifacts/` (intact)

---

## Goal

The frontend rebuild is transitioning from **design** to **build**. The user has confirmed: *"I have the design done by Claude Design, and [am] ready for the next step of the rebuild in [the] next chat."*

The path (set across the chain): functional spec complete & build-ready → hand off to Claude Design → **design returned (now)** → **review it for parity + feasibility/technical implementation** → break into tickets → **build the rebuild in `/home/kenan/work/nursing-sheduler`**.

Governing frame (unchanged): **DL06 fidelity rule** — the shipped Python backend (`core/nurse_scheduling/`) is the *binding contract*; the UI is *free*; current-frontend quirks are `[incidental]`; the spec-12 `leaveTypes` multi-type vision is `[DEFERRED]`.

---

## Since Last Handoff (seq 1 → seq 2) — the delta

Seq 1 ended on the *send-handover* side, awaiting the returned Claude Design package. Since then:

### 1. 🆕 A rebuild workspace was created, then pruned to bare: `/home/kenan/work/nursing-sheduler`
- Git repo, branch **`main`** (tracks `origin/main`).
- It briefly held a copy of the spec corpus (`docs/epic-artifacts/`) and a full **`reference/`** snapshot of the old app. **The user has now removed both** — the deletions are currently **uncommitted** (working tree shows `D` for all `docs/epic-artifacts/...` files; `reference/` is gone from disk).
- **Why it matters:** this resolves the corpus-divergence problem from the first draft of this handoff. The in-repo corpus copy had drifted (its own decision-log set, FREEDAY→NON-WORKDAY renames) and was **stale**; removing it means the **Traycer epic artifacts are the single source of truth** for the rebuild. The old-app snapshot was removed too — parity reference is the **live old repo** (`/home/kenan/work/nurse-scheduling`), not an in-repo copy.
- The repo now contains only `README.md`, `lefthook.yml`, an (emptied) `docs/`, and `.git`. **No app code scaffolded yet** — the rebuild has not started.

### 2. Design is "done" (per user) — but not located on disk yet
- No returned Claude Design output found on Desktop, Downloads, or either repo. The Desktop `Genie Control Station Design.zip` is a *different* project.
- **Action for next session:** ask the user where the returned design package is (a zip? a Claude Design project id? a folder?) before starting the parity/feasibility review.

### 3. Two large feature commits landed on `feature/genie` (old repo, 2026-07-15)
Both **outside this session's conversation** — they continue the `hoursContract` thread flagged as open in seq 1:

- **`64c84a3` — "add shift working time and remove sentry"**
  - **Sentry removed entirely**: deleted `core/nurse_scheduling/sentry.py`, `anonymize_scheduling_data.py`, their tests, `web-frontend/sentry.*.config.ts`, `instrumentation-client.ts`, `instrumentation.ts`, trimmed `next.config.ts`/`serve.py`/`package.json`. → resolves the seq-1 OE-B8 note; Sentry is now gone from source, not just rebuild scope.
  - **Shift working time** added to `models.py`, `AddEditItemGroupForm.tsx`, `ItemGroupEditorPage.tsx`, `useSchedulingData.ts`, `scheduling.ts`, new `shiftWorkingTime.ts` + tests.
- **`9aef889` — "add exact and ranged contracted hours"**
  - New **`ContractedHoursEditor.tsx`** (692 lines), `group_map.py` (175 lines new), big `models.py`/`preference_types.py`/`scheduler.py` changes, `test_hours_contract_validation.py` (370 lines), e2e specs, Playwright config.
  - The full realization of "contracted hours" (exact + ranged) — a **beyond-parity capability** the specs only partially covered.

**`feature/genie` is now pushed / in sync with `origin/feature/genie`.**

---

## Where We Are (current state)

| Thing | State |
|---|---|
| Authoritative spec corpus | **Traycer epic** `nurse-scheduling-functional-spec/` — build-ready, converged clean (seq 1). Single source of truth (stale in-repo copy removed) |
| Design handover artifact | Prepared, cold-critiqued (10 findings fixed), current through DL07/DL08. Traycer `nurse-scheduling-design-handover/index.md` |
| Returned Claude Design output | User says done; **not yet located on disk** — get it from the user |
| Rebuild workspace | `/home/kenan/work/nursing-sheduler` — **bare/greenfield**; stale corpus copy + `reference/` snapshot just deleted (uncommitted). No app code yet |
| Old app `feature/genie` | In sync with origin; contracted-hours (exact/ranged) + shift-working-time added; Sentry removed. Serves as the live parity reference |
| Tech stack for rebuild | Was deferred until design done → **now unblocked**, still undecided |

---

## Where We're Going (next actions)

The user wants the **next chat to start the rebuild**. In priority order:

1. **Get the returned design package from the user** and orient to it (screens, design system, how Guided/Advanced + the Rules layer are expressed).
2. **Parity + feasibility/technical review of the design** against the Traycer corpus — does it preserve every must-not-lose capability (the 13-tab/12-domain inventory)? Watch-fors from the chain:
   - Coverings = **preceptor/preceptee supervision** (not shift substitution); weight stored-but-ignored; LEAVE requests hard pins.
   - No server-management UI (DL07 — a returned server selector is a parity miss vs. the *current* contract).
   - No on-screen roster viewer is specced (result = XLSX download + score/status).
   - `ALL` auto-generated in all 3 domains; `PH`/`WORKDAY`/`NON-WORKDAY` are import-created editable groups.
3. **Decide the tech stack** for the rebuild (deferred until now).
4. **Confirm the corpus reflects the new features** — the exact/ranged **contracted-hours** (`9aef889`) and **shift working time** (`64c84a3`) landed as code after the spec baseline; Sentry is removed. Verify the Traycer corpus covers these before the rebuild treats it as complete.
5. **Break into implementation tickets** (`/traycer-ticket-breakdown`) and start building in `/home/kenan/work/nursing-sheduler`.

**Likely first command next session:** confirm design location with the user, then `/traycer-review` (design-vs-spec parity/feasibility) or `/traycer-tech-plan` (stack decision).

**Possible loose end:** the `reference/` + `docs/epic-artifacts/` deletions in `nursing-sheduler` are uncommitted — the user may want them committed (or the repo may intentionally stay near-empty until scaffolding). Confirm before committing anything there.

---

## Open Questions / Reconciliation items

1. **Where is the returned Claude Design package?** Not on disk — ask the user.
2. **Does the Traycer corpus reflect the new contracted-hours (exact/ranged) + shift-working-time features and the Sentry removal?** These landed as code on `feature/genie` after the spec baseline. Verify before the rebuild treats the corpus as complete.
3. **Tech stack** for the rebuild — undecided (now unblocked by design being done).
4. **Commit the `nursing-sheduler` deletions?** — `reference/` + `docs/epic-artifacts/` removals are uncommitted.

*(Resolved since first draft: corpus divergence — the stale in-repo copy with its own DL set was removed; the Traycer epic corpus is now authoritative.)*

---

## Rebuild repo shape (as of 2026-07-15)

- **Bare/greenfield** — only `README.md`, `lefthook.yml`, an emptied `docs/`, `.git`. **No app code, no root `package.json`/`pyproject.toml`.**
- **Parity reference is the live old repo** `/home/kenan/work/nurse-scheduling` (the in-repo `reference/` snapshot was removed).
- **Spec corpus lives only in the Traycer epic** now (the in-repo `docs/epic-artifacts/` copy was removed).

## The two new old-app features (rebuild must cover these)

- **Contracted hours (exact + ranged)** — `9aef889`. `web-frontend/src/app/shift-counts/ContractedHoursEditor.tsx` (692 lines) + `core/nurse_scheduling/group_map.py` (175 lines) + `models.py`/`preference_types.py`/`scheduler.py` + `test_hours_contract_validation.py` (370 lines) + Playwright e2e. A nurse's contracted hours can be an exact value or a min–max range. Realized form of the earlier `hoursContract` metadata.
- **Shift working time** — `64c84a3`. `shiftWorkingTime.ts` + working-time fields on shift-type item groups. Governs how a shift's duration contributes to contracted-hours accounting.

---

## Gotchas / Non-obvious facts (carried from chain — still true)

- **Sentry is fully removed** from the old app as of `64c84a3`.
- **FREEDAY → NON-WORKDAY** rename happened in the (now-deleted) rebuild-repo corpus copy; check whether the authoritative Traycer corpus uses the same naming before building UI labels.
- **Two repos, two default branches:** `nurse-scheduling` → `feature/genie` (PRs into `dev`); `nursing-sheduler` → `main`.
- **Verification gate** (old-app web-frontend, from `web-frontend/`): `npm run lint && npm test && npm run build`. No `typecheck` script (pre-existing `tsc` test-globals gap). The old app added Playwright e2e + `bun.lock` in `9aef889` — the rebuild's toolchain is TBD (tech-stack decision).
- **Commit only when asked; push only when asked.** User commits directly sometimes — check `git log`/tree before assuming a change is unowned.
- **Author-too-close rule:** critiques/reviews of my own work go to a fresh cold agent (codex gpt-5.x, high reasoning); I apply fixes.
- **Decision logs to know (Traycer epic):** DL06 (fidelity), DL07 (backend URL via `NEXT_PUBLIC_BACKEND_API_URL`, no server-mgmt UI), DL08 (covering omitted date = all dates).

---

## Key Paths

- **Rebuild repo:** `/home/kenan/work/nursing-sheduler` (branch `main`) — bare/greenfield
- **Old app (parity reference):** `/home/kenan/work/nurse-scheduling` (branch `feature/genie`, repo `git@github.com:dev-seahouse/nurse-scheduling.git`)
  - `core/nurse_scheduling/` (models.py, preference_types.py, scheduler.py, group_map.py)
  - `web-frontend/src/app/shift-counts/ContractedHoursEditor.tsx` (new, 692 lines)
- **Traycer artifacts (authoritative corpus + design):** `/home/kenan/.traycer/epics/8b2235d5-8943-4f6d-a61e-3b671836217a/artifacts/`
  - `nurse-scheduling-design-handover/index.md` (+ `critique/`) — the design brief
  - `nurse-scheduling-functional-spec/`, `spec-critique-convergence-review/`, `backend-url-via-env-brief/`
- **Parent handoff:** `plans/handoffs/HANDOFF_rebuild-design-track_2026-07-14.md` (seq 1 — full history of the spec re-baseline, DL06/07/08, backend-env + duration + covering edits, the 10 handover-critique corrections, spec-corpus map, user preferences)
- **Memory:** `/home/kenan/.claude/projects/-home-kenan-work-nurse-scheduling/memory/design-stage-status.md` (master status)

---

## Notes

- This is a **thin-conversation** session: the user ran `/handoff` to checkpoint that the design is done and the rebuild starts next chat, then removed the stale in-repo corpus copy + old-app `reference/` snapshot. The substantive delta (rebuild workspace, 2 feature commits, the removals) was reconstructed from git/filesystem, **not** from chat — the next session should confirm the specifics (design location, feature coverage) with the user rather than assume.
- For deep background on everything before this point, read the **parent handoff** — it is not re-summarized here to avoid drift.
