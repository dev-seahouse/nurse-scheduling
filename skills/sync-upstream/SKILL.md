---
name: sync-upstream
description: Merge upstream j3soon/nurse-scheduling `dev` into the genie fork branch `feature/genie`. Use when asked to sync, port, or bring upstream updates into genie, or to resolve an upstream merge on `feature/genie`.
---

<!-- This file is mostly AI generated. -->

# Sync upstream into genie

The goal is a genie branch that stays as close to upstream as possible. Take
the upstream version of a file by default. Then apply the genie deltas on top.
Keep genie-only code in genie-owned files, because a new file never conflicts.

## Steps

1. Make sure that `git config user.name` and `user.email` are set. If they are
   not set, ask the user. The repo pins the SSH key in `core.sshCommand`. If
   `git fetch` fails with `communication with agent failed`, ask the user to
   unlock 1Password.
2. Update `dev`. This checkout has only the fork remote `origin`
   (dev-seahouse/nurse-scheduling) and no `upstream` remote. Upstream j3soon
   `dev` arrives when the user runs Sync fork on GitHub, so ask for that first,
   then run `git fetch origin` and `git merge --ff-only origin/dev` on `dev`.
   Then work in a separate worktree so that the `dev` checkout stays clean:
   `git worktree add ../nurse-scheduling-genie feature/genie`.
3. Run `git merge dev --no-commit`. Count the conflict hunks per file.
4. For each conflicted file, read the genie diff since the merge base
   (`git diff $(git merge-base HEAD MERGE_HEAD) HEAD -- <file>`). If the file
   carries no genie delta from the list below, take the upstream side with
   `git checkout --theirs`. Otherwise take the upstream side and reapply the
   delta by hand.
5. Remove every item on the removal list again, including the new upstream
   code that uses it.
6. Run the checks. All checks must pass before you stage anything.
7. Stage and commit only when the user asks. Write the merge message by hand.

## Genie deltas to keep

- Core `LEAVE` day-state: `constants.LEAVE`/`LEAVE_sid`, `Context.leaves` and
  `pinned_leaves`, the three-state day constraint and leave pinning in
  `scheduler.py`, `_day_state_expr` in `preference_types.py`, and `Leave`
  rendering in `exporter.py`.
- `ShiftType` working time (`durationMinutes`, `startTime`, `endTime`,
  `restMinutes`) and `ShiftCountPreference.hoursContract` in `models.py`.
- `shift type covering` preference: model, `CompiledShiftTypeCovering`, compile
  branch, and handler.
- `group_map.validate_contracted_hours`. It receives the upstream compiled
  shift map from `_validate_and_compile_schedule`. Do not build a second map.
- Frontend: `NEXT_PUBLIC_BACKEND_API_URL` single backend (no server list),
  contracted hours, leave warnings, working time, `NON-WORKDAY` and `PH` date
  groups, and the Coverings tab.
- Singapore holidays (`singaporeHolidays.ts`) in place of `taiwanHolidays.ts`.
- AI assistant on the Singapore calendar. Reapply these parts when upstream edits them:
  - `ai/schema.py`: `SINGAPORE_HOLIDAYS_SOURCE` and `load_singapore_holidays_reference`.
  - `ai/app.py`: `SingaporeHolidayEntry`, the `singapore_holidays` field on
    `CreateSessionRequest`, `UpdateScheduleRequest`, and `ChatSession`, and
    `SessionStore.singapore_holidays`.
  - `ai/sandbox_agent.py`: the `singapore_holidays` argument, the
    `"singapore-holidays"` reference, and `/reference/singaporeHolidays.json`.
  - Every `run_sandbox_agent` call passes the holidays: the chat handler,
    `background.run_background_turn`, and `tests/ai_eval/runner.run_case`.
  - Guidance: `prompts/sandbox-system.md` and the `references/schema-*.md`
    date, shift type, shift count (`hoursContract`), shift request (LEAVE), and
    shift type covering topics.
  - Frontend: `experimental-ai/aiClient.ts` and `page.tsx`, which send
    `useSingaporeHolidays()` entries.
  - Evals: `tests/ai_eval/fixtures/singapore-holidays.json` (data.gov.sg
    snapshot), the `singapore-holidays` cases, and `NON-WORKDAY` in place of
    `FREEDAY`.
  - The user-guide pages `dates.md` and `get-started.md`, and the docker copy
    of `singaporeHolidays.ts`.

