/** Inventory & equipment operations. Pure logic over SimState. */
import { INVENTORY_CAPACITY, MAX_RELIC_SLOTS } from "./state.js";
import type { ItemStack, SimState } from "./state.js";
import type { ContentPack, ItemDef, RelicEffect } from "../content/types.js";

export function itemDef(pack: ContentPack, itemId: string): ItemDef | undefined {
  return pack.items.find((i) => i.id === itemId);
}

/** Try to add items; returns quantity actually added (0 if full). */
export function addItem(state: SimState, itemId: string, qty = 1, stackable = true): number {
  let remaining = qty;
  if (stackable) {
    for (const slot of state.inventory) {
      if (slot.itemId === itemId && remaining > 0) {
        const merged = Math.min(remaining, 99 - slot.qty);
        slot.qty += merged;
        remaining -= merged;
      }
    }
  }
  while (remaining > 0 && state.inventory.length < INVENTORY_CAPACITY) {
    if (!stackable) {
      state.inventory.push({ itemId, qty: 1 });
      remaining -= 1;
    } else {
      const put = Math.min(remaining, 99);
      state.inventory.push({ itemId, qty: put });
      remaining -= put;
    }
  }
  return qty - remaining;
}

export function removeItem(state: SimState, itemId: string, qty = 1): boolean {
  let have = 0;
  for (const s of state.inventory) if (s.itemId === itemId) have += s.qty;
  if (have < qty) return false;
  let need = qty;
  for (let i = state.inventory.length - 1; i >= 0 && need > 0; i--) {
    const s = state.inventory[i]!;
    if (s.itemId !== itemId) continue;
    const take = Math.min(s.qty, need);
    s.qty -= take;
    need -= take;
    if (s.qty === 0) state.inventory.splice(i, 1);
  }
  return true;
}

export function countItem(state: SimState, itemId: string): number {
  let n = 0;
  for (const s of state.inventory) if (s.itemId === itemId) n += s.qty;
  return n;
}

/**
 * Equip an item from the bag. Previously equipped item returns to bag.
 * Returns true on success.
 */
export function equipItem(state: SimState, pack: ContentPack, itemId: string): boolean {
  const idx = state.inventory.findIndex((s) => s.itemId === itemId);
  if (idx === -1) return false;
  const def = itemDef(pack, itemId);
  if (!def) return false;

  if (def.kind === "weapon" || def.kind === "armor") {
    const slotKey = def.kind as "weapon" | "armor";
    const previous = state.equipment[slotKey];
    // Swap in place: keep bag slot occupied by equipment identity.
    state.inventory[idx]!.itemId = previous ?? "";
    state.inventory[idx]!.qty = previous ? 1 : 0;
    if (!previous) state.inventory.splice(idx, 1);
    state.equipment[slotKey] = itemId;
    return true;
  }

  if (def.kind === "relic") {
    if (state.equipment.relics.length >= MAX_RELIC_SLOTS) return false;
    removeItem(state, itemId, 1);
    state.equipment.relics.push(itemId);
    return true;
  }
  return false;
}

/** Aggregate relic effects currently equipped. */
export function relicEffects(state: SimState, pack: ContentPack): RelicEffect[] {
  const out: RelicEffect[] = [];
  for (const rid of state.equipment.relics) {
    const def = itemDef(pack, rid);
    if (def?.relicEffect) out.push(def.relicEffect);
  }
  return out;
}
