# Solvers

Pass a solver code to the CLI with `--solver <code>`. OR-Tools/CP-SAT is the
default and the only recommended backend. Other backends are experimental or
limited.

## Support matrix

### [OR-Tools](https://developers.google.com/optimization)

| Solver | Selector | API | Platforms | Level |
| --- | --- | --- | --- | --- |
| CP-SAT | `ortools/cp-sat` | `cp_model.CpModel` and `CpSolver` | 🐧 🍎 🪟 | Recommended |
| CBC | `ortools/mpsolver/cbc` | `pywraplp.Solver` (MPSolver) | 🐧 🍎 🪟 | Experimental |
| SCIP | `ortools/mpsolver/scip` | `pywraplp.Solver` (MPSolver) | 🐧 🍎 🪟 | Experimental |
| CP-SAT | `ortools/mpsolver/cp-sat` | `pywraplp.Solver` (MPSolver) | 🐧 🍎 🪟 | Experimental |
| BOP | `ortools/mpsolver/bop` | `pywraplp.Solver` (MPSolver) | 🐧 🍎 🪟 | Limited |
| GSCIP | `ortools/mathopt/gscip` | `mathopt.Model` | 🐧 🍎 🪟 | Experimental |
| CP-SAT | `ortools/mathopt/cp-sat` | `mathopt.Model` | 🐧 🍎 🪟 | Experimental |
| HiGHS | `ortools/mathopt/highs` | `mathopt.Model` | 🐧 🍎 🪟 | Experimental |

### [PuLP](https://coin-or.github.io/pulp/)

| Solver | Selector | API | Platforms | Level |
| --- | --- | --- | --- | --- |
| GLPK | `pulp/glpk` | `pulp.LpProblem` | 🐧 🍎 🪟 | Limited |
| HiGHS | `pulp/highs` | `pulp.LpProblem` | 🐧 🪟 | Experimental |
| SCIP | `pulp/scip` | `pulp.LpProblem` | 🐧 🪟 | Experimental |

🐧 is Linux, 🍎 is macOS, and 🪟 is Windows. Only validated platforms are
shown.

`core/requirements.txt` is the minimal runtime set that the deployment images
install. It covers every OR-Tools selector plus PuLP.
`pulp/highs` and `pulp/scip` need `highspy` and `pyscipopt` from
`core/requirements-optional.txt`, so a deployment that advertises either one
must install that file as well. `pulp/glpk` additionally needs its external
runtime.

Recommended is the default. Experimental is tested but not recommended.
Limited is intended only for small or bounded cases.

- Linux and Windows coverage is x86_64 only. ARM validation is pending.
- PuLP/GLPK requires `glpsol`.
- PuLP/GLPK uses smoke coverage because some full regression models take
  several minutes without proving optimality.
- PuLP/HiGHS is skipped on macOS because its native library may conflict with the HiGHS library bundled with OR-Tools in the same Python process. Observed failure in GitHub runners, should investigate further in the future.
- PuLP/SCIP validation on macOS is pending.
- MPSolver/BOP is a legacy engine intended only for small cases.

## Runtime capabilities

The server exposes **Cancel** for every running or queued job. **Finish now** is
available only when the selected solver supports returning its current result.

| Selector | Graceful timeout | Finish now | Intermediate score events |
| --- | --- | --- | --- |
| `ortools/cp-sat` | Yes | Yes | Yes |
| `ortools/mpsolver/cbc` | No | No | No |
| `ortools/mpsolver/scip` | No | No | No |
| `ortools/mpsolver/cp-sat` | No | No | No |
| `ortools/mpsolver/bop` | No | No | No |
| `ortools/mathopt/gscip` | No | No | No |
| `ortools/mathopt/cp-sat` | No | No | No |
| `ortools/mathopt/highs` | No | No | No |
| `pulp/glpk` | No | No | No |
| `pulp/highs` | No | No | No |
| `pulp/scip` | No | No | No |

> **Note:** Capabilities have been manually confirmed only for
> `ortools/cp-sat`. Other backends remain
> unconfirmed and are left for future verification.

Graceful timeout means the solver is confirmed to observe the requested limit
and return on its own. Server-enforced timeout is global, so it is not stored
as a solver capability. Yes means the trait is confirmed and enabled in the
server registry. No means it is not confirmed and does not prove that the
underlying solver cannot support it.

### Server configuration

`GET /optimize/options` publishes the solver choices and defaults accepted by
one backend deployment. Solver labels, compute type, and finish-now support
come from the same capability registry as the supported selectors above.
Every advertised solver includes the deployment's integer timeout range and
running cancellation because the server enforces both at the process level.

Configure the ordered solver subset and defaults with:

```sh
OPTIMIZE_SOLVERS=ortools/cp-sat
OPTIMIZE_DEFAULT_SOLVER=ortools/cp-sat
OPTIMIZE_MIN_TIMEOUT_SECONDS=1
OPTIMIZE_DEFAULT_TIMEOUT_SECONDS=300
OPTIMIZE_MAX_TIMEOUT_SECONDS=3600
OPTIMIZE_DEFAULT_PRETTIFY=true
```

