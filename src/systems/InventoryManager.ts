// InventoryManager - handles item storage and usage

import {
  ItemData,
  InventoryState,
  ConsumableId,
  EquipmentId,
  CONSUMABLE_IDS,
  EQUIPMENT_IDS,
  createDefaultInventory,
} from '../data/ItemTypes';
import { HeroState } from './SaveManager';

// Static item data loaded from JSON
let itemsData: Record<string, ItemData> | null = null;

export class InventoryManager {
  private inventory: InventoryState;
  private heroState: Record<string, HeroState>;

  constructor(
    inventory?: InventoryState,
    heroState?: Record<string, HeroState>
  ) {
    this.inventory = inventory ?? createDefaultInventory();
    this.heroState = heroState ?? {};
  }

  // ==========================================================================
  // Static Data Loading
  // ==========================================================================

  /**
   * Load item definitions from JSON (call once at game start)
   */
  static async loadItemsData(): Promise<void> {
    if (itemsData) return; // Already loaded

    try {
      const response = await fetch('/data/items.json');
      itemsData = await response.json();
      console.log('Items data loaded:', Object.keys(itemsData!).length, 'items');
    } catch (error) {
      console.error('Failed to load items data:', error);
      itemsData = {};
    }
  }

  /**
   * Set item definitions from Phaser's cache (alternative to loadItemsData)
   */
  static setItemsData(data: Record<string, ItemData>): void {
    if (itemsData) return; // Already loaded
    itemsData = data;
    console.log('Items data set from cache:', Object.keys(itemsData).length, 'items');
  }

  /**
   * Get item data by ID
   */
  static getItem(itemId: string): ItemData | null {
    if (!itemsData) {
      console.warn('Items data not loaded yet');
      return null;
    }
    return itemsData[itemId] ?? null;
  }

  /**
   * Get all items of a specific type
   */
  static getItemsByType(type: 'consumable' | 'equipment' | 'permanent_upgrade'): ItemData[] {
    if (!itemsData) return [];
    return Object.values(itemsData).filter(item => item.type === type);
  }

  /**
   * Check if items data is loaded
   */
  static isLoaded(): boolean {
    return itemsData !== null;
  }

  // ==========================================================================
  // Consumable Management
  // ==========================================================================

  /**
   * Add consumable items to inventory
   */
  addConsumable(itemId: ConsumableId, quantity: number = 1): void {
    if (!CONSUMABLE_IDS.includes(itemId as ConsumableId)) {
      console.warn(`Invalid consumable ID: ${itemId}`);
      return;
    }
    this.inventory.consumables[itemId] += quantity;
  }

  /**
   * Remove consumable from inventory (returns false if not enough)
   */
  removeConsumable(itemId: ConsumableId, quantity: number = 1): boolean {
    if (!CONSUMABLE_IDS.includes(itemId as ConsumableId)) {
      console.warn(`Invalid consumable ID: ${itemId}`);
      return false;
    }

    if (this.inventory.consumables[itemId] < quantity) {
      return false;
    }

    this.inventory.consumables[itemId] -= quantity;
    return true;
  }

  /**
   * Get count of a specific consumable
   */
  getConsumableCount(itemId: ConsumableId): number {
    return this.inventory.consumables[itemId] ?? 0;
  }

  /**
   * Get all consumables with count > 0
   */
  getAvailableConsumables(): { itemId: ConsumableId; count: number; item: ItemData }[] {
    const available: { itemId: ConsumableId; count: number; item: ItemData }[] = [];

    for (const itemId of CONSUMABLE_IDS) {
      const count = this.inventory.consumables[itemId];
      if (count > 0) {
        const item = InventoryManager.getItem(itemId);
        if (item) {
          available.push({ itemId, count, item });
        }
      }
    }

    return available;
  }

  /**
   * Check if any consumables are available
   */
  hasAnyConsumables(): boolean {
    return CONSUMABLE_IDS.some(id => this.inventory.consumables[id] > 0);
  }

  // ==========================================================================
  // Equipment Management
  // ==========================================================================

  /**
   * Add equipment to inventory (marks as obtained, adds to unequipped)
   */
  addEquipment(itemId: EquipmentId): void {
    if (!EQUIPMENT_IDS.includes(itemId as EquipmentId)) {
      console.warn(`Invalid equipment ID: ${itemId}`);
      return;
    }

    // Track that we've obtained this equipment
    if (!this.inventory.equipment.obtained.includes(itemId)) {
      this.inventory.equipment.obtained.push(itemId);
    }

    // Add to unequipped pool
    if (!this.inventory.equipment.unequipped.includes(itemId)) {
      this.inventory.equipment.unequipped.push(itemId);
    }
  }

