# Roadmap

Status labels: `[done]` shipped · `[next]` planned next · `[idea]` future direction.

## Gameplay depth
- [done] Three enemy behavior families with perception, memory, telegraphs
- [done] Quests (slay/collect/explore), economy, relics, key/boss gating
- [next] Elite/affix modifiers on deeper floors (fearful, shielded, hasty)
- [next] Second boss archetype rotation per run (bank already has two)
- [idea] Environmental hazards (ember vents, collapsing floors)
- [idea] Weapon move-sets (thrust vs swing arcs) tied to item tags

## Level variety
- [done] Seeded rooms/corridors, depth-scaled budgets and spawn tables
- [next] Biome themes per depth band (palette + tile decor variants)
- [next] Special rooms: treasure vaults, ambush halls, shrine chambers
- [idea] Locked side-wings with optional elite loot

## AI
- [done] LOS + hearing, alertness decay, investigate/chase/kite/charge
- [next] Pack coordination (simple blackboard: shared last-seen calls)
- [next] Enemy-vs-enemy faction friction (oozes vs imps rivalry)
- [idea] NPC schedules beyond wander (walk to shrine at low HP)

## QA & tooling
- [done] Bot suites, invariants, coverage gates, regression pins, verdicts
- [next] Property-based fuzzing of content packs (validator-driven generators)
- [next] Replay file format for human sessions + post-run analysis CLI
- [idea] Mutation testing over engine modules to score QA sensitivity

## Performance
- [done] Budget gates; headless throughput ~30–60k ticks/s
- [next] Spatial grid for separation when entity counts grow (~1k+)
- [next] Renderer culling + offscreen tile-layer caching
- [idea] Worker-threaded floor generation

## Studio
- [done] 11-agent pipeline, triage, guardrailed fixes, release gates
- [next] Multi-sprint memory: Director reads previous run reports to set new goals
- [next] LLM TextProvider behind the documented seam (opt-in, keyed via env)
- [idea] Agent "postmortems": structured self-critique artifacts per phase