The default deployment advertises only `ortools/cp-sat`. The server fails
startup when an advertised solver runtime is unavailable.

**Finish now** asks the solver to stop and preserves its current feasible
schedule. The job fails without an artifact if interruption occurs before a
feasible schedule exists. **Cancel** discards any result and marks the job as
cancelled by immediately terminating its optimization process. Cancellation
uses error code `cancelled` and never preserves an artifact.

Intermediate score events are emitted before the solver returns. Native
OR-Tools CP-SAT reports incumbents through solution callbacks. Other backends emit a
score event only with their final feasible result. A solver-native time limit
preserves a feasible schedule when one is available. A forced watchdog timeout
fails without an artifact because the schedule is not checkpointed outside the
child process. These paths are reported as `solver_timeout` and
`process_timeout`, respectively. A solver registered for graceful timeout fails
the capability probe if the watchdog must terminate it.

Validate these capabilities against the large real scenario on the current
platform:

```sh
cd core
python tests/real/solver_capabilities.py --solver ortools/cp-sat
python tests/real/solver_capabilities.py --all \
  --json-output solver-capabilities.json
```

The probe runs timeout and each other confirmed trait as a separate subprocess.
Every round uses the large real scenario. Missing platform
runtimes are reported as `UNAVAILABLE` rather than stopping the remaining
checks.

## Test coverage

Test filenames below are relative to `core/tests/`.

### Low-level tests

| API | Test File |
| --- | --- |
| OR-Tools CP-SAT | `test_solver_ortools_cp_sat.py` |
| OR-Tools MPSolver | `test_solver_ortools_linear.py` |
| OR-Tools MathOpt | `test_solver_ortools_mathopt.py` |
| PuLP/GLPK | `test_solver_pulp_glpk.py` |
| PuLP/HiGHS and SCIP | `test_solver_pulp_python.py` |

### Schedule tests

| Selector | Coverage | Test File | Real Test |
| --- | --- | --- | --- |
| `ortools/cp-sat` | Full | `test_schedule_ortools_cp_sat.py` | `real/schedule_ortools_cp_sat.py` |
| `ortools/mpsolver/cbc` | Basic | `test_schedule_ortools_mpsolver_cbc.py` | — |
| `ortools/mpsolver/scip` | Basic | `test_schedule_ortools_mpsolver_scip.py` | — |
| `ortools/mpsolver/cp-sat` | Basic | `test_schedule_ortools_mpsolver_cp_sat.py` | — |
| `ortools/mpsolver/bop` | Smoke | `test_schedule_ortools_mpsolver_bop.py` | — |
| `ortools/mathopt/gscip` | Basic | `test_schedule_ortools_mathopt_gscip.py` | — |
| `ortools/mathopt/cp-sat` | Basic | `test_schedule_ortools_mathopt_cp_sat.py` | — |
| `ortools/mathopt/highs` | Basic | `test_schedule_ortools_mathopt_highs.py` | — |
| `pulp/glpk` | Smoke | `test_schedule_pulp_glpk.py` | — |
| `pulp/highs` | Basic, skipped on macOS | `test_schedule_pulp_highs.py` | — |
| `pulp/scip` | Basic | `test_schedule_pulp_scip.py` | — |

Full coverage includes Basic coverage and an enabled real-scenario test. Basic
coverage runs every non-real YAML fixture. It normally solves each valid case
again while avoiding the first solution, then checks the expected schedule.
Smoke coverage uses one representative scenario with a fixed timeout. Tests
under `core/tests/real/` are explicit, slower checks outside the normal test
discovery rules.

## Excluded backends

Commercial or proprietary integrations such as CPLEX, Gurobi, MOSEK, XPRESS,
COPT, SAS, and MIPCL are intentionally excluded from the standard environment.

### OR-Tools

- Continuous solvers such as GLOP, CLP, and PDLP cannot represent this
  project's binary and integer scheduling model.
- MathOpt/GLPK is not bundled in the OR-Tools Python wheel. GLPK is exposed
  through PuLP instead.
- Additional aliases for the same engine are omitted unless they provide a
  useful API or test boundary.

### PuLP

- CyLP is excluded because PuLP 3.3.2 loses the maximization sense while
  passing its MPS model to CyLP, which can return a minimized schedule as
  “Optimal.”
- `COIN_CMD`, `HiGHS_CMD`, `SCIP_CMD`, and `FSCIP_CMD` require separate
  executables and mostly duplicate supported HiGHS and SCIP engines.
- `PYGLPK` and `COINMP_DLL` are unavailable legacy integrations. GLPK is
  supported through `GLPK_CMD`.
- `CHOCO_CMD` requires Java and a separately managed parser JAR, neither of
  which is part of the project environment.
- PuLP's CP-SAT integration is not present in the pinned PuLP 3.3.2 release.
  The native OR-Tools/CP-SAT backend is already the recommended default.
