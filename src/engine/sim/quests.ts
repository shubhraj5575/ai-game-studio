/** Quest instantiation from templates and progress tracking. */
import { Rng } from "../core/rng.js";
import type { ContentPack, QuestTemplate } from "../content/types.js";
import type { QuestInstance, SimState } from "./state.js";
import { countItem, removeItem } from "./inventory.js";
import { grantXp } from "./progression.js";
import type { Simulation } from "./simulation.js";

/** Instantiate quest instances for one floor's NPCs. */
export function createQuestsForFloor(
  sim: Simulation,
  npcEntityIds: Array<{ entityId: number; questIds: string[] }>,
  depth: number,
  seed: number,
): void {
  const rng = new Rng(seed);
  for (const { entityId, questIds } of npcEntityIds) {
    for (const templateId of questIds) {
      const tpl = sim.pack.questTemplates.find((q) => q.id === templateId);
      if (!tpl) continue;
      const instance = instantiateQuest(sim.state, sim.pack, tpl, rng, entityId, depth);
      if (instance) sim.state.quests.push(instance);
    }
  }
}

function instantiateQuest(
  state: SimState,
  pack: ContentPack,
  tpl: QuestTemplate,
  rng: Rng,
  giverId: number,
  depth: number,
): QuestInstance | null {
  const count = rng.intInclusive(tpl.targetCountMin, tpl.targetCountMax);

  let objectives: QuestInstance["objectives"];
  switch (tpl.kind) {
    case "slay": {
      // Target an enemy that actually spawns on this depth.
      const cfg = pack.floors.find((f) => f.depth === depth);
      if (!cfg || cfg.spawnTable.length === 0) return null;
      const target = rng.pick(cfg.spawnTable).enemyId;
      objectives = [{ kind: "slay", targetRef: target, needed: count, progress: 0 }];
      break;
    }
    case "collect": {
      const target = tpl.id.replace("collect-", "");
      objectives = [{ kind: "collect", targetRef: target, needed: count, progress: 0 }];
      break;
    }
    case "explore": {
      objectives = [{ kind: "explore", targetRef: "rooms", needed: Math.min(count, 6), progress: 0 }];
      break;
    }
    default:
      return null;
  }

  return {
    id: `${tpl.id}-d${depth}-n${giverId}`,
    templateId: tpl.id,
    title: rng.pick(tpl.titles).replace("{count}", String(count)),
    giverEntityId: giverId,
    depth,
    objectives,
    rewardGold: rng.intInclusive(tpl.rewardGoldMin, tpl.rewardGoldMax),
    rewardXp: rng.intInclusive(tpl.rewardXpMin, tpl.rewardXpMax),
    rewardItemId: tpl.rewardItemId,
    offerText: rng.pick(tpl.offerTexts),
    completeText: rng.pick(tpl.completeTexts),
    status: "offered",
  };
}

/** Called by the simulation whenever an enemy dies. */
export function onEnemyKilled(sim: Simulation, enemyDefId: string): void {
  for (const q of sim.state.quests) {
    if (q.status !== "active") continue;
    for (const o of q.objectives) {
      if (o.kind === "slay" && o.targetRef === enemyDefId && o.progress < o.needed) {
        o.progress++;
        checkReady(sim, q);
      }
    }
  }
}

/** Called when the player picks up items. */
export function onItemPickedUp(sim: Simulation, itemId: string): void {
  for (const q of sim.state.quests) {
    if (q.status !== "active") continue;
    for (const o of q.objectives) {
      if (o.kind === "collect" && o.targetRef === itemId) {
        // Progress reflects actual held quantity (handles drops/loss).
        o.progress = Math.min(o.needed, countItem(sim.state, itemId));
        checkReady(sim, q);
      }
    }
  }
}

/** Called on room entry. */
export function onRoomVisited(sim: Simulation, roomId: number): void {
  const visited = sim.state.visitedRoomIds;
  if (!visited.includes(roomId)) visited.push(roomId);
  for (const q of sim.state.quests) {
    if (q.status !== "active") continue;
    for (const o of q.objectives) {
      if (o.kind === "explore" && o.progress < o.needed) {
        o.progress = Math.min(o.needed, visited.length);
        checkReady(sim, q);
      }
    }
  }
}

function checkReady(sim: Simulation, q: QuestInstance): void {
  const done = q.objectives.every((o) => o.progress >= o.needed);
  if (done && q.status === "active") q.status = "readyTurnIn";
}

/**
 * Turn in a ready quest: consumes collect targets, grants rewards.
 * Returns null on failure, else a summary string.
 */
export function turnInQuest(sim: Simulation, questId: string): string | null {
  const state = sim.state;
  const q = state.quests.find((x) => x.id === questId && x.status === "readyTurnIn");
  if (!q) return null;

  // Consume collected items.
  for (const o of q.objectives) {
    if (o.kind === "collect") {
      if (!removeItem(state, o.targetRef, o.needed)) return null;
    }
  }

  state.gold += q.rewardGold;
  state.stats.goldEarned += q.rewardGold;
  grantXp(state, sim.pack, q.rewardXp);
  state.stats.questsCompleted++;
  if (q.rewardItemId) {
    const def = sim.pack.items.find((i) => i.id === q.rewardItemId);
    if (def) {
      // Rewards always fit: overflow converts to gold at item value.
      const added = sim.giveItem(q.rewardItemId, 1);
      if (added < 1) state.gold += def.value;
    }
  }
  q.status = "done";
  return `Quest complete: ${q.title} (+${q.rewardGold}g +${q.rewardXp}xp)`;
}
