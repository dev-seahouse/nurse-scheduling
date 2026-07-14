# HANDOFF — Nurse-Scheduling Rebuild: design track + current-app parity edits

**Chain:** epic-8b2235d5 · **Seq:** 1 (new chain, no parent handoff found)
**Date:** 2026-07-14
**Branch:** `feature/genie` · **Repo:** `/home/kenan/work/nurse-scheduling` (`git@github.com:dev-seahouse/nurse-scheduling.git`)
**Traycer epic:** `8b2235d5-8943-4f6d-a61e-3b671836217a`
**Auto:** false

---

## Goal

Two intertwined threads run under this epic:

1. **Design track (the live thread).** Hand the whole app off to Claude Design for a UI-prototype redesign, get the package back, then review it for **parity + feasibility/technical implementation**, and only then break it into implementation tickets. We are currently on the **send-handover** side — waiting for the user to finish designing and return the package.
2. **Current-app parity edits on `feature/genie`.** A series of user-directed changes to the shipped app that *also* shift the rebuild's parity contract, each propagated into the spec corpus + a decision log. All complete and committed; some unpushed.

The governing frame for everything: **decision log 06 (DL06) fidelity rule** — the shipped Python backend (`core/nurse_scheduling/`) is the *binding contract*; the UI is *free*; current-frontend quirks are `[incidental]` (not required); the spec-12 `leaveTypes`/multi-type/creditMinutes-store vision is `[DEFERRED]`; the pre-Pydantic `LV`→`LEAVE` migration is `[REMOVED]` entirely.

---

## Where We Are (current state)

### Design track — send-handover side, awaiting return
- **Handover artifact:** `/home/kenan/.traycer/epics/8b2235d5-.../artifacts/nurse-scheduling-design-handover/index.md` — prepared, cold-critiqued (10 findings, all fixed & verified against source), and **current** (reflects DL07; DL08 needed no change — its coverings rows already say "optional dates").
- **Package zip:** `/home/kenan/work/nurse-scheduling/nurse-scheduling-design-handover-2026-07-14.zip` (332 KiB, created today 09:24). Also previously written to `~/Desktop`. Contains the current handover + full current spec corpus (incl. DL07 + DL08). **Excludes** the handover's internal `critique/` folder and the epic brief (`nurse-scheduling-rebuild-brief`, predates Guided/Advanced adoption → stale framing).
- **No design work has been returned yet.** The `Genie Control Station Design.zip` on the Desktop is a *different* project — not this one.
- **Adopted design decisions baked into the handover:** Guided/Advanced mode is **ADOPTED** (not a proposal), with the plain-English **"Rules" layer** as Guided's expression of the 6 preference editors; **mobile-first responsive** (person×date matrix / coverings / roster data-density is the flagged key challenge); **full 13-tab/12-domain inventory**; **fresh slate but keep** the Ledger design-system foundation + mode model + screen grouping; **AI assist = exploratory/feasibility-TBD only**.

### Current-app edits — all committed on `feature/genie`
`feature/genie` is **4 commits ahead of `origin/feature/genie`** (origin is at `a4f79f4`). Working tree clean except untracked `node_modules/` and the handover zip.

