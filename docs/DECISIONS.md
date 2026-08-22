# Engineering Decision Record

Entries are appended in the order they became relevant. Each records the decision, the alternative rejected, and why.

## D1 — TypeScript everywhere; zero runtime dependencies
**Decision:** Single language (TS strict) for engine, client, studio, and tooling. Dev deps only (`typescript`, `esbuild`, `vitest`, `tsx`).
**Why:** One mental model across a multi-agent pipeline AND a browser game; installs stay fast/reproducible; no supply-chain surface in shipped artifacts. WebAudio + Canvas2D cover audio/graphics natively.

## D2 — Deterministic sim core as the product's spine
**Alternatives:** non-deterministic game with screenshot-based QA; LLM-judged playtesting.
**Why:** Determinism converts "QA" from vibes to verification: failing seeds replay bit-exactly, regressions pin permanently, save/load is provable via hashes. This single choice powers the whole bug-loop story.

## D3 — Agents are deterministic expert systems, not LLM calls
**Why:** No API keys are available in this environment; shipping untestable network paths would violate the honesty bar. The agents do real work (generation, validation, benchmarking) with inspectable heuristics. `src/studio/content-banks.ts` + `NarrativeDesignerAgent` mark the explicit seam where an LLM provider could later plug in.

## D4 — Pragmatic entity bags instead of full ECS
**Why:** <200 solids/floor; O(n²) separation with distance rejection measured cheaper than grid bookkeeping at this scale; serialization stays trivial. Revisit at ~1k entities (ROADMAP).

## D5 — Bots read state but never mutate it
**Why:** The client/bot contract must equal the human contract (`FrameInput` + action methods). Reading = looking at the screen; writing would make QA test a different game than the one humans play. Led directly to adding the aim channel to `FrameInput` when bots needed mouse-style aiming.

## D6 — Save format: JSON + sentinel-encoded infinities + FNV checksums
**War story:** `JSON.stringify(Infinity)` → `null`; restored entities expired instantly and deleted the player. Sentinels (`__INF__`) fixed it; checksum catches corruption/tampering; pack-version gate blocks incompatible loads.

## D7 — Collect quests count lifetime acquisitions + guaranteed deficit spawns
**Alternative:** require holding N items at turn-in.
**Why:** Players drink potions; punishing quest progress for healing is hostile design. Guaranteeing deficit spawns on accept makes completability structural (QA invariant enforces ground coverage), not probabilistic.

## D8 — Fix strategies are guardrailed data edits; engine bugs halt release
**Why:** Autonomous code-rewriting is high-risk theater. Data/tuning knobs have bounded blast radius and are fully recorded as before/after artifacts. Crash/invariant/save-load findings route to `engineIssues` and block the Director's gate — an honest stop for human engineers.

## D9 — Regression pins live next to unit tests as real vitest files
**Alternative:** a database of known-bad seeds checked by one generic test.
**Why:** Generated files are visible, reviewable, individually skippable, and run in normal CI without special machinery. They replay the exact seed against the *shipped* pack so content drift can't silently un-fix engine bugs.

## D10 — Canvas2D + DOM UI rather than WebGL/frameworks
**Why:** Scope discipline: the renderer is not the product, the studio is. Canvas2D handles our entity counts trivially; DOM panels give crisp text UI free. A WebGL swap can happen behind `Renderer` if ever needed.

## D11 — Procedural audio synthesized at runtime
**Why:** No binary assets → fully text-based reproducible builds; AudioTheme ships inside the content pack like everything else the agents author. Music is a seeded generative loop per floor scale.

## D12 — The studio writes repo docs itself where they describe generated content
GDD and release notes are artifacts of the run (regenerated each time). Human-authored docs (this file, ARCHITECTURE, README) describe stable systems. Mixing them up produces docs that lie.
