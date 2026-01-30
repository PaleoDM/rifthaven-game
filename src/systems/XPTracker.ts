// XPTracker - tracks XP earned during battle (Phase 5, updated Phase 8)

import { HeroState, SaveManager } from './SaveManager';

export interface XPGain {
  heroId: string;
  source: 'damage' | 'kill' | 'resource' | 'item';
  amount: number;
  description: string;
}

export interface BattleXPSummary {
  heroId: string;
  totalXP: number;
  leveledUp: boolean;
  newLevel: number;
  previousLevel: number;
}

// XP Formula constants (Phase 8 revision, Phase 9 tuning)
// - Free abilities (0 cost): XP from damage dealt
// - Paid abilities (mana/ki cost): XP from resource spent (no damage XP)
// - Kill bonus: flat XP for finishing enemies
// Tuned in Phase 9 to ensure level 2 by end of fight 2
const XP_PER_DAMAGE = 1; // 1 XP per 1 damage (for 0-cost abilities only)
const XP_PER_RESOURCE = 4; // 4 XP per mana/ki spent
const XP_KILL_BONUS = 5;
const XP_ITEM_USE = 5; // 5 XP for using a consumable item
const CATCHUP_BONUS = 0.5; // +50% XP if behind highest party level

// Level thresholds
const LEVEL_THRESHOLDS = [
  { level: 1, xp: 0 },
  { level: 2, xp: 50 },
  { level: 3, xp: 125 },
  // Future levels can be added here
];

export class XPTracker {
  // XP earned this battle per hero
  private battleXP: Record<string, number> = {};

  // XP log for summary display
  private xpGains: XPGain[] = [];

  // Hero state reference (from save data)
  private heroState: Record<string, HeroState>;

  constructor(heroState: Record<string, HeroState>) {
    this.heroState = heroState;

    // Initialize battle XP counters
    for (const heroId of Object.keys(heroState)) {
      this.battleXP[heroId] = 0;
    }
  }

  /**
   * Get the highest level in the party (for catch-up calculation)
   */
  private getHighestPartyLevel(): number {
    let highest = 1;
    for (const state of Object.values(this.heroState)) {
      if (state.level > highest) {
        highest = state.level;
      }
    }
    return highest;
  }

  /**
   * Check if a hero qualifies for catch-up bonus
   */
  private getsCatchupBonus(heroId: string): boolean {
    const heroLevel = this.heroState[heroId]?.level || 1;
    const highestLevel = this.getHighestPartyLevel();
    return heroLevel < highestLevel;
  }

  /**
   * Apply catch-up bonus if applicable
   */
  private applyBonus(heroId: string, baseXP: number): number {
    if (this.getsCatchupBonus(heroId)) {
      return Math.floor(baseXP * (1 + CATCHUP_BONUS));
    }
    return baseXP;
  }

  /**
   * Award XP for using a free (0-cost) ability
   * Minimum 1 XP even on miss, scales with damage dealt
   * For abilities that cost mana/ki, use awardResourceXP instead
   */
  awardDamageXP(heroId: string, damage: number): void {
    if (!this.heroState[heroId]) return; // Not a hero

    // Minimum 1 XP for using a free ability, even on miss
    // If damage dealt, get at least 1 XP or more based on damage
    const baseXP = Math.max(1, Math.floor(damage * XP_PER_DAMAGE));
    const finalXP = this.applyBonus(heroId, baseXP);

    this.battleXP[heroId] += finalXP;
    this.xpGains.push({
      heroId,
      source: 'damage',
      amount: finalXP,
      description: damage > 0 ? `${damage} damage → ${finalXP} XP` : `Attack attempt → ${finalXP} XP`,
    });
  }

