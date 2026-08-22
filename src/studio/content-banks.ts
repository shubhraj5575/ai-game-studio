/**
 * Content banks — curated word/phrase pools used by the Narrative Designer's
 * generative grammar. All text in the shipped game composes from these banks
 * deterministically per run seed (no LLM required; an LLM provider could
 * replace/augment these tables behind NarrativeDesignerAgent).
 */

export const WORLD_SEEDS = [
  { name: "Emberhold", premise: "Beneath the ruined citadel of {world}, an old furnace-god smolders. Descend its depths, cull what the dark breeds, and reach the Ashen Court." },
  { name: "Duskmire", premise: "The mire swallowed {world} centuries ago. Its flooded vaults still glow with stolen fire — and something tends it." },
  { name: "Cindervault", premise: "{world} was built to contain a spark that never cooled. The wardens are gone. The doors are open. The heat is patient." },
  { name: "Gloamreach", premise: "Below {world}, miners dug past the bottom of their maps and heard singing. Follow the tunnels down before the song finishes." },
];

export const FLOOR_ADJECTIVES = [
  "Ashen", "Smoldering", "Sunken", "Forgotten", "Blackened", "Silent", "Cracked",
  "Flooded", "Hollow", "Withered", "Sooty", "Pale", "Rootbound", "Echoing",
  "Rusted", "Molten", "Shivering", "Nameless", "Warded", "Broken",
];

export const FLOOR_NOUNS = [
  "Depths", "Halls", "Galleries", "Court", "Warrens", "Approach", "Stairs",
  "Vaults", "Passage", "Undercroft", "Kilns", "Cisterns", "Archives", "Foundry",
];

export interface EnemyBankEntry {
  id: string;
  name: string;
  shape: "blob" | "imp" | "brute" | "wraith";
  behavior: "melee" | "ranged" | "charger";
  tier: number; // suggested minimum depth band
  hue: number; // preferred hue range anchor 0-360
  lore: string;
}

export const ENEMY_BANK: EnemyBankEntry[] = [
  { id: "ooze", name: "Cinder Ooze", shape: "blob", behavior: "melee", tier: 1, hue: 95, lore: "Furnace slag that learned to hunger." },
  { id: "imp", name: "Ash Imp", shape: "imp", behavior: "ranged", tier: 1, hue: 18, lore: "It throws what the furnace coughs up." },
  { id: "skitter", name: "Vault Skitterer", shape: "blob", behavior: "melee", tier: 1, hue: 55, lore: "Quick, brittle, endlessly numerous." },
  { id: "spitter", name: "Soot Spitter", shape: "imp", behavior: "ranged", tier: 2, hue: 285, lore: "Its bile burns where it lands." },
  { id: "brute", name: "Gloom Brute", shape: "brute", behavior: "charger", tier: 2, hue: 260, lore: "Once a warden; the armor stayed after the man left." },
  { id: "wisp", name: "Gloom Wisp", shape: "wraith", behavior: "ranged", tier: 3, hue: 190, lore: "A cold light that resents your warmth." },
  { id: "hulk", name: "Kiln Hulk", shape: "brute", behavior: "charger", tier: 3, hue: 8, lore: "Fired hard, like pottery. Breaks the same way." },
  { id: "warden", name: "The Ashen Warden", shape: "wraith", behavior: "charger", tier: 99, hue: 38, lore: "Last of the vault guard. Still on duty." },
];

export const BOSS_BANK = [
  { id: "warden", name: "The Ashen Warden", shape: "wraith" as const, behavior: "charger" as const, hue: 38, lore: "The last sentry of the deep furnace." },
  { id: "hearthmother", name: "Hearth-Mother", shape: "brute" as const, behavior: "charger" as const, hue: 350, lore: "She kept the kilns fed. She is still hungry." },
];

export interface ItemBankEntry {
  id: string;
  name: string;
  kind: "weapon" | "armor" | "potion" | "relic";
  rarity: "common" | "uncommon" | "rare" | "epic";
  value: number;
  description: string;
}

export const ITEM_BANK: ItemBankEntry[] = [
  { id: "weapon-rusty-shortsword", name: "Rusty Shortsword", kind: "weapon", rarity: "common", value: 14, description: "Chipped but eager." },
  { id: "weapon-watch-blade", name: "Watch Blade", kind: "weapon", rarity: "uncommon", value: 46, description: "Standard issue for the deep watch." },
  { id: "weapon-ember-fang", name: "Ember Fang", kind: "weapon", rarity: "rare", value: 92, description: "Warm to the touch, warmer when swung." },
  { id: "weapon-furnace-maul", name: "Furnace Maul", kind: "weapon", rarity: "epic", value: 150, description: "Slow as a verdict, final as one." },
  { id: "armor-leather-jerkin", name: "Leather Jerkin", kind: "armor", rarity: "common", value: 20, description: "Better than nothing. Barely." },
  { id: "armor-watch-plate", name: "Watch Plate", kind: "armor", rarity: "uncommon", value: 58, description: "Heavy, reassuring." },
  { id: "armor-warden-shell", name: "Warden Shell", kind: "armor", rarity: "rare", value: 110, description: "Salvaged from something that used to wear it proudly." },
  { id: "potion-small", name: "Minor Ember Draught", kind: "potion", rarity: "common", value: 12, description: "Restores health with a pleasant warmth." },
  { id: "potion-large", name: "Greater Ember Draught", kind: "potion", rarity: "uncommon", value: 26, description: "Restores a lot of health, less politely." },
  { id: "relic-heart-of-ash", name: "Heart of Ash", kind: "relic", rarity: "epic", value: 130, description: "+max HP. It beats when you are quiet." },
  { id: "relic-hawkeye-charm", name: "Hawkeye Charm", kind: "relic", rarity: "rare", value: 95, description: "+critical chance. The dark has eyes; now so do you." },
  { id: "relic-swiftstep-sigil", name: "Swiftstep Sigil", kind: "relic", rarity: "uncommon", value: 70, description: "Move faster. Outpace your regrets." },
  { id: "relic-tollkeepers-mark", name: "Tollkeeper's Mark", kind: "relic", rarity: "uncommon", value: 65, description: "Gold comes easier. So does attention." },
  { id: "quest-ember-shard", name: "Ember Shard", kind: "relic", rarity: "rare", value: 30, description: "Still warm. Someone below wants these." },
];

