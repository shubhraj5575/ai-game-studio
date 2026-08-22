/**
 * DOM-based UI: HUD bars, quest journal, minimap, dialogue, shop, inventory,
 * and the title/pause/death/victory screens. The sim is driven only through
 * its public API — identical to what QA bots use.
 */
import { fmtTime } from "../engine/core/math.js";
import type { ContentPack } from "../engine/content/types.js";
import type { Simulation } from "../engine/sim/simulation.js";
import { computePlayerStats, xpToNext } from "../engine/sim/progression.js";
import { itemDef } from "../engine/sim/inventory.js";
import type { ItemDef } from "../engine/content/types.js";

export class UI {
  private pack: ContentPack;
  private els: Record<string, HTMLElement | null> = {};

  constructor(pack: ContentPack) {
    this.pack = pack;
    for (const id of [
      "hud", "hpFill", "hpLabel", "xpFill", "xpLabel", "stamFill",
      "statAtk", "statDef", "statGold", "statDepth",
      "quests", "questList", "minimapWrap", "minimap",
      "dialogue", "dlgSpeaker", "dlgLine", "dlgActions",
      "shopPanel", "shopTitle", "shopItems", "shopClose",
      "inventory", "equipRow", "invGrid",
      "titleScreen", "gameTitle", "gameTagline", "premiseText", "btnNewRun", "btnContinue", "btnHow", "seedInput", "continueInfo",
      "howScreen", "howBack",
      "pauseScreen", "btnResume", "btnSaveGame", "btnMute", "btnQuitToTitle", "saveStatus",
      "deathScreen", "deathCause", "deathStats", "btnDeathTitle",
      "victoryScreen", "victoryText", "victoryStats", "btnVictoryTitle",
      "floorBanner",
    ]) {
      this.els[id] = document.getElementById(id);
    }
  }

  show(id: string): void {
    this.els[id]?.classList.remove("hidden");
    if (id === "shopPanel") (this.els[id] as HTMLElement).style.display = "block";
    if (id === "inventory") (this.els[id] as HTMLElement).style.display = "block";
  }

  hide(id: string): void {
    this.els[id]?.classList.add("hidden");
    if (id === "shopPanel") (this.els[id] as HTMLElement).style.display = "none";
    if (id === "inventory") (this.els[id] as HTMLElement).style.display = "none";
  }

  isVisible(id: string): boolean {
    const el = this.els[id];
    if (!el) return false;
    if (id === "shopPanel" || id === "inventory") return el.style.display !== "none" && !el.classList.contains("hidden");
    return !el.classList.contains("hidden");
  }

  applyBranding(): void {
    const meta = this.pack.meta;
    if (this.els.gameTitle) this.els.gameTitle.textContent = meta.title.toUpperCase();
    if (this.els.gameTagline) this.els.gameTagline.textContent = meta.tagline;
    if (this.els.premiseText) this.els.premiseText.textContent = this.pack.narrative.premise;
    document.title = meta.title;
    if (this.els.victoryText) this.els.victoryText.textContent = this.pack.narrative.victoryText;
  }

  // ---------------------------------------------------------------------------

  updateHud(sim: Simulation): void {
    const s = sim.state;
    const p = s.entities.get(s.playerId);
    if (!p) return;
    const stats = computePlayerStats(s, this.pack);

    const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
    (this.els.hpFill as HTMLElement).style.width = `${hpPct}%`;
    if (this.els.hpLabel) this.els.hpLabel.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;

    const need = xpToNext(this.pack.systems.xpCurve, s.level);
    (this.els.xpFill as HTMLElement).style.width = `${Math.min(100, (s.xp / need) * 100)}%`;
    if (this.els.xpLabel) this.els.xpLabel.textContent = `LV ${s.level} · ${s.xp}/${need}`;

    const pt = p.playerTimers!;
    (this.els.stamFill as HTMLElement).style.width = `${(pt.stamina / this.pack.systems.player.staminaMax) * 100}%`;

    if (this.els.statAtk) this.els.statAtk.textContent = String(stats.damage);
    if (this.els.statDef) this.els.statDef.textContent = String(stats.defense);
    if (this.els.statGold) this.els.statGold.textContent = String(s.gold);
    if (this.els.statDepth) this.els.statDepth.textContent = `B${s.depth} · ${s.floorName}`;
  }

  updateQuests(sim: Simulation): void {
    const list = this.els.questList;
    if (!list) return;
    const active = sim.state.quests.filter((q) => q.status === "active" || q.status === "readyTurnIn");
    const parts: string[] = [];
    for (const q of active.slice(0, 5)) {
      const objs = q.objectives
        .map((o) => `${o.progress}/${o.needed}`)
        .join(" · ");
      const ready = q.status === "readyTurnIn";
      parts.push(
        `<div class="quest${q.status === "done" ? " done" : ""}">
          <div class="qtitle">${ready ? "✔ " : ""}${escapeHtml(q.title)}</div>
          <div class="qobj">${objs}${ready ? " — return!" : ""}</div>
        </div>`,
      );
    }
    list.innerHTML = parts.join("") || `<div style="color:var(--dim)">No active quests.</div>`;
  }

