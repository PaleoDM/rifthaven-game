// SaveManager - handles localStorage persistence for game state

import {
  InventoryState,
  PermanentBonuses,
  ChestState,
  createDefaultInventory,
  createDefaultPermanentBonuses,
} from '../data/ItemTypes';

export interface HeroState {
  xp: number;
  level: number;
  currentHp: number;
  currentMana: number | null; // null for Azrael (no mana)
  currentKi?: number; // only for Vicas
  equipment?: string | null; // equipped item ID or null
  permanentBonuses?: PermanentBonuses; // from +1 Damage Runes etc.
}

export interface SaveData {
  slot: number;
  mainHero: string;
  currentMap: string;
  playerPosition: { x: number; y: number };
  playTime: number; // in seconds
  heroState: Record<string, HeroState>;
  flags: Record<string, boolean>;
  timestamp: string;
  inventory?: InventoryState; // party-wide inventory
  chests?: Record<string, ChestState>; // chest states by chest ID
}

export interface SaveSlotPreview {
  slot: number;
  isEmpty: boolean;
  mainHero?: string;
  heroLevels?: number[];
  playTime?: number;
  location?: string;
  timestamp?: string;
}

const SAVE_KEY_PREFIX = 'ishetar_save_';
const MAX_SLOTS = 3;

// Default hero stats at level 1 (Rifthaven heroes)
const DEFAULT_HERO_STATS: Record<string, { hp: number; mana: number | null; ki?: number }> = {
  arden: { hp: 10, mana: 10 },
  quin: { hp: 8, mana: 10 }, // Wizard - squishiest
  veil: { hp: 10, mana: null, ki: 5 }, // Veil is a Monk, uses Ki
  ty: { hp: 10, mana: 10 },
  thorn: { hp: 12, mana: null }, // Thorn is a Barbarian, no mana
};

export class SaveManager {
  /**
   * Create initial hero state for a new game
   */
  static createInitialHeroState(): Record<string, HeroState> {
    const state: Record<string, HeroState> = {};

    for (const heroId of Object.keys(DEFAULT_HERO_STATS)) {
      const defaults = DEFAULT_HERO_STATS[heroId];
      state[heroId] = {
        xp: 0,
        level: 1,
        currentHp: defaults.hp,
        currentMana: defaults.mana,
        ...(defaults.ki !== undefined && { currentKi: defaults.ki }),
        equipment: null,
        permanentBonuses: createDefaultPermanentBonuses(),
      };
    }

    return state;
  }

  /**
   * Create initial inventory for a new game
   */
  static createInitialInventory(): InventoryState {
    return createDefaultInventory();
  }

  /**
   * Create hero state at a specific level (for battle testing)
   */
  static createHeroStateAtLevel(level: number): Record<string, HeroState> {
    const state: Record<string, HeroState> = {};

    for (const heroId of Object.keys(DEFAULT_HERO_STATS)) {
      state[heroId] = {
        xp: 0,
        level: level,
        currentHp: this.getMaxHp(heroId, level),
        currentMana: this.getMaxMana(heroId, level),
        // Veil uses Ki instead of Mana
        ...(heroId === 'veil' && { currentKi: this.getMaxKi(level) }),
        equipment: null,
        permanentBonuses: createDefaultPermanentBonuses(),
      };
    }

    return state;
  }

  /**
   * Get max HP for a hero at their current level
   */
  static getMaxHp(heroId: string, level: number): number {
    // HP growth tables (Rifthaven heroes) - placeholder progressions
    const hpTables: Record<string, number[]> = {
      arden: [10, 15, 20, 25, 30], // Bard - moderate
      quin: [8, 12, 16, 20, 24], // Wizard - squishiest
      veil: [10, 14, 18, 22, 26], // Monk - moderate
      ty: [10, 14, 18, 22, 26], // Warlock - moderate
      thorn: [12, 18, 24, 30, 36], // Barbarian - tankiest
    };

    const table = hpTables[heroId];
    if (!table) return 10;
    return table[Math.min(level - 1, table.length - 1)];
  }

  /**
   * Get max Mana for a hero at their current level
   */
  static getMaxMana(heroId: string, level: number): number | null {
    if (heroId === 'veil') return null; // Veil uses Ki instead
    if (heroId === 'thorn') return null; // Thorn is a Barbarian, no mana

    // Mana growth: 10→12→13→14→15
    const manaTable = [10, 12, 13, 14, 15];
    return manaTable[Math.min(level - 1, manaTable.length - 1)];
  }