  /**
   * Equip item to a hero (removes from unequipped, updates hero state)
   */
  equipToHero(itemId: EquipmentId, heroId: string): boolean {
    if (!this.heroState[heroId]) {
      console.warn(`Invalid hero ID: ${heroId}`);
      return false;
    }

    const unequippedIndex = this.inventory.equipment.unequipped.indexOf(itemId);
    if (unequippedIndex === -1) {
      console.warn(`Equipment not in unequipped pool: ${itemId}`);
      return false;
    }

    // If hero already has equipment, unequip it first
    const currentEquipment = this.heroState[heroId].equipment;
    if (currentEquipment) {
      this.inventory.equipment.unequipped.push(currentEquipment);
    }

    // Remove from unequipped and assign to hero
    this.inventory.equipment.unequipped.splice(unequippedIndex, 1);
    this.heroState[heroId].equipment = itemId;

    return true;
  }

  /**
   * Unequip item from a hero (adds back to unequipped)
   */
  unequipFromHero(heroId: string): boolean {
    if (!this.heroState[heroId]) {
      console.warn(`Invalid hero ID: ${heroId}`);
      return false;
    }

    const currentEquipment = this.heroState[heroId].equipment;
    if (!currentEquipment) {
      return false; // Nothing to unequip
    }

    this.inventory.equipment.unequipped.push(currentEquipment);
    this.heroState[heroId].equipment = null;

    return true;
  }

  /**
   * Get hero's equipped item
   */
  getHeroEquipment(heroId: string): ItemData | null {
    const equipmentId = this.heroState[heroId]?.equipment;
    if (!equipmentId) return null;
    return InventoryManager.getItem(equipmentId);
  }

  /**
   * Get all unequipped equipment
   */
  getUnequippedEquipment(): { itemId: string; item: ItemData }[] {
    return this.inventory.equipment.unequipped
      .map(itemId => {
        const item = InventoryManager.getItem(itemId);
        return item ? { itemId, item } : null;
      })
      .filter((entry): entry is { itemId: string; item: ItemData } => entry !== null);
  }

  /**
   * Check if equipment has been obtained (for duplicate prevention)
   */
  hasObtainedEquipment(itemId: string): boolean {
    return this.inventory.equipment.obtained.includes(itemId);
  }

  // ==========================================================================
  // Permanent Upgrades
  // ==========================================================================

  /**
   * Apply a permanent bonus to a hero (e.g., +1 Damage Rune)
   */
  applyPermanentBonus(
    heroId: string,
    bonusType: 'damageBonus',
    amount: number
  ): boolean {
    if (!this.heroState[heroId]) {
      console.warn(`Invalid hero ID: ${heroId}`);
      return false;
    }

    // Ensure permanentBonuses exists
    if (!this.heroState[heroId].permanentBonuses) {
      this.heroState[heroId].permanentBonuses = { damageBonus: 0 };
    }

    this.heroState[heroId].permanentBonuses![bonusType] += amount;
    return true;
  }

  /**
   * Get hero's permanent damage bonus
   */
  getHeroDamageBonus(heroId: string): number {
    return this.heroState[heroId]?.permanentBonuses?.damageBonus ?? 0;
  }

  // ==========================================================================
  // Generic Item Addition (for loot drops)
  // ==========================================================================

  /**
   * Add any item to inventory by ID
   */
  addItem(itemId: string): boolean {
    const item = InventoryManager.getItem(itemId);
    if (!item) {
      console.warn(`Unknown item ID: ${itemId}`);
      return false;
    }

    switch (item.type) {
      case 'consumable':
        this.addConsumable(itemId as ConsumableId);
        return true;

      case 'equipment':
        this.addEquipment(itemId as EquipmentId);
        return true;

      case 'permanent_upgrade':
        // Permanent upgrades are tracked separately until applied
        if (itemId === 'damage_rune') {
          this.inventory.damageRunes += 1;
        }
        return true;

      default:
        console.warn(`Unknown item type: ${item.type}`);
        return false;
    }
  }

  // ==========================================================================
  // State Access
  // ==========================================================================

  /**
   * Get current inventory state (for saving)
   */
  getInventory(): InventoryState {
    return { ...this.inventory };
  }

  /**
   * Get current hero state (for saving)
   */
  getHeroState(): Record<string, HeroState> {
    return { ...this.heroState };
  }

  /**
   * Get damage rune count
   */
  getDamageRuneCount(): number {
    return this.inventory.damageRunes ?? 0;
  }

  /**
   * Use a damage rune (removes from inventory, applies to hero)
   */
  useDamageRune(heroId: string): boolean {
    const count = this.getDamageRuneCount();
    if (count <= 0) return false;

    // Remove from inventory
    this.inventory.damageRunes -= 1;

    // Apply to hero
    return this.applyPermanentBonus(heroId, 'damageBonus', 1);
  }
}
