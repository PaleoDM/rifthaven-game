import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import {
  Unit,
  HeroData,
  EnemyData,
  StatusEffect,
  StatusEffectType,
  STATUS_COLORS,
  Team,
} from '../data/BattleTypes';

// HP Bar constants
const HP_BAR_WIDTH = 24;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = -18; // Above the unit sprite

/**
 * Factory function to create a hero Unit from HeroData
 */
export function createHeroUnit(
  heroData: HeroData,
  gridX: number,
  gridY: number,
  scene: Phaser.Scene
): Unit {
  const unit: Unit = {
    id: heroData.id,
    dataId: heroData.id,
    name: heroData.name,
    team: 'hero',
    gridX,
    gridY,
    facing: 'north',

    currentHp: heroData.hp,
    maxHp: heroData.maxHp,
    attack: heroData.attack,
    defense: heroData.defense,
    magic: heroData.magic,
    resilience: heroData.resilience,
    speed: heroData.speed,

    abilities: heroData.abilities,
    statusEffects: [],
    isUnconscious: false,
    hasMoved: false,
    hasActed: false,
    actionsRemaining: 1,

    portrait: heroData.portrait,
    special: heroData.special,
  };

  // Add mana or ki if applicable
  if (heroData.mana !== undefined) {
    unit.currentMana = heroData.mana;
    unit.maxMana = heroData.maxMana;
  }
  if (heroData.ki !== undefined) {
    unit.currentKi = heroData.ki;
    unit.maxKi = heroData.maxKi;
  }

  // Create sprite
  const pixelX = gridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
  const pixelY = gridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
  unit.sprite = scene.add.sprite(pixelX, pixelY, `${heroData.sprite}_front`);
  unit.sprite.setOrigin(0.5, 0.5);
  // Scale sprite to fit tile (48px sprite in 32px tile)
  unit.sprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);

  return unit;
}

/**
 * Factory function to create an enemy Unit from EnemyData
 */
export function createEnemyUnit(
  enemyData: EnemyData,
  instanceId: string,
  gridX: number,
  gridY: number,
  scene: Phaser.Scene
): Unit {
  const unit: Unit = {
    id: instanceId, // e.g., "imp_1", "lemure_2"
    dataId: enemyData.id,
    name: enemyData.name,
    team: 'enemy',
    gridX,
    gridY,
    facing: 'south',

    currentHp: enemyData.hp,
    maxHp: enemyData.maxHp,
    attack: enemyData.attack,
    defense: enemyData.defense,
    magic: enemyData.magic,
    resilience: enemyData.resilience,
    speed: enemyData.speed,

    abilities: enemyData.abilities,
    statusEffects: [],
    isUnconscious: false,
    hasMoved: false,
    hasActed: false,
    actionsRemaining: 1,
    flying: enemyData.flying,
  };

  // Create sprite - use _front suffix directly (matching hero behavior)
  const pixelX = gridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
  const pixelY = gridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
  unit.sprite = scene.add.sprite(pixelX, pixelY, `${enemyData.sprite}_front`);
  unit.sprite.setOrigin(0.5, 0.5);
  // Scale sprite to fit tile
  unit.sprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);

  return unit;
}

/**
 * Get the sprite key for a unit based on facing direction
 */
export function getSpriteKey(unit: Unit, baseSprite: string): string {
  const directionMap: Record<string, string> = {
    north: 'back',
    south: 'front',
    east: 'right',
    west: 'left',
  };
  return `${baseSprite}_${directionMap[unit.facing]}`;
}

/**
 * Update unit sprite to match facing direction
 */
export function updateUnitFacing(unit: Unit, baseSprite: string): void {
  if (unit.sprite) {
    unit.sprite.setTexture(getSpriteKey(unit, baseSprite));
  }
}

/**
 * Move unit sprite to grid position with optional tween
 */
export function moveUnitToGrid(
  unit: Unit,
  gridX: number,
  gridY: number,
  scene: Phaser.Scene,
  animate: boolean = true,
  duration: number = 150
): Promise<void> {
  return new Promise((resolve) => {
    unit.gridX = gridX;
    unit.gridY = gridY;

    const targetX = gridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const targetY = gridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const hpBarTargetY = targetY + HP_BAR_OFFSET_Y;

    if (animate && unit.sprite) {
      // Animate sprite
      scene.tweens.add({
        targets: unit.sprite,
        x: targetX,
        y: targetY,
        duration,
        ease: 'Linear',
        onComplete: () => resolve(),
      });

      // Animate HP bar alongside sprite
      if (unit.hpBarContainer) {
        scene.tweens.add({
          targets: unit.hpBarContainer,
          x: targetX,
          y: hpBarTargetY,
          duration,
          ease: 'Linear',
        });
      }

      // Animate condition markers alongside sprite
      if (unit.conditionMarkerContainer) {
        scene.tweens.add({
          targets: unit.conditionMarkerContainer,
          x: targetX,
          y: targetY,
          duration,
          ease: 'Linear',
        });
      }
    } else if (unit.sprite) {
      unit.sprite.setPosition(targetX, targetY);
      if (unit.hpBarContainer) {
        unit.hpBarContainer.setPosition(targetX, hpBarTargetY);
      }
      if (unit.conditionMarkerContainer) {
        unit.conditionMarkerContainer.setPosition(targetX, targetY);
      }
      resolve();
    } else {
      resolve();
    }
  });
}