  /**
   * Get max Ki for a hero at their current level (if applicable)
   */
  static getMaxKi(level: number): number {
    // Ki growth: 5→6→6→7→7 (reserved for future Ki-using heroes)
    const kiTable = [5, 6, 6, 7, 7];
    return kiTable[Math.min(level - 1, kiTable.length - 1)];
  }

  /**
   * Restore all heroes to full HP/Mana/Ki (preserves equipment and bonuses)
   */
  static restoreAllResources(heroState: Record<string, HeroState>): Record<string, HeroState> {
    const restored: Record<string, HeroState> = {};

    for (const [heroId, state] of Object.entries(heroState)) {
      restored[heroId] = {
        ...state,
        currentHp: this.getMaxHp(heroId, state.level),
        currentMana: this.getMaxMana(heroId, state.level),
        // Restore Ki for Veil (Monk)
        ...(heroId === 'veil' && { currentKi: this.getMaxKi(state.level) }),
        // Preserve equipment and permanent bonuses
        equipment: state.equipment ?? null,
        permanentBonuses: state.permanentBonuses ?? createDefaultPermanentBonuses(),
      };
    }

    return restored;
  }

  /**
   * Ensure hero state has all required fields (for loading old saves)
   */
  static migrateHeroState(heroState: Record<string, HeroState>): Record<string, HeroState> {
    const migrated: Record<string, HeroState> = {};

    for (const [heroId, state] of Object.entries(heroState)) {
      migrated[heroId] = {
        ...state,
        equipment: state.equipment ?? null,
        permanentBonuses: state.permanentBonuses ?? createDefaultPermanentBonuses(),
      };
    }

    return migrated;
  }

  /**
   * Ensure save data has all required fields (for loading old saves)
   */
  static migrateSaveData(saveData: SaveData): SaveData {
    return {
      ...saveData,
      heroState: this.migrateHeroState(saveData.heroState),
      inventory: saveData.inventory ?? createDefaultInventory(),
      chests: saveData.chests ?? {},
    };
  }

  /**
   * Save game to a specific slot
   */
  static save(saveData: SaveData): boolean {
    try {
      const key = `${SAVE_KEY_PREFIX}${saveData.slot}`;
      saveData.timestamp = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(saveData));
      return true;
    } catch (error) {
      console.error('Failed to save game:', error);
      return false;
    }
  }

  /**
   * Load game from a specific slot (auto-migrates old save formats)
   */
  static load(slot: number): SaveData | null {
    try {
      const key = `${SAVE_KEY_PREFIX}${slot}`;
      const data = localStorage.getItem(key);
      if (!data) return null;
      const saveData = JSON.parse(data) as SaveData;
      // Migrate old saves to include new fields
      return this.migrateSaveData(saveData);
    } catch (error) {
      console.error('Failed to load game:', error);
      return null;
    }
  }

  /**
   * Delete a save slot
   */
  static delete(slot: number): boolean {
    try {
      const key = `${SAVE_KEY_PREFIX}${slot}`;
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error('Failed to delete save:', error);
      return false;
    }
  }

  /**
   * Check if a save slot exists
   */
  static exists(slot: number): boolean {
    const key = `${SAVE_KEY_PREFIX}${slot}`;
    return localStorage.getItem(key) !== null;
  }

  /**
   * Get preview info for all save slots
   */
  static getAllSlotPreviews(): SaveSlotPreview[] {
    const previews: SaveSlotPreview[] = [];

    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const saveData = this.load(slot);

      if (!saveData) {
        previews.push({ slot, isEmpty: true });
      } else {
        const heroLevels = Object.values(saveData.heroState).map(h => h.level);
        previews.push({
          slot,
          isEmpty: false,
          mainHero: saveData.mainHero,
          heroLevels,
          playTime: saveData.playTime,
          location: saveData.currentMap,
          timestamp: saveData.timestamp,
        });
      }
    }

    return previews;
  }

  /**
   * Format play time as "Xh Ym" string
   */
  static formatPlayTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Get display name for a map ID
   */
  static getMapDisplayName(mapId: string): string {
    const mapNames: Record<string, string> = {
      'ishetar_town': 'Ishetar Town',
      'ishetar_town_post_battle': 'Ishetar Town',
      'ishetar_town_post_tutorial': 'Ishetar Town',
      'south_gate': 'South Gate',
      'ogre_ambush': 'Forest Path',
      'oracle_shrine': "Oracle's Shrine",
      'quetzi_shrine_exploration': 'Quetzi Shrine',
      'hell_hound_den': 'Hell Hound Den',
    };
    return mapNames[mapId] || mapId;
  }
}