  /**
   * Award XP for getting a kill
   */
  awardKillXP(heroId: string, enemyName: string): void {
    if (!this.heroState[heroId]) return;

    const finalXP = this.applyBonus(heroId, XP_KILL_BONUS);

    this.battleXP[heroId] += finalXP;
    this.xpGains.push({
      heroId,
      source: 'kill',
      amount: finalXP,
      description: `Killed ${enemyName} → ${finalXP} XP`,
    });
  }

  /**
   * Award XP for spending mana or ki on an ability
   * This replaces damage XP for paid abilities
   */
  awardResourceXP(heroId: string, resourceSpent: number, abilityName: string): void {
    if (!this.heroState[heroId]) return;
    if (resourceSpent <= 0) return; // No XP for free abilities

    const baseXP = resourceSpent * XP_PER_RESOURCE;
    const finalXP = this.applyBonus(heroId, baseXP);

    this.battleXP[heroId] += finalXP;
    this.xpGains.push({
      heroId,
      source: 'resource',
      amount: finalXP,
      description: `${abilityName} (${resourceSpent} spent) → ${finalXP} XP`,
    });
  }

  /**
   * Award XP for using a consumable item in combat
   * Returns the XP earned for display purposes
   */
  awardItemXP(heroId: string, itemName: string): number {
    if (!this.heroState[heroId]) return 0;

    const finalXP = this.applyBonus(heroId, XP_ITEM_USE);

    this.battleXP[heroId] += finalXP;
    this.xpGains.push({
      heroId,
      source: 'item',
      amount: finalXP,
      description: `Used ${itemName} → ${finalXP} XP`,
    });

    return finalXP;
  }

  /**
   * Get XP earned this battle for a hero
   */
  getBattleXP(heroId: string): number {
    return this.battleXP[heroId] || 0;
  }

  /**
   * Calculate what level a hero will be after adding XP
   */
  static calculateLevel(totalXP: number): number {
    let level = 1;
    for (const threshold of LEVEL_THRESHOLDS) {
      if (totalXP >= threshold.xp) {
        level = threshold.level;
      }
    }
    return level;
  }

  /**
   * Apply battle XP to hero state and check for level ups
   * Returns summary of XP gains and level ups
   */
  finalizeBattle(): BattleXPSummary[] {
    const summaries: BattleXPSummary[] = [];

    for (const [heroId, battleXP] of Object.entries(this.battleXP)) {
      const currentState = this.heroState[heroId];
      if (!currentState) continue;

      const previousLevel = currentState.level;
      const newTotalXP = currentState.xp + battleXP;
      const newLevel = XPTracker.calculateLevel(newTotalXP);

      // Update hero state
      currentState.xp = newTotalXP;

      // Check for level up
      const leveledUp = newLevel > previousLevel;
      if (leveledUp) {
        currentState.level = newLevel;

        // Apply stat growth
        this.applyLevelUpStats(heroId, currentState, newLevel);
      }

      summaries.push({
        heroId,
        totalXP: battleXP,
        leveledUp,
        newLevel,
        previousLevel,
      });
    }

    return summaries;
  }

  /**
   * Apply stat increases when leveling up
   */
  private applyLevelUpStats(heroId: string, state: HeroState, newLevel: number): void {
    // Update max HP/Mana/Ki based on new level
    state.currentHp = SaveManager.getMaxHp(heroId, newLevel);
    state.currentMana = SaveManager.getMaxMana(heroId, newLevel);
    // Veil uses Ki instead of Mana
    if (heroId === 'veil') {
      state.currentKi = SaveManager.getMaxKi(newLevel);
    }
  }

  /**
   * Get the updated hero state after battle
   */
  getUpdatedHeroState(): Record<string, HeroState> {
    return this.heroState;
  }

  /**
   * Get all XP gains for display/logging
   */
  getXPGains(): XPGain[] {
    return this.xpGains;
  }

  /**
   * Get battle XP for all heroes (for summary display)
   */
  getAllBattleXP(): Record<string, number> {
    return { ...this.battleXP };
  }
}