| Commit | What | Pushed? | In this conversation? |
|---|---|---|---|
| `8bb7c32` | Backend URL via `NEXT_PUBLIC_BACKEND_API_URL` (multi-server selector removed) | ✅ pushed | yes |
| `a4f79f4` | Drop redundant read-only `Backend: {url}` line (keep badge + Re-check) | ✅ pushed | yes |
| `a8a6b77` | Shift-type Duration entered as **hours + minutes** (stores `durationMinutes`) | ❌ unpushed | yes |
| `31c5125` | **core:** covering omitted `date` → all dates; preceptor-group comment; regression test (user's own commit) | ❌ unpushed | yes |
| `7764e80` | **core:** add `hoursContract` metadata + leave-credit regression tests | ❌ unpushed | **NO — outside transcript** |
| `2e2c074` | web-frontend: warn when an hours contract omits LEAVE for a nurse on leave | ❌ unpushed | **NO — outside transcript** |

⚠️ **Reconciliation flag:** `7764e80` + `2e2c074` (the `hoursContract` metadata line) are real commits on the branch but are **not part of the conversation I have context for**. They touch `core/nurse_scheduling/models.py`, `LeaveCreditAdvisory.tsx`, `leaveCreditWarning.ts`, `useSchedulingData`, `shift-counts/page.tsx`, and `prototype/leave_daystate_160h.yaml`. Next session should check whether the spec corpus / design handover need to reflect a new `hoursContract` field before relying on the corpus as "current." See memory `prototype-contracted-hours-requirement.md` and `leave-daystate-oldcodebase-testrun.md` for the likely origin thread.

### Corpus status
- **Build-ready.** A 6-round convergence critique loop (fresh cold agents each round) converged clean at round 6; finding rate 4→4→4→7→6→**0**, **zero CRITICAL/HIGH ever**. Verdict recorded in artifact `spec-critique-convergence-review/`.
- **Decision logs:** DL06 (fidelity rule), DL07 (backend URL via env — supersedes spec 10 FR-OE-01..29 server-management), DL08 (covering omitted-date = all dates — reconciled across C3 CON-SEM-07, C1, spec 05 FR-PR-84, spec 11 FR-CV-07/12, behavior-catalog CC-B1).

---

## What We Did This Session (chronological)

1. **Prepared the design handover package** for Claude Design after the user answered 4 framing questions: fresh-slate-but-keep-list, Guided/Advanced *decided*, full inventory, mobile-first responsive.
2. **Answered spec/code questions** about `OptimizationProgressChart` (FR-OE-59/60): confirmed the two-series (Score always / Comments toggle default-on) chart exists at `web-frontend/src/components/OptimizationProgressChart.tsx`, rendered conditionally (`progressPoints.length >= 2`) inline in `optimize-and-export/page.tsx:1562` — a **live-only surface** (needs a real running job streaming ≥2 SSE points).
3. **Cold-critiqued the handover** (fresh codex gpt-5.6 agent, since I authored it): 2 Critical + 7 High + 1 Medium. Verified every load-bearing finding against source, fixed all 10. Critique preserved & marked RESOLVED at `nurse-scheduling-design-handover/critique/index.md`.
4. **Backend-URL-via-env (DL07)** — user directive: drop the multi-server selector, control via `.env`, keep status badge, apply now, update all rebuild artifacts. Ran as tickets tbe1 (code, delegated to an Opus agent) + tbe2 (docs, mine). Verified: lint clean, 618 tests, build green. Added a **Re-check** button (confirmed the old app re-checked only on mount + manual Check-all/per-row — no polling — so once-on-mount alone was a regression). Committed `8bb7c32` + `a4f79f4`, **pushed**.
5. **Duration hours+minutes (a8a6b77)** — user found "minutes-only" hard to think in. Changed the Shift-Type duration input to two fields (hours + minutes); still stores integer `durationMinutes` (`hours×60 + minutes`); UI-only, no contract change. Verified 618/618 + build green.
6. **Covering omitted-date bug fix (DL08)** — a `core/` change (the covering handler treating omitted `date` as all dates) appeared uncommitted; user confirmed intentional. I investigated → confirmed it's a **bug fix** (model docstring says `None = ALL`; requirement/successions siblings already did this; covering was the odd one out making UI-authored coverings silent no-ops). Full `core/` suite 267 passed. Reconciled 6 spec locations + created DL08. Scanned repo → **nothing relied on the no-op** (zero coverings in any scenario/fixture). User committed it as `31c5125`; release note lives in DL08 (no changelog file).
7. **Resumed the design track** — regenerated the current package zip (DL07/DL08 included), confirmed no design output returned yet. Then the user said "continue" (transcript ends there; this session opened on `/handoff`).

---

## What We Tried / Decided (and why)

| Decision | Choice | Why |
|---|---|---|
| Handover vs Ledger prior design | Fresh slate + explicit keep-list | User wants unbiased redesign but keep the design-system foundation |
| Guided/Advanced mode | ADOPTED (not a proposal) | User confirmed it's already decided in their WIP design |
| Backend config | Build-time `NEXT_PUBLIC_BACKEND_API_URL` | Per-environment backend; user didn't need runtime switching (flagged `NEXT_PUBLIC_*` is build-time-baked) |
| Re-check button | Added | Old app had manual re-check (Check-all); once-on-mount-only was a real regression |
| Duration input | Hours + minutes (two fields) | User-preferred; integer-exact when stored as minutes |
| Covering date fix | Kept + reconciled spec | It's a bug fix matching the model's own documented `None = ALL` intent |
| DL08 release note | Artifact only, no CHANGELOG | User: "we have it in our artifact" |
| Commit `31c5125` message | Left as-is (no DL08 ref) | DL08 lives outside git; a ref would dangle in `git log` |

---

## Gotchas / Non-obvious facts (do not re-derive)

- **`NEXT_PUBLIC_*` is baked at build time** — the backend URL is fixed per build/deploy, not runtime-switchable. Runtime config would need a `/config` fetch (not chosen).
- **No `typecheck` npm script.** `npx tsc --noEmit` reports `Cannot find name 'vi'/'expect'/'describe'` in *test files* — a pre-existing project-wide gap (vitest globals not in base tsconfig `types`). Not a regression. Use `npm run build` (type-checks source) + `npm test` + `npm run lint` as the verification gate, run from `web-frontend/`.
- **Shift Type Coverings = a preceptor/preceptee *supervision* constraint**, NOT shift-type substitution. When a preceptee works a chosen shift on a chosen date, a preceptor must also work it. Four multi-selects; OFF/LEAVE rejected. Weight is stored-but-ignored (always hard). LEAVE requests are hard pins. (This was the Critical handover finding — don't regress it.)
- **`ALL` is auto-generated in all 3 domains** (People/Dates/Shift-Types); `PH`/`WORKDAY`/`NON-WORKDAY` are import-created *editable* groups (not read-only).
- **No on-screen solved-roster viewer is specced** — the result is a downloaded XLSX + score/status only. An in-app roster is a *new exploratory idea*, not parity.
- **Covering date semantics (post-DL08):** omitted/`None` = all dates; `[ALL]` = all dates; explicit `date: []` = no-op.
- **`LEAVE_CREDIT_MINUTES=480`** (8h default) is a **frontend auto-fill constant**, not a backend field. Shipped auto-fill rounds/overwrites/never-blocks.
- **Commit/push discipline:** only commit when the user asks; only push when the user asks (standing rule — kept the branch local until "Push feature/genie" was explicit).
- **Author-too-close rule:** critiques/reviews of work *I* authored go to a **fresh cold agent** (codex gpt-5.x high-reasoning via `traycer_create_agent` + `traycer_send_message` expectReply:true); *I* apply the fixes.

---

## Open Questions / Reconciliation items

1. **`hoursContract` metadata (commits `7764e80` + `2e2c074`)** — present in git, outside this conversation's context. Does the spec corpus / design handover need to reflect a new `hoursContract` model field + the "LEAVE omitted for a nurse on leave" advisory? Verify before treating the corpus as fully current.
2. **4 unpushed commits** on `feature/genie` (`a8a6b77`, `31c5125`, `7764e80`, `2e2c074`) — the user has not asked to push these yet. Do not push unprompted.
3. **Ticket t01 (Home/App-Shell spec)** — the one genuinely-unwritten in-scope spec; tracked as known-open, not started (awaits user direction).

---

## Where We're Going (next actions — all await user direction)

The last user message was "continue" on the design track, with these standing options offered:
- User sends the current package to Claude Design → returns the design package → we run the **parity + feasibility/technical review** → `/traycer-ticket-breakdown`.
- Or a handover tweak before sending (scope / framing / screen coverage).
- Watch-for on the returned design: since DL07, the rebuild's Optimize page has **no server-management UI** — a returned server selector is a parity miss against the *current* contract (not the old app).

**No new task should start without explicit user direction** — all completed threads are at natural stopping points.

---

## Key Paths

- **Repo:** `/home/kenan/work/nurse-scheduling` (branch `feature/genie`)
- **Frontend:** `web-frontend/` — verify with `npm run lint && npm test && npm run build` from there
- **Backend/core:** `core/nurse_scheduling/` (models.py, preference_types.py) — `pytest` from `core/`
- **Artifacts root:** `/home/kenan/.traycer/epics/8b2235d5-8943-4f6d-a61e-3b671836217a/artifacts/`
  - `nurse-scheduling-design-handover/index.md` (+ `critique/`) — the live handover
  - `nurse-scheduling-functional-spec/` — the corpus (11 domain specs, contracts C1–C5, behavior-test-catalog, decision-logs 01–08, tickets, reviews)
  - `spec-critique-convergence-review/` — convergence verdict
  - `backend-url-via-env-brief/` — DL07 epic brief
  - `shift-type-covering-date-guard-review/`, `leave-daystate-contract/` — recent review artifacts
- **Package zip:** `/home/kenan/work/nurse-scheduling/nurse-scheduling-design-handover-2026-07-14.zip`
- **Memory:** `/home/kenan/.claude/projects/-home-kenan-work-nurse-scheduling/memory/` — see `design-stage-status.md` (the master status file — read this first; it holds the full re-baseline history), `prototype-contracted-hours-requirement.md`, `leave-daystate-oldcodebase-testrun.md`, `wip-design-ground-rules.md`, `course-user-html-state.md`

> **Note:** `design-stage-status.md` is the single most complete durable record of this epic's state (spec re-baseline, DL06/07/08, convergence, handover critique). It was the primary source for much of this handoff. When it and this file agree, trust either; this file adds the git-reality delta (4 unpushed commits, the two out-of-transcript `hoursContract` commits) that memory didn't yet capture.

---

## Appendix A — What the design handover actually contains

The handover (`nurse-scheduling-design-handover/index.md`) is a self-contained brief that orients Claude Design without duplicating the spec (every screen links back into the corpus for depth). It opens with **"the one hard rule"** (DL06: backend binding, UI free, quirks incidental) and covers, roughly by section:

- **§3 Adopted interaction model** — Guided/Advanced + Rules layer stated as *decided*, with the load-bearing contract that **no capability may live in only one mode** and mode-switch must be **non-mutating + lossless**.
- **§4 Entity model** — two lifecycles: `ALL` auto-generated in all 3 domains; `PH`/`WORKDAY`/`NON-WORKDAY` import-created *editable* groups.
- **§5 Full 13-tab / 12-domain screen inventory** — a table (purpose · must-not-lose capabilities · spec link) + a nav mermaid. The Optimize row now says backend URL is deployment config with a read-only status only (post-DL07).
- **§6 The six preference editors** — per-editor semantics with a **soft/hard column** (Coverings always hard; LEAVE requests hard pins).
- **§7 Live optimization lifecycle** — queued → running(+chart) → optimal/feasible/infeasible/cancelled/failed, incl. no-incumbent cancel/finish-now outcomes and the live-only progress chart's pre-run empty state.
- **§8 Mobile-first responsive** — the person×date matrix / coverings / roster data-density is framed as *the* design problem to solve head-on (not shrink-a-table). This is the highest-risk design bet.
- **§9 Fresh slate + keep-list** (Ledger design-system foundation, mode model, screen grouping).
- **§10–11 Out of scope** (telemetry/ops, deferred `leaveTypes` multi-type vision, AI-assist as optional appendix) + how the return review will work.

## Appendix B — The 10 handover-critique corrections (do not regress these)

All confirmed against source and fixed; record kept at `nurse-scheduling-design-handover/critique/index.md` (marked ✅ RESOLVED).

| # | Sev | Was wrong | Corrected to |
|---|---|---|---|
| 1 | Critical | Coverings = "which shift types cover which" | preceptor/preceptee **supervision** rule (4 multi-selects, OFF/LEAVE rejected) |
| 2 | Critical | "one shared weight/priority language across all six" | per-editor **soft/hard** table (Coverings weight ignored/hard; LEAVE hard pins) |
| 3 | High | invented an **on-screen roster** result | result = downloaded XLSX + score/status; on-screen roster = exploratory-only |
| 4 | High | entity map wrong | `ALL` auto-gen in all 3 domains; `PH`/`WORKDAY`/`NON-WORKDAY` editable |
| 5 | High | Optimize flow omitted binding states | added queued/feasible/infeasible + server/run-options/event-log/download-again/no-incumbent |
| 6 | High | contracted-hours had no interaction home; 480 overstated as binding | reframed as cross-screen workflow; 480 = frontend default `[incidental]` |
| 7 | High | Guided/Advanced lacked a switch contract | added non-mutating + lossless-mapping contract |
| 8 | High | AI both "out of scope" and "include it" | AI = clearly-optional appendix only |
| 9 | High | frontend mechanisms framed as mandatory parity | 50-deep undo / localStorage / shortcuts tagged `[incidental]` |
| 10 | Medium | "self-contained" leaned on an unattached Ledger package | softened to "the *idea* of one design system" |

## Appendix C — Code-change specifics (for revisiting the branch)

**Backend-env (`8bb7c32`):** `serverSelection.ts` collapsed to a single
`export const BACKEND_API_URL = (process.env.NEXT_PUBLIC_BACKEND_API_URL || DEFAULT_BACKEND_API_URL).trim().replace(/\/+$/,'')` with `DEFAULT_BACKEND_API_URL='http://localhost:8000'`. Retired: `BACKEND_API_CANDIDATES`, `PRODUCTION/LOCAL/INITIAL_BACKEND_API_URL`, `selectOfflineFallbackBackendApiUrl`, `selectPreferredServer`, `SHOULD_DISABLE_PRODUCTION_BACKEND_API`, `NEXT_PUBLIC_DISABLE_HOSTED_OPTIMIZE_API`, `ServerHealthCheckResult`. Kept `ServerHealthResponse`. `page.tsx` dropped ~600 lines (whole Backend-management card + storage + auto-select/probe machinery); status badge + version line preserved via one on-mount `fetchServerHealth(BACKEND_API_URL)`. Added `.env.example` (tracked; `.gitignore` `!.env.example` opt-in). Diff was −1093/+79 across 5 files. `next.config.ts` untouched (`NEXT_PUBLIC_*` inlined automatically).

**Re-check button (in `8bb7c32`):** health check refactored into a reusable stale-guarded `runHealthCheck` (aborts in-flight probe), called on mount + by a `FiRefreshCw` **Re-check** button beside the badge.

**Duration (`a8a6b77`):** `AddEditItemGroupForm.tsx` + `ItemGroupEditorPage.tsx` — draft holds h/m; parsed to `durationMinutes = hours×60 + minutes` on save; existing values split into h/m on edit. `ItemGroupEditorPage`/`AddEditItemGroupForm` are shared across People/Dates/Shift-Types editors (why the full suite was run). No component test touched the duration input; `countShiftTypeCoefficients.test.ts` uses the stored number and is unaffected.

**Covering fix (`31c5125`, core):** `preference_types.py` covering handler now does `ds = range(ctx.n_days)` when `date is None` (was `parse_dates(None)` → `[]` → silent no-op). Matches requirement (line ~132) + successions (line ~312) siblings and the model docstring `date: ... = None  # None = ALL`. Also a comment-only clarification: flat `[A,B]` = every listed preceptor must cover; nested `[[A,B]]` = at least one. Regression test in `test_shift_type_covering_preference.py`. Full `core/` suite: **267 passed**.

## Appendix D — Spec-corpus map (navigation)

Under `nurse-scheduling-functional-spec/`:

- `index.md` — top-level story; fidelity bar aligned to DL06; spec-12 row split shipped-vs-deferred.
- **Domain specs:** 01 data-model & entities · 03 item/group editors · 04 (leave-related) · 05 card-preference-editors (covering date-drop = FR-PR-84) · 06 requirements · 07 state/history/persistence (FR-ST-04a) · 08 save/load & YAML (FR-SL-02a) · 09 exporter · 10 optimize & export (FR-OE-01..29 server-mgmt now `[SUPERSEDED — DL07]`; FR-OE-59/60 the progress chart) · 11 shift-type coverings editor (FR-CV-07/08/12) · 12 contracted-hours & leave (the `[DEFERRED]` vision fence). *(t01 Home/App-Shell spec is the one unwritten in-scope spec.)*
- **Contracts (fixed/binding):** C1 YAML/scenario schema · C2 HTTP/serve API · C3 preference/constraint semantics (CON-SEM-07 = covering dates) · C4 solver phase-callbacks · C5 exporter output.
- **`behavior-test-catalog/`** — maps shipped tests to behaviors; CH rows tagged `[parity]`/`[mixed]`; OE section carries a DL07 scope note; CC-B1 = covering caveat (DL08).
- **`decision-logs/`** — 05 (contracted-hours/leave, partially superseded by 06) · 06 (fidelity rule) · 07 (backend env) · 08 (covering date).

## Appendix E — User working preferences (observed)

- **Thinks in hours, not minutes** (drove the duration change). Prefers concrete, decisive scope calls; answers via the AskUserQuestion option chips.
- **Commit only when asked; push only when asked.** Keeps `feature/genie` local by default. No `--push` unprompted.
- **Wants full context in deliverables** — asked for the *entire* handover package (handover + full spec corpus) as one zip, folder structure preserved so internal links resolve.
- **Release notes / rationale live in Traycer artifacts**, not in-repo changelogs (explicitly declined a `CHANGELOG.md`).
- **Trusts but verifies:** repeatedly asked me to check claims against the *actual* code/spec rather than answer from memory ("is that true?", "check the codebase"). Mirror this — ground answers in source.
- May make **core/ commits directly** between messages (e.g. `31c5125` was the user's own commit). Check `git log`/working tree before assuming a change is unowned.

## Appendix F — Verification evidence (raw)

- Backend-env: `npm run lint` exit 0 · `npm test` 57 files / **618 tests** pass · `npm run build` exit 0, `/optimize-and-export` prerendered · optimize suite re-run by me **23/23** · no dangling refs.
- Duration: lint clean · affected suites 60/60 · full suite **618/618** · build green.
- Covering: covering suite 7/7 (incl. 2 new integration tests) · full `core/` suite **267 passed** · repo scan found **zero** covering rules in any scenario/fixture (nothing relied on the old no-op).
- Convergence critique: 6 rounds, finding rate 4→4→4→7→6→**0**, zero CRITICAL/HIGH across all rounds; round 6 all-clean = genuine convergence.