/**
 * Reset unit turn state for a new turn
 */
export function resetUnitTurnState(unit: Unit): void {
  unit.hasMoved = false;
  unit.hasActed = false;

  // Azrael gets 2 actions if stationary
  if (unit.special === 'double_action_if_stationary') {
    unit.actionsRemaining = 2; // Will be reduced to 1 if he moves
  } else {
    unit.actionsRemaining = 1;
  }
}

/**
 * Check if unit can still act this turn
 */
export function canUnitAct(unit: Unit): boolean {
  if (unit.isUnconscious) return false;
  return !unit.hasActed || unit.actionsRemaining > 0;
}

/**
 * Check if unit can still move this turn
 */
export function canUnitMove(unit: Unit): boolean {
  if (unit.isUnconscious) return false;
  return !unit.hasMoved;
}

/**
 * Mark unit as having moved
 * For Azrael, this also consumes his extra action
 */
export function markUnitMoved(unit: Unit): void {
  unit.hasMoved = true;

  // Azrael loses his second action if he moves
  if (unit.special === 'double_action_if_stationary') {
    unit.actionsRemaining = Math.min(unit.actionsRemaining, 1);
  }
}

/**
 * Mark unit as having used an action
 */
export function markUnitActed(unit: Unit): void {
  unit.actionsRemaining--;
  if (unit.actionsRemaining <= 0) {
    unit.hasActed = true;
  }
}

/**
 * Apply damage to unit
 */
export function applyDamage(unit: Unit, damage: number): void {
  unit.currentHp = Math.max(0, unit.currentHp - damage);

  // Hidden breaks when taking damage
  if (hasStatusEffect(unit, 'hidden') && damage > 0) {
    removeStatusEffect(unit, 'hidden');
  }

  // Update HP bar
  updateHpBar(unit);

  if (unit.currentHp === 0) {
    unit.isUnconscious = true;
    unit.statusEffects.push({
      type: 'unconscious',
      duration: -1, // Permanent until healed
    });

    // Rotate sprite to show defeat
    if (unit.sprite) {
      unit.sprite.setAngle(90);
    }
  }
}

/**
 * Apply healing to unit
 */
export function applyHealing(unit: Unit, healing: number): void {
  const wasUnconscious = unit.isUnconscious;

  unit.currentHp = Math.min(unit.maxHp, unit.currentHp + healing);

  // Revive if was unconscious and now has HP
  if (wasUnconscious && unit.currentHp > 0) {
    unit.isUnconscious = false;
    unit.statusEffects = unit.statusEffects.filter(e => e.type !== 'unconscious');

    // Reset sprite rotation
    if (unit.sprite) {
      unit.sprite.setAngle(0);
    }
  }

  // Update HP bar
  updateHpBar(unit);
}

/**
 * Add status effect to unit
 */
export function addStatusEffect(unit: Unit, effect: StatusEffect): void {
  // Remove existing effect of same type (replace it)
  unit.statusEffects = unit.statusEffects.filter(e => e.type !== effect.type);
  unit.statusEffects.push(effect);
}

/**
 * Remove status effect from unit
 */
export function removeStatusEffect(unit: Unit, effectType: string): void {
  unit.statusEffects = unit.statusEffects.filter(e => e.type !== effectType);
}

/**
 * Check if unit has a specific status effect
 */
export function hasStatusEffect(unit: Unit, effectType: string): boolean {
  return unit.statusEffects.some(e => e.type === effectType);
}

/**
 * Get status effect from unit
 */
export function getStatusEffect(unit: Unit, effectType: string): StatusEffect | undefined {
  return unit.statusEffects.find(e => e.type === effectType);
}

/**
 * Process end-of-turn status effects (decrement durations, apply damage)
 */
export function processStatusEffects(unit: Unit): { damage: number; expiredEffects: string[] } {
  let damage = 0;
  const expiredEffects: string[] = [];

  unit.statusEffects = unit.statusEffects.filter((effect) => {
    // Skip permanent effects
    if (effect.duration === -1) return true;

    // Decrement duration
    effect.duration--;

    // Check if expired
    if (effect.duration <= 0) {
      expiredEffects.push(effect.type);
      return false;
    }

    return true;
  });

  // Note: Poison damage is handled separately during the damage phase
  // This function just manages durations

  return { damage, expiredEffects };
}

