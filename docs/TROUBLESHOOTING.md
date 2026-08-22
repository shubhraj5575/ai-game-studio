# Troubleshooting

## Studio pipeline

### `npm run studio` exits with code 2 and "gate.blocked"
The Director refused release. Read `studio-output/<run-id>/run-report.md`:
- **QA REJECT** — see the reasons list (blockers, coverage fraction, depth progress). Blockers marked `crash`/`invariant`/`save-load` are engine-suspects by policy; they are listed under "Engine-level issues" in the report and are *meant* to stop the line.
- **Perf REJECT** — budget table in `artifacts/performance/perf-report.json` shows which knob breached.

### Content pack invalid / build fails with a problem list
The Programmer self-heals common data slips; anything remaining is a real generator bug. The validator's message lists exact violations (`npm run build:game` prints them).

### Checksum mismatch during release
Something rewrote `dist/` between build and verification. Re-run `npm run studio` (the pipeline rebuilds after versioning).

## Game / client

### Page loads but shows "content.js missing"
You opened `dist/index.html` from an old or absent build. Run `npm run build:game`.

### No audio
Browsers require a user gesture before audio. Click anywhere once (the title screen click counts). Mute state persists per session via the pause menu.

### Save won't load ("Save was made for content vX")
Saves are pack-version gated on purpose. Start a new descent after regenerating content, or restore the matching `content/pack.json`.

## Tests

### A regression pin fails
A historically-fixed bug reappeared on that seed, or content changed in a way that recreates the condition. The failing issue title prints inside the assertion. Do not delete the pin — fix the cause.

### Flaky-looking perf numbers in CI
Tick-time budgets have generous headroom (avg ≤ 1.5 ms vs measured ~0.02–0.04 ms) precisely so shared runners don't flake. If you tighten them, keep ≥10x margin.

## Determinism debugging recipe

1. Get both runs' seeds + input scripts.
2. Step both sims in lockstep, hashing each tick (`stateHash`) until the first divergent tick.
3. Diff canonical JSON of that tick's states key-by-key (entities first).
4. Usual suspects: wall-clock reads, unseeded randomness, non-serialized state fields, float rounding on serialization.

This exact recipe found the save/load divergence documented in DECISIONS.md D6/D7 era bugs.
