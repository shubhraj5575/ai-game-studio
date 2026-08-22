/**
 * Narrative Designer — generates all game text via deterministic composition
 * over curated banks: world premise, floor naming grammar, item names, quest
 * text, NPC identities and dialogue, lore fragments.
 *
 * Extension seam: an LLM TextProvider could rewrite/expand these tables per
 * run; without one, the procedural path below always applies (and is what
 * actually shipped — no untested code paths).
 */
import { Agent } from "../core/agent.js";
import type { ContentPack, NarrativeTables, FloorConfig } from "../../engine/content/types.js";
import {
  WORLD_SEEDS, FLOOR_ADJECTIVES, FLOOR_NOUNS, LORE_FRAGMENTS, VICTORY_TEXTS,
  ITEM_PREFIXES,
} from "../content-banks.js";

export class NarrativeDesignerAgent extends Agent {
readonly id = "narrative";
  readonly title = "Narrative Designer";
  /** Produces the narrative tables + injects names into floors. */
  write(brief: { toneWords: string[] }, floors: FloorConfig[]): NarrativeTables {
    const rng = this.ctx.rng;
    const world = rng.pick(WORLD_SEEDS);

    const tables: NarrativeTables = {
      worldName: world.name,
      premise: world.premise.replaceAll("{world}", world.name),
      floorAdjectives: rng.shuffle([...FLOOR_ADJECTIVES]),
      floorNouns: rng.shuffle([...FLOOR_NOUNS]),
      itemPrefixes: ITEM_PREFIXES,
      loreFragments: rng.shuffle([...LORE_FRAGMENTS]),
      victoryText: rng.pick(VICTORY_TEXTS),
      defeatText: pickDefeatText(rng.next()),
    };

    // Floor name grammars: "{adj} {noun}" with depth-flavored variety.
    for (const f of floors) {
      const noun = tables.floorNouns[f.depth % tables.floorNouns.length];
      f.floorNameTemplates = [
        `The {adj} ${noun}`,
        `${tables.floorAdjectives[(f.depth * 3) % tables.floorAdjectives.length]} ${noun}`,
        `The ${noun} of ${tables.worldName}`,
      ];
    }

    this.act("narrative.authored", `world=${tables.worldName}, ${floors.length} floor grammars`);
    this.artifactJson("narrative/narrative.json", tables);
    this.artifact(
      "narrative/lorebook.md",
      renderLorebook(tables, brief.toneWords),
    );
    return tables;
  }
}

function pickDefeatText(r: number): string {
  return r < 0.5
    ? "The depths keep what they take."
    : "Your ember joins the others down here. Someone will find it.";
}

function renderLorebook(t: NarrativeTables, toneWords: string[]): string {
  return [
    `# ${t.worldName} — Lorebook`,
    "",
    `**Tone:** ${toneWords.join(", ")}`,
    "",
    "## Premise",
    "",
    t.premise,
    "",
    "## Fragments found in the dark",
    "",
    ...t.loreFragments.map((f) => `- "${f}"`),
    "",
    "## Naming grammar",
    "",
    `- Floors: \`{adj} ${t.floorNouns[0]}\` / \`${t.floorAdjectives[0]} ${t.floorNouns[1]}\` …`,
    `- Items: ${Object.entries(t.itemPrefixes).map(([r, ps]) => `${r}: [${ps.join(", ")}]`).join(" · ")}`,
    "",
    "## Endings",
    "",
    `- **Victory:** ${t.victoryText}`,
    `- **Defeat:** ${t.defeatText}`,
    "",
  ].join("\n");
}