  renderMinimap(sim: Simulation): void {
    const canvas = this.els.minimap as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = sim.state;
    const scale = Math.min(canvas.width / s.map.width, canvas.height / s.map.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0e1119";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const r of s.map.rooms) {
      const visited = s.visitedRoomIds.includes(r.id);
      ctx.fillStyle = visited ? "rgba(90,208,255,0.25)" : "rgba(70,76,100,0.18)";
      ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      if (visited) {
        ctx.strokeStyle = "rgba(90,208,255,0.4)";
        ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      }
    }
    const p = s.entities.get(s.playerId);
    if (p) {
      ctx.fillStyle = "#ffb454";
      ctx.beginPath();
      ctx.arc(p.pos.x * scale, p.pos.y * scale, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const portal = [...s.entities.values()].find((e) => e.kind === "portal");
    if (portal && s.exitUnlocked) {
      ctx.fillStyle = "#7fd7ff";
      ctx.fillRect(portal.pos.x * scale - 2, portal.pos.y * scale - 2, 4, 4);
    }
  }

  showFloorBanner(text: string): void {
    const el = this.els.floorBanner;
    if (!el) return;
    el.textContent = text;
    el.style.opacity = "1";
    setTimeout(() => {
      el.style.opacity = "0";
    }, 2200);
  }

  // ---------------------------------------------------------------------------
  openDialogue(sim: Simulation, onAction: () => void): void {
    const d = sim.state.dialogue;
    if (!d) {
      this.hide("dialogue");
      return;
    }
    const npc = sim.state.entities.get(d.npcEntityId);
    const ndef = npc ? this.pack.npcDefs.find((n) => n.id === npc.npcDefId) : undefined;
    if (this.els.dlgSpeaker) {
      this.els.dlgSpeaker.textContent =
        (ndef ? `${ndef.firstNamePool[0]}, ${ndef.titlePool[0]}` : "Stranger");
    }
    if (this.els.dlgLine) this.els.dlgLine.textContent = d.line;

    const actions = this.els.dlgActions!;
    actions.innerHTML = "";
    let any = false;

    for (const qid of d.canTurnInQuestIds) {
      any = true;
      const btn = mkBtn(`Complete: ${questTitle(sim, qid)}`, "primary", () => {
        sim.turnInQuestById(qid);
        onAction();
      });
      actions.appendChild(btn);
    }
    for (const qid of d.canAcceptQuestIds) {
      any = true;
      const q = sim.state.quests.find((x) => x.id === qid);
      const btn = mkBtn(`Accept: ${q?.title ?? qid}`, "", () => {
        sim.acceptQuest(qid);
        onAction();
      });
      actions.appendChild(btn);
    }
    if (d.canShop) {
      any = true;
      const btn = mkBtn("Browse wares", "", () => {
        this.hide("dialogue");
        this.openShop(sim);
      });
      actions.appendChild(btn);
    }
    const bye = mkBtn("Farewell", "", () => {
      this.hide("dialogue");
    });
    actions.appendChild(bye);
    void any;
    this.show("dialogue");
  }

  closeDialogue(): void {
    this.hide("dialogue");
  }

  openShop(sim: Simulation): void {
    const d = sim.state.dialogue;
    if (!d) return;
    if (this.els.shopTitle) this.els.shopTitle.textContent = `Wares — you carry ${sim.state.gold}g`;
    const wrap = this.els.shopItems!;
    wrap.innerHTML = "";
    const stock = sim.shopStock(d.npcEntityId);
    if (stock.length === 0) {
      wrap.innerHTML = `<p style="color:var(--dim);font-size:12px">Sold out. The depths are hungry.</p>`;
    }
    for (const itemId of stock) {
      const def: ItemDef | undefined = itemDef(this.pack, itemId);
      if (!def) continue;
      const price = sim.priceOf(def.value);
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `
        <span class="name">${escapeHtml(def.name)} <span class="rarity-${def.rarity}">${def.rarity}</span></span>
        <span style="color:var(--gold,#ffd700)">${price}g</span>`;
      const btn = mkBtn("Buy", "", () => {
        const res = sim.buyItem(d.npcEntityId, itemId);
        if (res === "ok") this.openShop(sim); // refresh
        else if (res === "no-gold") flashPanel(this.els.shopPanel, "#ff5a5a");
        else if (res === "no-space") flashPanel(this.els.shopPanel, "#c2a23a");
      });
      row.appendChild(btn);
      wrap.appendChild(row);
    }
    this.show("shopPanel");
  }

  toggleInventory(sim: Simulation): void {
    if (this.isVisible("inventory")) {
      this.hide("inventory");
      return;
    }
    this.renderInventory(sim);
    this.show("inventory");
  }

  private renderInventory(sim: Simulation): void {
    const s = sim.state;
    const eqRow = this.els.equipRow!;
    const weapon = s.equipment.weapon ? itemDef(this.pack, s.equipment.weapon) : undefined;
    const armor = s.equipment.armor ? itemDef(this.pack, s.equipment.armor) : undefined;
    const relics = s.equipment.relics.map((r) => itemDef(this.pack, r)?.name ?? r);
    eqRow.innerHTML = `
      <div class="eq"><b>${weapon ? escapeHtml(weapon.name) : "— empty —"}</b>Weapon ${weapon ? `· ${weapon.power} atk` : ""}</div>
      <div class="eq"><b>${armor ? escapeHtml(armor.name) : "— empty —"}</b>Armor ${armor ? `· ${armor.defense} def` : ""}</div>
      <div class="eq"><b>${relics.length ? escapeHtml(relics.join(", ")) : "— none —"}</b>Relics (${relics.length}/2)</div>`;

    const grid = this.els.invGrid!;
    grid.innerHTML = "";
    const slots = s.inventory.length === 0 ? [] : s.inventory;
    for (let i = 0; i < Math.max(slots.length, 8); i++) {
      const slot = slots[i];
      const cell = document.createElement("div");
      cell.className = "inv-slot";
      if (!slot) {
        cell.innerHTML = `<span style="color:#333a4d">empty</span>`;
        grid.appendChild(cell);
        continue;
      }
      const def = itemDef(this.pack, slot.itemId);
      if (!def) continue;
      const equipped = s.equipment.weapon === def.id || s.equipment.armor === def.id || s.equipment.relics.includes(def.id);
      if (equipped) cell.classList.add("equipped");
      cell.innerHTML = `
        ${equipped ? `<span class="eqbadge">EQ</span>` : ""}
        <div class="iname">${escapeHtml(def.name)}${slot.qty > 1 ? ` ×${slot.qty}` : ""}</div>
        <div class="idesc">${escapeHtml(def.description)}</div>
        <div class="idesc" style="margin-top:3px;color:#5a637d">${def.kind}${equipped ? " · click to unequip" : " · click to use/equip"}</div>`;
      cell.addEventListener("click", () => {
        this.onItemClick(sim, def, equipped);
        this.renderInventory(sim);
      });
      grid.appendChild(cell);
    }
  }

  onItemClick: (sim: Simulation, def: ItemDef, equipped: boolean) => void = () => {};

  showDeath(cause: string, sim: Simulation): void {
    if (this.els.deathCause) this.els.deathCause.textContent = cause || "The depths keep what they take.";
    if (this.els.deathStats) this.els.deathStats.innerHTML = runStatsHtml(sim);
    this.show("deathScreen");
  }

  showVictory(sim: Simulation): void {
    if (this.els.victoryStats) this.els.victoryStats.innerHTML = runStatsHtml(sim);
    this.show("victoryScreen");
  }

  setContinueInfo(text: string): void {
    if (this.els.continueInfo) this.els.continueInfo.textContent = text;
    const btn = this.els.btnContinue as HTMLButtonElement | null;
    if (btn) btn.disabled = text.length === 0;
  }

  setSaveStatus(text: string): void {
    if (this.els.saveStatus) this.els.saveStatus.textContent = text;
  }

  seedInputValue(): string {
    return (this.els.seedInput as HTMLInputElement | null)?.value.trim() ?? "";
  }
}

function runStatsHtml(sim: Simulation): string {
  const s = sim.state;
  return `
    <div class="stat-line">Depth reached: <b>B${s.depth}</b> · ${escapeHtml(s.floorName)}</div>
    <div class="stat-line">Level <b>${s.level}</b> · Kills <b>${s.stats.totalKills}</b> · Quests <b>${s.stats.questsCompleted}</b></div>
    <div class="stat-line">Damage dealt <b>${s.stats.damageDealt}</b> · taken <b>${s.stats.damageTaken}</b></div>
    <div class="stat-line">Time <b>${fmtTime(s.timeSec)}</b> · Gold earned <b>${s.stats.goldEarned}</b></div>`;
}

function questTitle(sim: Simulation, questId: string): string {
  return sim.state.quests.find((q) => q.id === questId)?.title ?? questId;
}

function mkBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `btn ${cls}`.trim();
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] ?? c);
}

function flashPanel(el: HTMLElement | null, color: string): void {
  if (!el) return;
  el.style.transition = "border-color .1s";
  el.style.borderColor = color;
  setTimeout(() => {
    el.style.borderColor = "";
  }, 350);
}
