// Item System Type Definitions
// Phase 10: Loot System Implementation

// =============================================================================
// Item Types
// =============================================================================

export type ItemType = 'consumable' | 'permanent_upgrade' | 'equipment';
export type ItemSubtype =
  | 'healing'
  | 'restore_resource'
  | 'curative'
  | 'damage_bonus'
  | 'accessory';
export type ItemRarity = 'common' | 'uncommon' | 'rare';
export type ItemTargetType = 'ally' | 'self';

// =============================================================================
// Item Effects
// =============================================================================

export type ItemEffectType =
  | 'heal'
  | 'restore_resource'
  | 'remove_condition'
  | 'permanent_stat'
  | 'first_attack_bonus'
  | 'first_heal_bonus'
  | 'first_save_bonus'
  | 'initiative_bonus'
  | 'first_kill_heal';

export interface ItemEffect {
  type: ItemEffectType;
  // For healing/restore effects
  amount?: string | number; // Dice notation (e.g. "2d4") or flat number
  // For condition removal
  condition?: string; // Specific condition or "any"
  // For stat bonuses
  stat?: string; // e.g. "attack", "resilience", "damageBonus"
}

// =============================================================================
// Item Data (from items.json)
// =============================================================================

export interface ItemData {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  subtype: ItemSubtype;
  effect: ItemEffect;
  range?: number; // For consumables that require targeting (1 = adjacent)
  targetType?: ItemTargetType;
  rarity: ItemRarity;
  lootWeight: number; // Weight in loot pool (higher = more common)
}

// =============================================================================
// Inventory State (for save data)
// =============================================================================

export interface ConsumableInventory {
  healing_potion: number;
  distilled_dendritium: number;
  antidote: number;
  celestial_tears: number;
}

export interface EquipmentInventory {
  // Items currently not equipped to any hero
  unequipped: string[];
  // All equipment items ever obtained (for duplicate prevention)
  obtained: string[];
}

export interface InventoryState {
  consumables: ConsumableInventory;
  equipment: EquipmentInventory;
  damageRunes: number; // Count of unassigned +1 Damage Runes
}

// =============================================================================
// Hero Equipment & Bonuses
// =============================================================================

export interface PermanentBonuses {
  damageBonus: number; // From +1 Damage Runes
}

// Tracks which equipment bonuses have been used this battle
export interface EquipmentBonusState {
  firstAttackUsed: boolean; // Ambusher's Ring
  firstHealUsed: boolean; // Healer's Pendant
  firstSaveUsed: boolean; // Wardstone
  firstKillUsed: boolean; // Bloodstone
  // Swift Anklet doesn't need tracking - always applies to initiative
}

// =============================================================================
// Chest State (for save data)
// =============================================================================

export interface ChestState {
  opened: boolean;
  contents: string | null; // Item ID or null if not yet generated
}

export interface ChestPlacement {
  id: string;
  x: number;
  y: number;
}

// =============================================================================
// Loot Generation
// =============================================================================

export interface LootPoolEntry {
  itemId: string;
  weight: number;
}

export interface LootResult {
  itemId: string;
  item: ItemData;
}

// =============================================================================
// Default Values
// =============================================================================

export function createDefaultInventory(): InventoryState {
  return {
    consumables: {
      healing_potion: 0,
      distilled_dendritium: 0,
      antidote: 0,
      celestial_tears: 0,
    },
    equipment: {
      unequipped: [],
      obtained: [],
    },
    damageRunes: 0,
  };
}

export function createDefaultPermanentBonuses(): PermanentBonuses {
  return {
    damageBonus: 0,
  };
}

export function createDefaultEquipmentBonusState(): EquipmentBonusState {
  return {
    firstAttackUsed: false,
    firstHealUsed: false,
    firstSaveUsed: false,
    firstKillUsed: false,
  };
}

// =============================================================================
// Equipment IDs (for type safety)
// =============================================================================

export const EQUIPMENT_IDS = [
  'ambushers_ring',
  'healers_pendant',
  'wardstone',
  'swift_anklet',
  'bloodstone',
] as const;

export type EquipmentId = (typeof EQUIPMENT_IDS)[number];

export const CONSUMABLE_IDS = [
  'healing_potion',
  'distilled_dendritium',
  'antidote',
  'celestial_tears',
] as const;

export type ConsumableId = (typeof CONSUMABLE_IDS)[number];
