/**
 * Programmer — the integrator and the fix-loop executor.
 *
 * Responsibilities (all real, all bounded — no engine self-rewrite):
 *   1. Assemble the full ContentPack from every agent's artifact.
 *   2. Schema-validate it; fix violations in data before shipping.
 *   3. Apply Director-triaged auto-fix strategies for QA findings that are
 *      data/tuning-level, each recorded as an explicit change record.
 *   4. Write content/pack.json + GAME_DESIGN_DOCUMENT.md for the repo.
 *
 * Engine-code defects are explicitly OUT of scope for autonomous fixing;
 * they are escalated as issues for human engineers (honest limitation).
 */
import { Agent } from "../core/agent.js";
import type { ContentPack } from "../../engine/content/types.js";
import { validateContentPack } from "../../engine/content/types.js";
import type { BugIssue } from "../../qa/issues.js";
import type { FixRecord } from "../core/blackboard.js";
import { studioBus } from "../core/studio-events.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export class ProgrammerAgent extends Agent {
readonly id = "programmer";
  readonly title = "Programmer";
  /** Assemble + validate; returns a schema-clean pack or throws. */
  integrate(parts: Omit<ContentPack, "meta"> & { meta: ContentPack["meta"] }): ContentPack {
    let pack: ContentPack = structuredClone(parts);

    // Self-heal common data slips BEFORE validation so builds never ship broken.
    this.healLootTables(pack);
    this.healSpawnTables(pack);
    this.healFloors(pack);

    const problems = validateContentPack(pack);
    if (problems.length > 0) {
      // Second pass: drop offending entries rather than ship invalid data.
      this.act("integrate.repair", `${problems.length} problem(s) after heal`);
      this.dropInvalidReferences(pack);
      const remaining = validateContentPack(pack);
      if (remaining.length > 0) {
        throw new Error(`Programmer cannot produce valid content: ${remaining.join(" | ")}`);
      }
    }

    this.act("pack.integrated", `v${pack.meta.version} enemies=${pack.enemies.length} items=${pack.items.length} floors=${pack.floors.length}`);
    this.artifactJson("implement/content-pack.json", pack);
    this.ctx.board.pack = pack;
    return pack;
  }

  private healLootTables(pack: ContentPack): void {
    const ids = new Set(pack.items.map((i) => i.id));
    for (const lt of pack.lootTables) {
      lt.entries = lt.entries.filter((e) => {
        if (!ids.has(e.itemId)) {
          this.log.warn(`dropping loot entry ${e.itemId} (no such item)`);
          return false;
        }
        return true;
      });
      if (lt.entries.reduce((s, e) => s + e.weight, 0) <= 0 && lt.entries.length > 0) {
        lt.entries[0]!.weight = 1;
      }
    }
  }

  private healSpawnTables(pack: ContentPack): void {
    const ids = new Set(pack.enemies.map((e) => e.id));
    for (const f of pack.floors) {
      f.spawnTable = f.spawnTable.filter((s) => {
        if (!ids.has(s.enemyId)) {
          this.log.warn(`floor ${f.depth}: dropping spawn ${s.enemyId}`);
          return false;
        }
        return true;
      });
      if (f.spawnTable.length === 0) {
        const usable = pack.enemies.filter((e) => e.minDepth <= f.depth && e.minDepth < 90);
        if (usable.length === 0) throw new Error(`floor ${f.depth}: no valid enemies at any depth`);
        const pick = usable[usable.length - 1]!;
        f.spawnTable.push({ enemyId: pick.id, weight: 50 });
      }
    }
  }

  private healFloors(pack: ContentPack): void {
    pack.floors.sort((a, b) => a.depth - b.depth);
    pack.floors.forEach((f, i) => {
      f.depth = i + 1;
      f.mapWidth = Math.max(24, f.mapWidth | 0);
      f.mapHeight = Math.max(24, f.mapHeight | 0);
      f.roomTargetMax = Math.max(f.roomTargetMin, f.roomTargetMax);
      f.enemyBudgetBase = Math.max(1, f.enemyBudgetBase);
      f.enemyBudgetPerDepth = Math.max(0, f.enemyBudgetPerDepth);
    });
  }

  private dropInvalidReferences(pack: ContentPack): void {
    const itemIds = new Set(pack.items.map((i) => i.id));
    for (const q of pack.questTemplates) {
      if (q.rewardItemId && !itemIds.has(q.rewardItemId)) delete q.rewardItemId;
    }
  }

  // ---------------------------------------------------------------------------
  // Fix loop strategies
  // ---------------------------------------------------------------------------

  /**
   * Attempt auto-fixes for triaged issues. Returns applied strategy names.
   * Only DATA-level knobs are touched, within guardrails.
   */
  applyFixes(pack: ContentPack, issues: BugIssue[], iteration: number): string[] {
    const applied: string[] = [];

    for (const issue of issues) {
      if (this.ctx.board.fixedIssueIds.has(issue.id)) continue;

      switch (issue.kind) {
        case "performance": {
          if (issue.title.includes("tick")) {
            const before = pack.floors.map((f) => f.mapWidth);
            for (const f of pack.floors) {
              f.mapWidth = Math.max(36, Math.round(f.mapWidth * 0.92));
              f.mapHeight = Math.max(36, Math.round(f.mapHeight * 0.92));
            }
            applied.push("perf.shrinkMaps");
            this.ctx.board.fixedIssueIds.add(issue.id);
            this.recordFix(iteration, "perf.shrinkMaps", "floors[].mapWidth/Height", before, pack.floors.map((f) => f.mapWidth), issue.title);
          }
          break;
        }
        case "progression-blocker": {
          if (issue.title.includes("depth progress") || issue.detail.includes("balance")) {
            applied.push(...this.easeDifficulty(pack, issue, iteration));
          }
          break;
        }
        case "stuck":
        case "invariant": {
          // Geometry/invariant bugs are engine-suspect unless clearly procgen:
          if (issue.title.includes("unreachable") || issue.title.includes("Key")) {
            for (const f of pack.floors) {
              f.roomTargetMin = Math.max(3, f.roomTargetMin - 1);
              f.roomTargetMax = Math.max(f.roomTargetMin + 1, f.roomTargetMax - 1);
            }
            applied.push("procgen.simplifyRooms");
            this.ctx.board.fixedIssueIds.add(issue.id);
            this.recordFix(iteration, "procgen.simplifyRooms", "floors[].roomTargets", "dense", "simpler", issue.title);
          } else {
            this.routeToEngine(issue);
          }
          break;
        }
        case "crash": {
          this.routeToEngine(issue);
          break;
        }
        case "save-load": {
          this.routeToEngine(issue);
          break;
        }
        case "balance": {
          applied.push(...this.easeDifficulty(pack, issue, iteration));
          break;
        }
        case "qa-coverage": {
          if (issue.title.includes("shopUsed")) {
            // Guarantee a merchant on floor 1; the sim's shop-stock roller
            // always includes the cheapest potion, so coverage follows.
            const f1 = pack.floors[0];
            const merchantId = pack.npcDefs.find((n) => n.role === "merchant")?.id;
            const before = f1 ? f1.npcIds.join(",") : "";
            if (f1 && merchantId && !f1.npcIds.includes(merchantId)) {
              f1.npcIds.push(merchantId);
            }
            applied.push("coverage.merchantGuarantee");
            this.recordFix(iteration, "coverage.merchantGuarantee", "floors[0].npcIds", before, f1?.npcIds.join(",") ?? "", issue.title);
          } else if (issue.title.includes("shrineUsed")) {
            const before = pack.floors.map((f) => f.hasShrine);
            for (const f of pack.floors) f.hasShrine = true;
            applied.push("coverage.shrinesEverywhere");
            this.recordFix(iteration, "coverage.shrinesEverywhere", "floors[].hasShrine", before, pack.floors.map((f) => f.hasShrine), issue.title);
          } else {
            this.routeToEngine(issue);
          }
          break;
        }
        default:
          this.routeToEngine(issue);
      }
    }

    if (applied.length > 0) {
      pack.meta.patch = (pack.meta.patch ?? 0) + 1;
      this.act("fixes.applied", applied.join(", "));
      this.artifactJson(`fixes/iteration-${iteration}.json`, this.ctx.board.fixes.filter((f) => f.iteration === iteration));
    }
    return applied;
  }

  private easeDifficulty(pack: ContentPack, issue: BugIssue, _iteration: number): string[] {
    const applied: string[] = [];
    // Guardrailed easing: -12% spawn budget growth, +8% player hp floor.
    const before = pack.systems.player.baseMaxHp;
    pack.systems.player.baseMaxHp = Math.round(before * 1.08);
    for (const f of pack.floors) {
      f.enemyBudgetPerDepth = Math.round(f.enemyBudgetPerDepth * 0.88 * 100) / 100;
    }
    this.ctx.board.fixedIssueIds.add(issue.id);
    this.recordFix(_iteration, "balance.ease", "player.baseMaxHp + floors[].enemyBudgetPerDepth", before, pack.systems.player.baseMaxHp, issue.title);
    applied.push("balance.ease");
    return applied;
  }

  private recordFix(
    iteration: number, strategy: string, target: string,
    before: unknown, after: unknown, rationale: string,
  ): void {
    this.ctx.board.fixes.push({
      iteration,
      strategy,
      target,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      rationale,
      appliedBy: this.id,
      atIso: new Date().toISOString(),
    });
    studioBus.emit("fixApplied", { agent: this.id, strategy, detail: rationale });
  }

  private routeToEngine(issue: BugIssue): void {
    if (!this.ctx.board.engineIssues.some((i) => i.id === issue.id)) {
      this.ctx.board.engineIssues.push(issue);
      this.log.warn(`routed to engine team (cannot auto-fix): ${issue.title}`, { id: issue.id });
    }
    this.ctx.board.fixedIssueIds.add(issue.id); // handled = routed
  }

  // ---------------------------------------------------------------------------
  // Repo outputs
  // ---------------------------------------------------------------------------

  writeRepoOutputs(rootDir: string, gddMarkdown: string): void {
    const pack = this.ctx.board.pack;
    if (!pack) throw new Error("no pack to write");

    mkdirSync(join(rootDir, "content"), { recursive: true });
    writeFileSync(join(rootDir, "content", "pack.json"), JSON.stringify(pack, null, 2) + "\n");

    const docPath = join(rootDir, "docs", "GAME_DESIGN_DOCUMENT.md");
    writeFileSync(docPath, gddMarkdown);
    this.act("repo.outputsWritten", "content/pack.json + docs/GAME_DESIGN_DOCUMENT.md");
  }
}
