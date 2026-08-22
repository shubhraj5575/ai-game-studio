# AI Game Studio

**A multi-agent autonomous game development studio that designs, builds, tests, and ships a genuinely playable game.**

The studio *is* the AI system: eleven agents collaborate through a real production pipeline — brief → design → implement → build → QA → fix loop → performance gates → release — and the output is **Ember Depths**, a top-down action roguelite you can play in your browser right now.

Every game shipped by the studio has been played end-to-end by its own QA agents (objective-seeking bots with hundreds of invariant checks per run) before the Director authorizes release.

---

## Play the game

```bash
npm install
npm run studio        # full autonomous pipeline → generates content, builds, QAs, releases
npm run dev           # serve dist/ at http://localhost:6336
```

Open **http://localhost:6336**, click *New Descent*.

| Input | Action |
|---|---|
| `WASD` / arrows | Move |
| Mouse | Aim · left-click attack |
| `Space` | Dodge roll (i-frames, costs stamina) |
| `E` | Talk / chests / shrine / descend portal |
| `Q` | Drink potion |
| `I` | Inventory & equipment |
| `Esc` | Pause / close panels |

**Goal:** descend 4 procedurally generated depths. Floors 2+ are key-locked; the final depth's portal opens only when its guardian dies. Quests from survivor NPCs pay gold and XP. Shrines heal once and autosave.

## What the studio does autonomously

```
Game Director ──► Design ──► Implementation ──► Build ──► QA ──┐
      ▲                                                       │
      │            ┌────────── REJECT ◄──────────────────────┘
      │            ▼
      ├──◄── TRIAGE ──► Programmer auto-fixes ──► rebuild ──► re-QA
      │            │
      │            └──► regression tests pinned forever
      ▼
   RELEASE  (only if QA + Performance + Director all say yes)
```

- **QA actually plays the game.** Deterministic bots drive the same input API as humans across multiple seeds; ~15 invariants run every 15 ticks; save/load determinism is verified mid-run; a suite can **REJECT** the build.
- **The fix loop is real.** QA findings route through Director triage into guardrailed data fixes (tuning, budgets, coverage guarantees), each recorded as an explicit change artifact. Engine-level defects honestly halt release for human engineers instead of being papered over.
- **Regressions stay fixed.** Failing scenarios become permanent executable test pins replaying that exact seed against the shipped content.

## The eleven agents

| Agent | Real work it performs |
|---|---|
| Game Director | Creative brief, design gate, issue triage, final release gate |
| Game Designer | Structured GDD: pillars, core loop, mechanics, progression model |
| Narrative Designer | World/floor/item/quest text via deterministic grammar over curated banks |
| Systems Designer | Tuning tables; XP-curve solver; time-to-killsweeps per depth |
| Level Designer | Floor configs proven by multi-seed generation sweeps; quality gates |
| Asset Manager | Palette harmony from seed; enemy colors validated for pairwise distance |
| Audio Manager | Audio theme, per-depth scale plan, SFX specs; validates cue coverage |
| Programmer | Content-pack integration, schema self-heal, bounded auto-fixes |
| QA Engineer | Test plans, bot suites, verdicts, regression pinning — can reject |
| Performance Engineer | Tick/gen/save/load/memory benchmarks vs budgets — can reject |
| Release Manager | Versioning, release notes, dist checksum verification |

Agents are deterministic expert systems (no hidden LLM calls). Every decision is logged and every output is an inspectable artifact under `studio-output/<run-id>/`.

## Repository layout

```
src/engine/     deterministic simulation core (no DOM): procgen, combat,
                AI (perception/memory/utility), quests, inventory, saves
src/client/     browser layer: canvas renderer, WebAudio synth, HUD/menus
src/qa/         bots, invariant checks, harness, suite verdicts
src/studio/     agent framework, 11 agents, orchestration pipeline
content/        GENERATED game content pack (pack.json)
dist/           GENERATED playable build (open via npm run dev)
tests/          unit · integration · property-style · regression pins
tools/          CLI entrypoints (studio, build, dev server, QA smoke)
docs/           ARCHITECTURE, GDD (generated), releases, decisions…
```

## Commands

```bash
npm run studio       # full pipeline (add -- --loops 4 --seeds 6)
npm run build:game   # reproducible bundle of engine+client+generated content
npm run dev          # local server for dist/
npm test             # vitest suites (unit/integration/regression/studio/client)
npm run qa           # headless QA against the shipped pack (CI gate)
npm run qa:wide      # 8-seed deep sweep
npm run bench        # performance benchmarks vs budgets
npx tsc --noEmit     # typecheck
```

## Reproducible player reports

Pause / death / victory screens include **Download Run Log** — a frame-by-frame
input recording of your session. Because the simulation is deterministic, any
run can be re-simulated bit-exactly:

```bash
npm run replay:verify -- ember-depths-run-12345.json
```

A `FAILED` verdict plus blocker list is a complete bug report; a hash match
proves the engine reproduces your session exactly.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how everything fits together
- [docs/GAME_DESIGN_DOCUMENT.md](docs/GAME_DESIGN_DOCUMENT.md) — generated by the Designer agent
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — workflows and conventions
- [DECISIONS.md](docs/DECISIONS.md) — engineering decision record
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- [ROADMAP.md](docs/ROADMAP.md)
- [OVERNIGHT_LOG.md](OVERNIGHT_LOG.md) — chronological run history

## Status

Honest status labels live in [FINAL_REPORT.md](FINAL_REPORT.md). Summary: the studio pipeline runs end-to-end unattended; the game it currently ships is complete and winnable (verified by automated playthroughs), with known limitations documented rather than hidden.