## Removal list

- Sentry, backend and frontend: `core/nurse_scheduling/sentry.py`,
  `sentry-sdk`, every `init_sentry`, `flush_sentry`, `capture_*`,
  `report_outage_recovery`, and `tag_client_address` call, `@sentry/nextjs`,
  `sentry.*.config.ts`, `instrumentation-client*.ts`,
  `OptimizationFeedbackNudge*`, and the `withSentryConfig` wrapper in
  `next.config.ts`.
- The scheduling-data anonymizer for Sentry reports:
  `core/nurse_scheduling/anonymize_scheduling_data.py`. The frontend
  `anonymizeSchedulingState` stays.
- The suspicious-request tracker: `server/suspicion.py`, the `suspicion_*`
  settings, `report_suspicious_request`, and `SUSPICION_*` variables.
- Docs and docker: Sentry sections, `x-sentry-environment` anchors,
  `DISABLE_SENTRY`, and the suspicion rows in `docs/content/backend-server.md`.
- The PuLP CBC and cuOpt solvers: `solver_pulp_cbc.py`, `solver_pulp_cuopt.py`,
  their entries in `scheduler.py`, `server/solver_capabilities.py`, and
  `server/solver_options.py`, the CBC/cuOpt branches and solver-log tailing in
  `solver_pulp.py`, their tests, the CBC exception in
  `tests/real/solver_capabilities.py`, `docker/Dockerfile.dev.cuopt`,
  `docker/.env.gpu.example`, and their docs rows. `ortools/mpsolver/cbc` is a
  different solver and stays.
- `web-frontend/AGENTS.md`. The root `AGENTS.md` line about reading it is
  changed to say so. Keep that change when upstream edits the line.

Find leftovers in the working tree, not the index:

```sh
grep -rilE 'sentry|suspicio|anonymize_scheduling' . --exclude-dir=node_modules \
  --exclude-dir=.venv --exclude-dir=.next --exclude-dir=out --exclude-dir=.git \
  --exclude=bun.lock
```

The expected hits are `plans/handoffs/`, `web-frontend/.gitignore`, and
`web-frontend/.vscode/mcp.json`.

## Checks

- Core: use a worktree venv, because the system Python lacks the upstream
  dependencies. Run `uv venv core/.venv` and
  `uv pip install --python core/.venv/bin/python -r core/requirements-optional.txt`.
  Then run Ruff and pytest. If upstream reintroduced the
  `--ignore-glob=*pulp_cbc.py` style exclusions in the test scripts, remove them
  again together with the matching `scripts/test_affected_harness.sh` assertion.
- Adapt new upstream AI code to the genie deltas above. Do not skip AI tests.
  Search the AI code, references, eval cases, and user-guide pages again for
  Taiwan, `taiwanHolidays`, `FREEDAY`, and `SPECIAL_DATE_INFO`. Add every new
  genie model or field to `MODEL_TOPIC_COVERAGE` and
  `CANONICAL_FIELD_REQUIREMENTS` in `test_ai_schema.py`, with a matching
  reference topic.
- To refresh the eval holiday snapshot, fetch the data.gov.sg dataset that
  `singaporeHolidays.ts` names, and convert it with the same `parseApiResponse`
  rules (strip ` (Observed)` into `isObserved`).
- Frontend: run `bun run lint`, `bun run build`, and the unit tests with
  `NODE_OPTIONS=--no-experimental-webstorage`. Node 26 has a global
  `localStorage` that hides the jsdom one.
- Resolve `bun.lock` with `bun install` after you resolve `package.json`.
- Keep the `testIgnore` for `experimental-ai-*.spec.ts` in
  `playwright.config.ts`. Run Playwright once without it (`RUN_AI_E2E=1`) and
  once with it. Upstream specs often assume the server list, OFF as the only
  automatic shift type, or FREEDAY. Adapt them to genie instead of skipping them.
- If `core/tests/testcases/real/large-ward-with-87-people-2025-11.yaml`
  changes, copy it to `web-frontend/public/examples/`. Genie renamed
  `FREEDAY` in it.
