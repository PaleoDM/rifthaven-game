// LootManager - handles loot pool and chest generation

import {
  ItemData,
  ChestState,
  LootResult,
  EQUIPMENT_IDS,
} from '../data/ItemTypes';
import { InventoryManager } from './InventoryManager';

export class LootManager {
  private chestStates: Record<string, ChestState>;
  private inventoryManager: InventoryManager;

  constructor(
    chestStates: Record<string, ChestState>,
    inventoryManager: InventoryManager
  ) {
    this.chestStates = chestStates ?? {};
    this.inventoryManager = inventoryManager;
  }

  // ==========================================================================
  // Loot Generation
  // ==========================================================================

  /**
   * Generate a random item from the loot pool
   * Prevents duplicate equipment drops
   */
  generateLoot(): LootResult | null {
    const allItems = this.getAvailableLootPool();

    if (allItems.length === 0) {
      console.warn('Loot pool is empty');
      return null;
    }

    // Calculate total weight
    const totalWeight = allItems.reduce((sum, item) => sum + item.lootWeight, 0);

    // Roll for item
    let roll = Math.random() * totalWeight;

    for (const item of allItems) {
      roll -= item.lootWeight;
      if (roll <= 0) {
        return {
          itemId: item.id,
          item,
        };
      }
    }

    // Fallback to first item (shouldn't happen)
    return {
      itemId: allItems[0].id,
      item: allItems[0],
    };
  }

  /**
   * Get available loot pool (excludes already-obtained equipment)
   */
  private getAvailableLootPool(): ItemData[] {
    const allItems = InventoryManager.getItemsByType('consumable')
      .concat(InventoryManager.getItemsByType('permanent_upgrade'))
      .concat(InventoryManager.getItemsByType('equipment'));

    // Filter out equipment we've already obtained
    return allItems.filter(item => {
      if (item.type === 'equipment') {
        return !this.inventoryManager.hasObtainedEquipment(item.id);
      }
      return true;
    });
  }

  /**
   * Get available equipment that hasn't been obtained yet
   */
  getAvailableEquipment(): ItemData[] {
    return EQUIPMENT_IDS
      .filter(id => !this.inventoryManager.hasObtainedEquipment(id))
      .map(id => InventoryManager.getItem(id))
      .filter((item): item is ItemData => item !== null);
  }

  // ==========================================================================
  // Chest Management
  // ==========================================================================

  /**
   * Check if a chest has been opened
   */
  isChestOpened(chestId: string): boolean {
    return this.chestStates[chestId]?.opened ?? false;
  }

  /**
   * Open a chest and generate loot (or return existing contents)
   * Returns the item in the chest, or null if already opened
   */
  openChest(chestId: string): LootResult | null {
    // Check if already opened
    if (this.chestStates[chestId]?.opened) {
      console.log(`Chest ${chestId} already opened`);
      return null;
    }

    // Generate loot if not already determined
    let contents = this.chestStates[chestId]?.contents;

    if (!contents) {
      const loot = this.generateLoot();
      if (!loot) {
        console.warn(`Failed to generate loot for chest ${chestId}`);
        return null;
      }
      contents = loot.itemId;
    }

    // Mark chest as opened
    this.chestStates[chestId] = {
      opened: true,
      contents,
    };

    // Add item to inventory
    this.inventoryManager.addItem(contents);

    const item = InventoryManager.getItem(contents);
    if (!item) {
      console.warn(`Unknown item in chest: ${contents}`);
      return null;
    }

    return {
      itemId: contents,
      item,
    };
  }

  /**
   * Get the contents of a chest (without opening it)
   */
  getChestContents(chestId: string): ItemData | null {
    const contents = this.chestStates[chestId]?.contents;
    if (!contents) return null;
    return InventoryManager.getItem(contents);
  }

  /**
   * Pre-generate chest contents (for deterministic seeding)
   */
  preGenerateChestContents(chestId: string): void {
    if (this.chestStates[chestId]?.contents) {
      return; // Already generated
    }

    const loot = this.generateLoot();
    if (loot) {
      this.chestStates[chestId] = {
        opened: false,
        contents: loot.itemId,
      };
    }
  }

  // ==========================================================================
  // State Access
  // ==========================================================================

  /**
   * Get all chest states (for saving)
   */
  getChestStates(): Record<string, ChestState> {
    return { ...this.chestStates };
  }

  /**
   * Get loot pool statistics (for debugging)
   */
  getLootPoolStats(): {
    totalItems: number;
    totalWeight: number;
    itemWeights: { itemId: string; weight: number; percentage: number }[];
  } {
    const pool = this.getAvailableLootPool();
    const totalWeight = pool.reduce((sum, item) => sum + item.lootWeight, 0);

    return {
      totalItems: pool.length,
      totalWeight,
      itemWeights: pool.map(item => ({
        itemId: item.id,
        weight: item.lootWeight,
        percentage: Math.round((item.lootWeight / totalWeight) * 100),
      })),
    };
  }

  // ==========================================================================
  // Static Helpers
  // ==========================================================================

  /**
   * Format item rarity for display
   */
  static getRarityColor(rarity: string): number {
    switch (rarity) {
      case 'common':
        return 0xffffff; // White
      case 'uncommon':
        return 0x00ff00; // Green
      case 'rare':
        return 0x0099ff; // Blue
      default:
        return 0xffffff;
    }
  }

  /**
   * Get rarity display name
   */
  static getRarityDisplayName(rarity: string): string {
    switch (rarity) {
      case 'common':
        return 'Common';
      case 'uncommon':
        return 'Uncommon';
      case 'rare':
        return 'Rare';
      default:
        return rarity;
    }
  }
}