export const ITEM_PREFIXES: Record<string, string[]> = {
  common: ["Worn", "Plain"],
  uncommon: ["Tempered", "Watch-issue"],
  rare: ["Runed", "Ember-touched"],
  epic: ["Furnace-bound", "Godspark"],
};

export const QUEST_TEMPLATES = [
  {
    id: "slay-plentiful",
    kind: "slay" as const,
    titles: ["Thin Their Numbers", "{count} Fewer Below", "Cull the {enemy}s"],
    targetCountMin: 3,
    targetCountMax: 5,
    rewardGoldMin: 18,
    rewardGoldMax: 36,
    rewardXpMin: 20,
    rewardXpMax: 40,
    offerTexts: [
      "They breed faster than we bury them. Thin their numbers.",
      "Every one you drop is a door we don't barricade.",
    ],
    completeTexts: [
      "The halls breathe easier. Take this.",
      "Well struck. The watch remembers.",
    ],
  },
  {
    id: "collect-potion-small",
    kind: "collect" as const,
    titles: ["Field Medicine ({count})", "Draughts for the Watch"],
    targetCountMin: 2,
    targetCountMax: 3,
    rewardGoldMin: 16,
    rewardGoldMax: 32,
    rewardXpMin: 16,
    rewardXpMax: 30,
    rewardItemId: "potion-large",
    offerTexts: [
      "My kit ran dry three landings ago. Secure what draughts you find.",
      "Bring in any ember draughts you can spare the trouble for.",
    ],
    completeTexts: [
      "You may have saved lives today. Mine included.",
      "That'll keep. Good hunting.",
    ],
  },
  {
    id: "explore-rooms",
    kind: "explore" as const,
    titles: ["Chart the {adj} Halls", "Walk the Dark ({count} Rooms)"],
    targetCountMin: 4,
    targetCountMax: 6,
    rewardGoldMin: 20,
    rewardGoldMax: 40,
    rewardXpMin: 22,
    rewardXpMax: 44,
    offerTexts: [
      "No map survives down here. Walk it yourself, then.",
      "We chart by candlelight and corpse-count. Add your share.",
    ],
    completeTexts: [
      "So that's the shape of the place. Grim comfort.",
      "Your steps count for something after all.",
    ],
  },
];

export const NPC_BANK = [
  {
    id: "elder-quartermaster",
    role: "questgiver" as const,
    firstNamePool: ["Rowan", "Edrik", "Maren", "Osric"],
    titlePool: ["Elder of the Last Watch", "Quartermaster Below", "Reader of Stairs"],
    idleLines: [
      "Keep your blade close and your lamp closer.",
      "The dark listens. Give it nothing.",
      "Deeper lies the heat. Deeper lies the why.",
      "Every ember you carry is somebody's unfinished prayer.",
    ],
    color: "#c9b98a",
  },
  {
    id: "peddler",
    role: "merchant" as const,
    firstNamePool: ["Marla", "Vess", "Hobb", "Isket"],
    titlePool: ["Peddler of the Depths", "Coincount", "The Reasonable Vulture"],
    idleLines: [
      "Fair prices, fair odds. Mostly fair.",
      "Coin first, heroics after.",
      "Everything down here is for sale except the way out.",
    ],
    color: "#7fc8a9",
  },
];

export const LORE_FRAGMENTS = [
  "The furnace was never meant to go cold.",
  "They sealed the stairs from below, not above.",
  "The wardens drew lots. The loser kept the last shift.",
  "What you hear dripping is not water.",
  "Maps lie at the fourth landing. Trust your feet instead.",
  "Some doors remember being opened and resent it.",
];

export const VICTORY_TEXTS = [
  "The furnace breathes again. Dawn finds you climbing, singed but grinning.",
  "The deep is quiet now — the good kind of quiet, for once.",
];

export const ELITE_AFFIXES = [
  { id: "furious", name: "Furious", hpMult: 1.0, dmgMult: 1.35, speedMult: 1.15, rewardMult: 1.6, color: "#ff5a5a" },
  { id: "shielded", name: "Shielded", hpMult: 1.6, dmgMult: 1.0, speedMult: 1.0, rewardMult: 1.5, color: "#7fa8ff" },
  { id: "hasty", name: "Hasty", hpMult: 1.1, dmgMult: 1.05, speedMult: 1.3, rewardMult: 1.5, color: "#7ec850" },
];
