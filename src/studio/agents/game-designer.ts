/**
 * Game Designer — expands the Director's brief into a structured GDD.
 * Deterministic: parameter ranges derive from the brief's difficulty intent
 * and depth target; wording varies via the run RNG.
 */
import { Agent } from "../core/agent.js";
import type { GDD } from "../core/blackboard.js";
import { FLOOR_NOUNS } from "../content-banks.js";

const DIFFICULTY_PROFILES = {
  welcoming: { enemyBudgetBase: 4, enemyBudgetPerDepth: 1.2, hpMult: 0.9, dmgMult: 0.9, note: "forgiving early floors, gentle curves" },
  standard: { enemyBudgetBase: 5, enemyBudgetPerDepth: 1.6, hpMult: 1.0, dmgMult: 1.0, note: "steady escalation, meaningful resource pressure" },
  punishing: { enemyBudgetBase: 7, enemyBudgetPerDepth: 2.0, hpMult: 1.15, dmgMult: 1.1, note: "thin margins, deaths teach" },
} as const;

export class GameDesignerAgent extends Agent {
  readonly id = "designer";
  readonly title = "Game Designer";

  design(): GDD {
    const brief = this.ctx.board.brief;
    const rng = this.ctx.rng;
    const profile = DIFFICULTY_PROFILES[brief.difficultyIntent];

    const gdd: GDD = {
      title: this.titleFor(brief),
      logline:
        `A ${brief.genre} where you descend ${brief.targetDepthCount} procedurally generated depths, ` +
        `fighting ${brief.toneWords[0]} creatures, completing survivor quests, and carrying your ember to the bottom.`,
      pillars: brief.pillars.map((p) => ({
        name: p,
        description: PILLAR_DESCRIPTIONS[p] ?? "Supports the core descent fantasy.",
      })),
      coreLoop: [
        "Enter a generated floor; survey rooms, threats, and opportunities.",
        "Fight or avoid enemies to earn XP, gold, and drops.",
        "Accept and complete survivor quests for bonuses.",
        "Spend gold at the merchant; manage potions and gear.",
        "Find the key (and slay any guardian), then take the portal down.",
        "Repeat until the final floor's guardian falls.",
      ],
      mechanics: [
        { name: "Movement & dodge", summary: "Free top-down movement; dodge roll grants invulnerability frames at a stamina cost.", parameters: { dodgeSpeedMult: 3.0, dodgeDurationSec: 0.28, staminaCost: 28 } },
        { name: "Melee combat", summary: "Aimed arc swings with cooldowns, critical hits, knockback, and telegraphed enemy windups.", parameters: { attackRange: 1.55, attackArcDeg: 100, critChance: 0.06 } },
        { name: "Enemy behaviors", summary: "Three behavior families: melee chasers, ranged kiters, and chargers with committed lunges.", parameters: { families: 3 } },
        { name: "Perception & memory", summary: "Enemies see via line-of-sight cones and hear combat noise; they investigate last-known positions.", parameters: { perceptionPeriodSec: 0.15, loseInterestSec: 5 } },
        { name: "Quests", summary: "Procedurally parameterized slay/collect/explore quests from NPC survivors; collect targets are guaranteed obtainable.", parameters: { kindsCount: 3 } },
        { name: "Economy", summary: "Gold from kills, chests, and quests buys potions/gear/relics at variable prices.", parameters: { sellRatio: 0.4, priceVariancePct: 20 } },
        { name: "Progression", summary: "XP levels raise HP and damage; equipment and up to two relics customize builds per run.", parameters: { relicSlots: 2 } },
        { name: "Key & guardian gating", summary: "Deeper floors require a key; the final floor's portal opens only when its boss dies.", parameters: {} },
        { name: "Save shrines", summary: "One-shot full heal plus autosave per shrine; manual save available from pause menu.", parameters: {} },
      ],
      progression: {
        playerGrowth: `Levels every ~${profile.enemyBudgetPerDepth < 1.4 ? "floor and a half" : "floor"} mid-run; +HP/+damage per level; gear carries runs.`,
        difficultyArc: `${brief.targetDepthCount} depths; budget ${profile.enemyBudgetBase}+${profile.enemyBudgetPerDepth}/depth (${profile.note}).`,
        economyNotes: "Potions are the sink; relics are the splurge; selling keeps bad luck runs alive.",
      },
      winCondition: "Defeat the guardian of the final depth and take its portal.",
      loseCondition: "Health reaches zero. The run ends; saves persist only if made at shrines.",
      coverageGoals: [
        "combat exchanges in ≥90% of QA seeds",
        "quest accept + completion observed across suite",
        "shop purchase in ≥1 seed",
        "key retrieval on gated floors",
        "save/load determinism spot check each seed",
        "descend on every seeded run",
      ],
    };

    void rng;
    this.act("gdd.authored", `${gdd.mechanics.length} mechanics, ${gdd.pillars.length} pillars`);
    this.artifactJson("design/gdd.json", gdd);
    this.artifact("design/gdd.md", renderGddMarkdown(gdd));
    this.ctx.board.gdd = gdd;
    return gdd;
  }

  private titleFor(brief: { workingTitleSeedWord: string }): string {
    const noun = this.ctx.rng.pick(FLOOR_NOUNS);
    return `${brief.workingTitleSeedWord} ${noun}`;
  }
}

const PILLAR_DESCRIPTIONS: Record<string, string> = {
  "Readable combat": "Every threat telegraphs before it hurts you; damage always has an address.",
  "Meaningful choices": "Gold, potions, gear, relics, and quests trade off against risk every floor.",
  "Escalating descent": "Each depth is measurably more dangerous and measurably more rewarding.",
  "Fair randomness": "Procedural, yes — but reachability, quest items, and exits are guaranteed.",
};

/** Exported for the pipeline's full-document renderer. */
export function renderGddMarkdownForDoc(g: GDD): string {
  return renderGddMarkdown(g);
}

function renderGddMarkdown(g: GDD): string {
  const lines: string[] = [];
  lines.push(`# ${g.title} — Game Design Document`, "");
  lines.push(`> ${g.logline}`, "");
  lines.push("## Pillars", "");
  for (const p of g.pillars) lines.push(`- **${p.name}** — ${p.description}`);
  lines.push("", "## Core Loop", "");
  g.coreLoop.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", "## Mechanics", "");
  for (const m of g.mechanics) {
    lines.push(`### ${m.name}`, "", m.summary, "");
    const params = Object.entries(m.parameters);
    if (params.length > 0) {
      lines.push("| Parameter | Value |", "|---|---|");
      for (const [k, v] of params) lines.push(`| ${k} | ${v} |`);
      lines.push("");
    }
  }
  lines.push("## Progression", "", `- Player growth: ${g.progression.playerGrowth}`, `- Difficulty arc: ${g.progression.difficultyArc}`, `- Economy: ${g.progression.economyNotes}`);
  lines.push("", "## Win / Lose", "", `- **Win:** ${g.winCondition}`, `- **Lose:** ${g.loseCondition}`);
  lines.push("", "## QA Coverage Goals", "");
  for (const c of g.coverageGoals) lines.push(`- ${c}`);
  return lines.join("\n") + "\n";
}