// ============================================
// HP Bar Functions
// ============================================

/**
 * Create HP bar for a unit
 */
export function createHpBar(unit: Unit, scene: Phaser.Scene): void {
  if (!unit.sprite) return;

  // Create container for HP bar elements
  const container = scene.add.container(unit.sprite.x, unit.sprite.y + HP_BAR_OFFSET_Y);

  // Background (dark red)
  const bgBar = scene.add.graphics();
  bgBar.fillStyle(0x330000, 1);
  bgBar.fillRect(-HP_BAR_WIDTH / 2, -HP_BAR_HEIGHT / 2, HP_BAR_WIDTH, HP_BAR_HEIGHT);
  bgBar.lineStyle(1, 0x000000, 1);
  bgBar.strokeRect(-HP_BAR_WIDTH / 2, -HP_BAR_HEIGHT / 2, HP_BAR_WIDTH, HP_BAR_HEIGHT);

  // Foreground (green, will be scaled based on HP)
  const hpBar = scene.add.graphics();
  hpBar.fillStyle(0x00ff00, 1);
  hpBar.fillRect(-HP_BAR_WIDTH / 2, -HP_BAR_HEIGHT / 2, HP_BAR_WIDTH, HP_BAR_HEIGHT);

  container.add([bgBar, hpBar]);
  container.setDepth(50); // Above units but below UI

  // Store reference and the hp bar graphics for updates
  unit.hpBarContainer = container;
  (container as any).hpBarGraphics = hpBar;
  (container as any).hpBarBg = bgBar;

  updateHpBar(unit);
}

/**
 * Update HP bar to reflect current HP
 */
export function updateHpBar(unit: Unit): void {
  if (!unit.hpBarContainer) return;

  const hpBar = (unit.hpBarContainer as any).hpBarGraphics as Phaser.GameObjects.Graphics;
  if (!hpBar) return;

  const hpPercent = unit.currentHp / unit.maxHp;

  // Clear and redraw with new width
  hpBar.clear();

  // Color based on HP percentage
  let color = 0x00ff00; // Green
  if (hpPercent <= 0.25) {
    color = 0xff0000; // Red
  } else if (hpPercent <= 0.5) {
    color = 0xffaa00; // Orange
  }

  hpBar.fillStyle(color, 1);
  const barWidth = HP_BAR_WIDTH * hpPercent;
  hpBar.fillRect(-HP_BAR_WIDTH / 2, -HP_BAR_HEIGHT / 2, barWidth, HP_BAR_HEIGHT);

  // Hide HP bar if unit is unconscious
  unit.hpBarContainer.setVisible(!unit.isUnconscious);
}

/**
 * Move HP bar to follow unit sprite
 */
export function updateHpBarPosition(unit: Unit): void {
  if (!unit.sprite || !unit.hpBarContainer) return;

  unit.hpBarContainer.setPosition(unit.sprite.x, unit.sprite.y + HP_BAR_OFFSET_Y);
}

// ============================================
// CONDITION MARKERS (around unit sprite on map)
// ============================================

const CONDITION_MARKER_SIZE = GAME_CONFIG.TILE_SIZE; // Same size as tile
const CONDITION_MARKER_OFFSET_Y = 0; // Centered on sprite

/**
 * Create condition marker container for a unit
 */
export function createConditionMarkers(unit: Unit, scene: Phaser.Scene): void {
  if (!unit.sprite) return;

  // Create container for condition marker elements
  const container = scene.add.container(unit.sprite.x, unit.sprite.y + CONDITION_MARKER_OFFSET_Y);
  container.setDepth(5); // Below units (units are at default depth) but above ground

  unit.conditionMarkerContainer = container;

  // Initial update
  updateConditionMarkers(unit, scene);
}

/**
 * Update condition markers to reflect current status effects
 */
