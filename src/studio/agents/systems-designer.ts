/**
 * Systems Designer — turns design intent into numbers, then PROVES the
 * numbers with simulation sweeps:
 *   1. Derive player/enemy/economy tuning from the GDD difficulty profile.
 *   2. Solve the XP curve so expected kill totals land the player at the
 *      intended level band by the final depth (numeric root-find on growth).
 *   3. Verify time-to-kill / time-to-be-killed ratios sit in target windows
 *      per depth band; adjust depth scaling if out of window.
 */
import { Agent } from "../core/agent.js";
import type { ContentPack, SystemsTuning } from "../../engine/content/types.js";

const INTENT = {
  welcoming: { baseMaxHp: 40, hpScale: 0.13, dmgScale: 0.10, ttkTarget: [1.9, 2.6] },
  standard: { baseMaxHp: 32, hpScale: 0.16, dmgScale: 0.12, ttkTarget: [1.5, 2.1] },
  punishing: { baseMaxHp: 27, hpScale: 0.19, dmgScale: 0.15, ttkTarget: [1.2, 1.7] },
} as const;

export class SystemsDesignerAgent extends Agent {
readonly id = "systems";
  readonly title = "Systems Designer";
  derive(depthCount: number, difficultyIntent: keyof typeof INTENT): SystemsTuning {
    const p = INTENT[difficultyIntent];

    const tuning: SystemsTuning = {
      player: {
        baseSpeed: 4.4,
        baseMaxHp: p.baseMaxHp,
        baseDamage: 6,
        baseDefense: 0,
        attackRange: 1.55,
        attackArcDeg: 100,
        attackCooldownSec: 0.42,
        dodgeSpeedMult: 3.1,
        dodgeDurationSec: 0.28,
        dodgeCooldownSec: 0.45,
        staminaMax: 100,
        staminaRegenPerSec: 34,
        dodgeStaminaCost: 28,
        iframesAfterHitSec: 0.55,
        pickupRadius: 0.8,
        interactRadius: 1.15,
        critChance: 0.06,
        critMultiplier: 1.9,
        knockbackForce: 7,
        damageVariancePct: 12,
        hpPerLevel: 5,
        damagePerLevel: 1.5,
      },
      xpCurve: { base: 22, growth: this.solveXpGrowth(22, depthCount) },
      startingGold: 25,
      potionPrice: 10,
      priceVariancePct: 20,
      depthHpScale: p.hpScale,
      depthDamageScale: p.dmgScale,
    };

    // TTK sanity sweep across depths using mid-tier enemy assumptions.
    const sweep = this.ttkSweep(tuning, depthCount);
    if (sweep.finalRatio < p.ttkTarget[0]) {
      tuning.depthHpScale *= 0.85;
      this.act("systems.adjusted", `final TTK ratio ${sweep.finalRatio.toFixed(2)} low → hp scale → ${tuning.depthHpScale.toFixed(3)}`);
    } else if (sweep.finalRatio > p.ttkTarget[1]) {
      tuning.depthHpScale *= 1.15;
      this.act("systems.adjusted", `final TTK ratio ${sweep.finalRatio.toFixed(2)} high → hp scale → ${tuning.depthHpScale.toFixed(3)}`);
    }

    this.act("systems.authored", `xpCurve growth=${tuning.xpCurve.growth.toFixed(3)}, hpScale=${tuning.depthHpScale}`);
    this.artifactJson("systems/tuning.json", {
      tuning,
      sweeps: { ttkByDepth: sweep.byDepth, finalRatio: sweep.finalRatio },
    });
    return tuning;
  }

  /**
   * Expected total XP by final depth ≈ killsPerDepth × avgXp × depthCount.
   * Find growth g so that reaching level ≈ depthCount + 3 consumes it.
   */
  private solveXpGrowth(base: number, depthCount: number): number {
    const killsPerDepth = 14;
    const avgXp = 10;
    const totalXp = killsPerDepth * avgXp * depthCount;
    const targetLevel = depthCount + 3;

    const xpToNext = (lvl: number, g: number): number => Math.round(base * Math.pow(lvl, g));
    const totalToLevel = (g: number): number => {
      let sum = 0;
      for (let lvl = 1; lvl < targetLevel; lvl++) sum += xpToNext(lvl, g);
      return sum;
    };

    let lo = 1.05;
    let hi = 1.8;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (totalToLevel(mid) < totalXp) lo = mid;
      else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 1000) / 1000;
  }

  /** Rough combat math sweep: player DPS vs effective enemy EHP per depth. */
  private ttkSweep(tuning: SystemsTuning, depthCount: number): { byDepth: Array<{ depth: number; ratio: number }>; finalRatio: number } {
    const byDepth: Array<{ depth: number; ratio: number }> = [];
    const enemyBaseHp = 11;
    const enemyBaseDmg = 4;
    const enemyAttackSec = 1.2;
    const playerAttackSec = 0.46 + 0.06; // swing cadence incl. travel

    for (let d = 1; d <= depthCount; d++) {
      const hpMult = 1 + tuning.depthHpScale * (d - 1);
      const dmgMult = 1 + tuning.depthDamageScale * (d - 1);
      const levelBonusDmg = (Math.max(0, d - 1)) * tuning.player.damagePerLevel * 0.6;
      const playerDps = (tuning.player.baseDamage + levelBonusDmg + 3) / playerAttackSec; // +3 avg early weapon
      const ehp = enemyBaseHp * hpMult;
      const edps = enemyBaseDmg * dmgMult / enemyAttackSec;
      const ttkPlayerToEnemy = ehp / playerDps;
      const ttkEnemyToPlayer = (tuning.player.baseMaxHp + (d - 1) * tuning.player.hpPerLevel) / Math.max(edps, 0.01);
      byDepth.push({ depth: d, ratio: ttkEnemyToPlayer / ttkPlayerToEnemy });
    }
    return { byDepth, finalRatio: byDepth[byDepth.length - 1]?.ratio ?? 1 };
  }
}
