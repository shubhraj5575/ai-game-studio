# Security Review

Scope: this repository ships a browser game plus a local Node pipeline. There is no server, no multi-tenancy, and no secrets at rest. The review below covers the attack surfaces that do exist, what was found, and what was changed.

## Threat model

| Surface | Actor | Risk |
|---|---|---|
| `content/pack.json` (generated or hand-edited) | Anyone who can edit repo files | Malicious text reaches DOM; absurd numbers hang the engine |
| Save strings (localStorage / file) | The player themselves | Corruption, tampering for god-mode |
| Studio CLI flags | Local developer | Path/loop injection via bad numerics |
| `tools/dev-server.ts` | Local network peer | Path traversal reads outside `dist/` |
| Pipeline subprocess calls | — | Command injection via interpolated args |

## Findings & resolutions

### F1 — DOM injection from content-controlled text (fixed)
Item names, quest titles, NPC lines, floor names, and rarities all originate in the content pack. Most were HTML-escaped before `innerHTML`, but run-summary stat lines embedded `floorName` raw, and shop rarity labels were interpolated unescaped.
**Resolution:** every pack-sourced string that reaches `innerHTML` is escaped (`escapeHtml`), including rarities; dialogue and death-cause paths use `textContent` by construction.

### F2 — Engine hangs from pathological numbers (fixed)
`hp = 1e300`, non-finite speeds, etc., would pass the old truthiness checks and could produce NaN propagation or effectively infinite loops downstream.
**Resolution:** validator now enforces finiteness and magnitude bounds on enemy stats, player tuning fields, elite affix ranges `[1,3]`, and map sizes; bounds are documented inline.

### F3 — CLI numeric parsing (fixed)
`--seeds abc` produced `NaN` seeds flowing into suite runs and regression file paths.
**Resolution:** strict integer parsing with clamps; file-path components derived from validated integers only.

### F4 — Dev-server traversal (verified safe)
`join(distDir, rel)` collapses `..` segments, and the result is checked with `startsWith(distDir)`; traversal requests 403.

### F5 — Subprocess execution (verified safe)
Pipeline invokes `npx tsx tools/build-game.ts` with fixed argv and explicit cwd — no string interpolation of external input.

## Accepted limitations (documented, not hidden)

- **Save checksums are FNV-based, not cryptographic.** Saves detect corruption and casual tampering but a determined player can re-sign their own edits. For a single-player roguelite this is the correct trade-off; online leaderboards would need HMAC.
- **localStorage saves are origin-scoped** and readable by any script on that origin — standard browser constraint; we never store anything sensitive there.
- **The studio's auto-fix loop mutates only generated data files**, never source code; worst case is a worse-balanced game, not a compromised machine.