export function updateConditionMarkers(unit: Unit, scene: Phaser.Scene): void {
  if (!unit.conditionMarkerContainer) return;

  // Clear existing markers
  unit.conditionMarkerContainer.removeAll(true);

  // Don't show markers for unconscious units
  if (unit.isUnconscious) {
    return;
  }

  // Get visible status effects (exclude unconscious)
  const visibleEffects = unit.statusEffects.filter(
    (e) => e.type !== 'unconscious' && STATUS_COLORS[e.type as StatusEffectType]
  );

  if (visibleEffects.length === 0) {
    return;
  }

  // Get the primary effect's color for the border
  const primaryEffect = visibleEffects[0];
  const borderColor = STATUS_COLORS[primaryEffect.type as StatusEffectType];

  // Draw colored border around the tile
  const border = scene.add.graphics();
  border.lineStyle(2, borderColor, 0.9);
  border.strokeRect(
    -CONDITION_MARKER_SIZE / 2,
    -CONDITION_MARKER_SIZE / 2,
    CONDITION_MARKER_SIZE,
    CONDITION_MARKER_SIZE
  );
  unit.conditionMarkerContainer.add(border);

  // Add duration indicator in bottom-right corner if applicable
  if (primaryEffect.duration > 0 && primaryEffect.duration !== -1) {
    // Duration background circle
    const durBg = scene.add.graphics();
    durBg.fillStyle(borderColor, 0.9);
    durBg.fillCircle(CONDITION_MARKER_SIZE / 2 - 6, CONDITION_MARKER_SIZE / 2 - 6, 7);
    unit.conditionMarkerContainer.add(durBg);

    // Duration text
    const durText = scene.add.text(
      CONDITION_MARKER_SIZE / 2 - 6,
      CONDITION_MARKER_SIZE / 2 - 6,
      `${primaryEffect.duration}`,
      {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#ffffff',
        fontStyle: 'bold',
      }
    ).setOrigin(0.5);
    unit.conditionMarkerContainer.add(durText);
  }

  // Show multiple effect indicator if more than one effect (top-left corner)
  if (visibleEffects.length > 1) {
    const multiText = scene.add.text(
      -CONDITION_MARKER_SIZE / 2 + 6,
      -CONDITION_MARKER_SIZE / 2 + 6,
      `+${visibleEffects.length - 1}`,
      {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      }
    ).setOrigin(0.5);
    unit.conditionMarkerContainer.add(multiText);
  }
}

/**
 * Move condition markers to follow unit sprite
 */
export function updateConditionMarkerPosition(unit: Unit): void {
  if (!unit.sprite || !unit.conditionMarkerContainer) return;

  unit.conditionMarkerContainer.setPosition(unit.sprite.x, unit.sprite.y + CONDITION_MARKER_OFFSET_Y);
}

/**
 * Calculate effective defense (base + modifiers from status effects)
 */
export function getEffectiveDefense(unit: Unit): number {
  let defense = unit.defense;

  // Hidden bonus
  if (hasStatusEffect(unit, 'hidden')) {
    const hidden = getStatusEffect(unit, 'hidden');
    defense += hidden?.value || 2;
  }

  // Barkskin bonus
  if (hasStatusEffect(unit, 'barkskin')) {
    const barkskin = getStatusEffect(unit, 'barkskin');
    defense += barkskin?.value || 2;
  }

  // Dodge bonus (Veil's defensive stance)
  if (hasStatusEffect(unit, 'dodge')) {
    const dodge = getStatusEffect(unit, 'dodge');
    defense += dodge?.value || 2;
  }

  // Exposed penalty
  if (hasStatusEffect(unit, 'exposed')) {
    const exposed = getStatusEffect(unit, 'exposed');
    defense -= exposed?.value || 2;
  }

  return defense;
}

/**
 * Calculate effective attack (base + modifiers from status effects)
 */
export function getEffectiveAttack(unit: Unit): number {
  let attack = unit.attack;

  // Rage bonus (Thorn's battle trance)
  if (hasStatusEffect(unit, 'rage')) {
    attack += 2; // Rage gives +2 attack
  }

  // Inspired bonus (Arden's inspiration)
  if (hasStatusEffect(unit, 'inspired')) {
    attack += 2; // Inspired gives +2 attack
  }

  return attack;
}

/**
 * Calculate effective damage bonus from status effects
 */
export function getEffectiveDamageBonus(unit: Unit): number {
  let bonus = 0;

  // Rage bonus (Thorn's battle trance gives +2 damage)
  if (hasStatusEffect(unit, 'rage')) {
    bonus += 2;
  }

  return bonus;
}

/**
 * Calculate effective resilience (base + modifiers from status effects)
 */
export function getEffectiveResilience(unit: Unit): number {
  let resilience = unit.resilience;

  // Inspired bonus (Arden's inspiration gives +2 resilience)
  if (hasStatusEffect(unit, 'inspired')) {
    resilience += 2;
  }

  return resilience;
}

/**
 * Check if unit is on a specific team
 */
export function isOnTeam(unit: Unit, team: Team): boolean {
  return unit.team === team;
}

/**
 * Get all living units from a list
 */
export function getLivingUnits(units: Unit[]): Unit[] {
  return units.filter(u => !u.isUnconscious);
}

/**
 * Get all units on a team
 */
export function getUnitsOnTeam(units: Unit[], team: Team): Unit[] {
  return units.filter(u => u.team === team);
}

/**
 * Check if all units on a team are unconscious (defeat condition)
 */
export function isTeamDefeated(units: Unit[], team: Team): boolean {
  const teamUnits = getUnitsOnTeam(units, team);
  return teamUnits.every(u => u.isUnconscious);
}
