# Architecture

## System overview

Two systems share one deterministic core:

```
┌──────────────────────────── STUDIO (Node) ────────────────────────────┐
│  Agents (11) ── Blackboard / Artifacts / Event bus / Metrics / Logs   │
│       │                                                               │
│       ▼                                                               │
│  Pipeline: BRIEF→DESIGN→IMPLEMENT→BUILD→QA→PERF→(TRIAGE/FIX)*→RELEASE │
│       │                          │                                    │
│       │                          ▼                                     │
│       │                 QA Harness (bots, invariants)                   │
│       ▼                                                                │
│  content/pack.json ◄───────────── generated, validated, versioned      │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ build (esbuild + checksums)
                                ▼
┌──────────────────────────── GAME (browser) ────────────────────────────┐
│  Simulation (deterministic, fixed 60Hz step)                           │
│    ▲ FrameInput + discrete actions        │ gameBus events             │
│    │                                      ▼                            │
│  main.ts loop                    Renderer / AudioSystem / UI           │
└────────────────────────────────────────────────────────────────────────┘
```

The **same `Simulation` class** is driven by QA bots on Node and by humans in the browser. That single seam is what makes "QA must actually test the game" true rather than theatrical.

## Determinism model

- One master seed derives four RNG streams (`combat`, `loot`, `ai`, `misc`) via splitmix32 hashing. Streams never cross-contaminate: regenerating a floor cannot change combat rolls.
- Fixed timestep `1/60`. All timers are tick-counted floats; no wall-clock reads inside the sim.
- Floor generation is seeded per `(masterSeed, depth, attempt)`; generation validates reachability and retries with derived seeds.
- Saves serialize full state including RNG stream states. JSON round-trips doubles exactly; `Infinity`/`NaN` are encoded as sentinel strings (a real bug we hit and fixed — see DECISIONS.md).
- `stateHash()` (canonical key-sorted serialization → FNV-1a) proves equivalence; used by replay tests, save/load spot checks, and regression pins.

Consequence: **seed + input script ⇒ bit-identical run**. QA failures are reproducible forever.

## Engine layers

| Layer | Path | Notes |
|---|---|---|
| Core | `src/engine/core/` | RNG, math, events, spatial helpers, hash |
| World | `src/engine/world/` | tile map, procgen (rooms/MST+loops/corridors), DDA LOS, A* |
| Sim | `src/engine/sim/` | state model, player/enemy/NPC systems, combat math, quests, inventory, progression, save/load |
| Content | `src/engine/content/types.ts` | content-pack schema + validator (shared contract) |

### Entity model
Pragmatic component-bag entities (plain objects in one `Map<id, Entity>`), filtered per system. Chosen over full ECS deliberately: at our scale (<200 solids/floor), an O(n²) separation pass with early distance rejection beats grid-rebuild bookkeeping while staying trivially correct. Benchmarks agree (~0.02–0.04 ms/tick headless).

### Enemy AI
Perception is **staggered** (each enemy perceives on its own 9-tick phase): vision cone via LOS raycast plus a hearing channel fed by gameplay noise events (swings, dodges, projectiles). Memory holds last-seen position with decaying alertness; states flow idle → patrol → investigate → chase → windup(telegraph) → attack, with behavior families melee / ranged-kite / charger. Windups are uninterruptible commitments — readable combat.

### Quests
Templates parameterize into instances per floor: slay targets roll from that floor's plentiful enemies; collect objectives count lifetime acquisitions (drinking potions never un-completes them) and **guarantee their deficit spawns on accept**; explore counts visited rooms. A QA invariant asserts ground-coverage of every active collect deficit — completability is checked, not assumed.

## Studio design

- **Agents** subclass `Agent` (identity, scoped logging, artifact writes, action bus). They read the shared `Blackboard` and write versioned artifacts; no hidden channels.
- **Pipeline** phases are timed, logged, and audit-trailed. The fix loop bounds itself (`maxFixLoops`), widens seed sets after each fix, and re-runs performance gates.
- **Triage policy** (Director): data-level knobs → Programmer strategies within guardrails (e.g., ±8–15% tuning steps, coverage guarantees); crash/invariant/save-load classes → engine issues that honestly block release.
- **Honesty rules**: agents never fabricate results; simulated/heuristic nature is documented; engine defects surface as `engineIssues` instead of silent auto-"fixes".

## Build & reproducibility

`tools/build-game.ts` validates the pack, bundles with esbuild (deterministic flags), emits `dist/content.js` (embeddable pack), copies the shell page, and writes `build-info.json` with size+FNV fingerprints per file. The Release Manager verifies those fingerprints post-build; the pipeline rebuilds once after versioning so dist always matches the released pack id.

## Testing strategy

| Suite | What it pins |
|---|---|
| `tests/engine/rng.test.ts` | determinism, distributions, stream forking/state |
| `tests/engine/procgen.test.ts` | reachability across seeds×depths, spawn legality, determinism |
| `tests/engine/save.test.ts` | round-trip continuation equality, tamper/version/pack gates |
| `tests/engine/sim-smoke.test.ts` | bot-played invariants, cross-run divergence checks |
| `tests/studio/fixloop.test.ts` | triage routing + every auto-fix strategy |
| `tests/regression/*` | generated pins replaying historically failing seeds |

CI (GitHub Actions) runs typecheck → vitest → reproducible build → headless QA smoke against the shipped pack.

## Performance notes

Headless sim throughput ≈ 30–60k ticks/s on an 8-core M-series laptop; browser frame cost is dominated by canvas fill operations, mitigated by camera culling being unnecessary at our map sizes and by keeping FX allocations flat (object pools not yet needed — see ROADMAP).
