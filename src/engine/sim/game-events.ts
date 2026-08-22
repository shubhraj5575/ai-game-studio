/**
 * Gameplay event bus payload types.
 * The simulation emits these; renderer, audio, HUD, and QA subscribe.
 */
import { EventBus } from "../core/events.js";

export interface GameEvents {
  [key: string]: unknown;
  swing: { x: number; y: number; angle: number };
  hit: { x: number; y: number; amount: number; crit: boolean; targetId: number; killed: boolean };
  hurt: { amount: number; hpLeft: number };
  dodge: { x: number; y: number };
  kill: { enemyId: string; x: number; y: number };
  pickup: { itemId: string; name: string; quantity: number };
  gold: { amount: number };
  potionUsed: { hpAfter: number };
  levelUp: { level: number };
  questOffered: { questId: string; title: string };
  questAccepted: { questId: string; title: string };
  questCompleted: { questId: string; title: string };
  chestOpened: { lootNames: string[] };
  shrineUsed: { message: string };
  buy: { itemId: string; price: number };
  sellRejected: { reason: string };
  portalLocked: { reason: string };
  descend: { depth: number };
  death: { cause: string };
  victory: { timeSec: number };
  npcTalk: { line: string };
  keyFound: { name: string };
  eliteSeen: { affixId: string };
}

export const gameBus = new EventBus<GameEvents>();
