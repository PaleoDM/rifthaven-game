// Battle System Type Definitions
// Phase 4: Combat System Implementation

import { EquipmentBonusState } from './ItemTypes';

// =============================================================================
// Terrain Types
// =============================================================================

export enum TerrainType {
  Normal = 0, // Walkable, 1 movement cost
  Difficult = 1, // Walkable, 2 movement cost (e.g., sand, mud)
  Impassable = 2, // Cannot walk through (walls, water)
}

// =============================================================================
// Status Effects
// =============================================================================

export type StatusEffectType =
  | 'poison'
  | 'hidden'
  | 'exposed'
  | 'immobilized'
  | 'barkskin'
  | 'held'
  | 'unconscious'
  | 'entangle_zone'
  // Rifthaven buffs
  | 'rage'
  | 'inspired'
  | 'dodge';

export interface StatusEffect {
  type: StatusEffectType;
  duration: number; // Turns remaining, -1 for permanent/until triggered
  value?: number; // For effects with numeric values (damage per turn, defense bonus, etc.)
}

// Status effect border colors for UI
export const STATUS_COLORS: Record<StatusEffectType, number> = {
  poison: 0x00ff00, // Green
  held: 0x008080, // Teal
  barkskin: 0x8b4513, // Brown
  hidden: 0x800080, // Purple
  exposed: 0xffa500, // Orange
  immobilized: 0x0000ff, // Blue
  unconscious: 0x000000, // Black
  entangle_zone: 0x228b22, // Forest Green
  // Rifthaven buff colors
  rage: 0xff0000, // Red (aggressive)
  inspired: 0xffd700, // Gold (heroic)
  dodge: 0x00bfff, // Light blue (evasive)
};

// =============================================================================
// Ability System
// =============================================================================

export type AbilityType = 'attack' | 'spell' | 'buff' | 'debuff' | 'toggle';
export type TargetType = 'enemy' | 'ally' | 'self' | 'area';
export type CostType = 'mana' | 'ki' | null;

export interface AbilityEffect {
  type: StatusEffectType | 'remove_status';
  // For status effects
  defenseBonus?: number;
  defensePenalty?: number;
  damagePerTurn?: string; // Dice notation e.g. "1d4"
  durationOnFail?: number | string; // Can be number or dice notation
  durationOnSave?: number;
  effectOnSave?: string; // e.g. "half_movement"
  breaksOn?: string[]; // e.g. ["attack", "damage_taken"]
  duration?: number | string; // For simple duration effects
  count?: number; // For remove_status
  // For zone effects (e.g. Entangle)
  createsDifficultTerrain?: boolean;
  damageOnEntry?: boolean;
  damageOnTurnStart?: boolean;
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  type: AbilityType;
  cost: number;
  costType: CostType;
  range: number; // 0 = self, 1 = melee, 2+ = ranged
  targetType: TargetType;
  damage?: string; // Dice notation e.g. "1d10"
  damageOnSave?: 'half' | 'none';
  healing?: string; // Dice notation
  bonusDamageIfHidden?: string; // For Azrael's Psychic Dagger
  effect?: AbilityEffect;
  areaSize?: { width: number; height: number }; // For AOE abilities
  levelRequired?: number; // Minimum hero level to use this ability
}

// =============================================================================
// Unit Stats
// =============================================================================

export interface BaseStats {
  hp: number;
  maxHp: number;
  attack: number; // ATK modifier
  defense: number; // DEF target number
  magic: number; // MAG target number for spells
  resilience: number; // RES modifier for saves
  speed: number; // Speed modifier for initiative
}

export interface HeroStats extends BaseStats {
  mana?: number;
  maxMana?: number;
  ki?: number;
  maxKi?: number;
}

export interface HeroData {
  id: string;
  name: string;
  race: string;
  class: string;
  portrait: string;
  sprite: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  hp: number;
  maxHp: number;
  mana?: number;
  maxMana?: number;
  ki?: number;
  maxKi?: number;
  attack: number;
  defense: number;
  magic: number;
  resilience: number;
  speed: number;
  abilities: string[];
  special?: string; // e.g. "double_action_if_stationary" for Azrael
}

export interface EnemyData {
  id: string;
  name: string;
  sprite: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  magic: number;
  resilience: number;
  speed: number;
  abilities: string[];
  flying?: boolean; // Flying units ignore terrain restrictions
}

// =============================================================================
// Battle Configuration
// =============================================================================

export interface EnemyPlacement {
  type: string; // Enemy type ID
  x: number;
  y: number;
}

export interface Position {
  x: number;
  y: number;
}

// Static prop placement (non-interactable decoration)
export interface PropPlacement {
  sprite: string; // Sprite key e.g. "sprite_meris_left"
  x: number;
  y: number;
  rotation?: number; // Degrees rotation (e.g. 90 for lying down)
}

// Treasure chest placement
export interface ChestPlacement {
  id: string; // Unique chest ID for save state tracking
  x: number;
  y: number;
  facing?: 'north' | 'south' | 'east' | 'west'; // Optional facing direction (default: south)
}

// Cutscene dialogue line with specific speaker
export interface CutsceneLine {
  speaker: string;
  text: string;
  portrait?: string; // Optional portrait key
}

// NPC placement for exploration mode
export interface NPCPlacement {
  id: string; // Unique NPC ID (e.g. "sister_elarra", "villager_1")
  name: string; // Display name
  sprite: string; // Sprite key (e.g. "elarra", "villager_male", "child_female")
  x: number;
  y: number;
  portrait?: string; // Optional portrait key for dialogue
  dialogue: string[]; // Array of dialogue lines
  isShrine?: boolean; // If true, this NPC is a shrine (triggers healing/save instead of dialogue)
  facing?: 'north' | 'south' | 'east' | 'west'; // Optional facing direction (default: south)
}

export interface BattleConfig {
  id: string;
  displayName: string;
  mapImage: string;
  gridWidth: number;
  gridHeight: number;
  terrain: number[][]; // 0=walkable, 1=difficult, 2=impassable
  heroStartPositions: Position[];
  enemies: EnemyPlacement[];
  props?: PropPlacement[]; // Optional static decorations
  chests?: ChestPlacement[]; // Optional treasure chests (lootable after battle)
  npcs?: NPCPlacement[]; // Optional NPCs for exploration mode
  heroPositions?: Position[]; // Positions for party members (not the player) in exploration mode
  victoryCondition: 'defeat_all';
  defeatCondition: 'all_heroes_down';
  introCutscene?: string[] | CutsceneLine[]; // Simple strings or character-specific dialogue
  victoryCutscene?: string[] | CutsceneLine[]; // Simple strings or character-specific dialogue
  postVictoryScene?: string; // Special scene ID to trigger after victory cutscene
  heroFacing?: 'north' | 'south' | 'east' | 'west'; // Initial facing direction for heroes (default: 'south')
  enemyFacing?: 'north' | 'south' | 'east' | 'west'; // Initial facing direction for enemies (default: 'north')
  heroLevel?: number; // Override hero level for testing (default: use saved state or 1)
  postVictoryMode?: 'return_to_town' | 'return_to_sparkworks' | 'explore' | 'transition' | 'to_be_continued'; // What happens after victory (default: return_to_town)
  exitTrigger?: {
    bounds: { x1: number; y1: number; x2: number; y2: number };
    destination: string; // Where to go: 'travel', 'town', 'post_battle_town', 'BattleScene:<map>', or a specific scene name
    fallbackDestination?: string; // Where to go if the battle destination was already completed
  };
  returnPosition?: { x: number; y: number }; // Position on travel map when returning from battle
  playerStart?: { x: number; y: number }; // Player start position for exploration mode (if different from battle end position)
  healPartyOnVictory?: boolean; // Fully heal the party after victory (for story moments before shrines are available)
  heroDialogues?: Record<string, string[]>; // Per-map hero dialogue overrides for exploration mode
}

// =============================================================================
// Runtime Unit (in-battle state)
// =============================================================================

export type Team = 'hero' | 'enemy';

export interface Unit {
  id: string; // Unique instance ID (e.g. "vicas" or "imp_1")
  dataId: string; // Reference to hero/enemy data ID
  name: string;
  team: Team;
  gridX: number;
  gridY: number;
  facing: 'north' | 'south' | 'east' | 'west';

  // Current stats (can be modified by effects)
  currentHp: number;
  maxHp: number;
  currentMana?: number;
  maxMana?: number;
  currentKi?: number;
  maxKi?: number;
  attack: number;
  defense: number;
  magic: number;
  resilience: number;
  speed: number;

  // Abilities
  abilities: string[];

  // Status
  statusEffects: StatusEffect[];
  isUnconscious: boolean;

  // Turn state
  hasMoved: boolean;
  hasActed: boolean;
  actionsRemaining: number; // Usually 1, but Azrael can have 2

  // Special flags
  special?: string;
  flying?: boolean; // Flying units ignore terrain restrictions

  // Equipment (heroes only)
  equipment?: string; // Equipped item ID
  equipmentBonusState?: EquipmentBonusState; // Tracks first-use bonuses this battle

  // Permanent bonuses (heroes only)
  damageBonus?: number; // From +1 Damage Runes

  // Phaser references (set at runtime)
  sprite?: Phaser.GameObjects.Sprite;
  portrait?: string;
  hpBarContainer?: Phaser.GameObjects.Container;
  conditionMarkerContainer?: Phaser.GameObjects.Container;
}

// =============================================================================
// Combat Resolution
// =============================================================================

export interface DiceRoll {
  dice: string; // e.g. "1d20", "2d6"
  rolls: number[]; // Individual die results
  total: number;
  modifier?: number;
  finalTotal?: number; // total + modifier
}

export interface AttackResult {
  attacker: Unit;
  defender: Unit;
  ability: Ability;
  attackRoll: DiceRoll;
  targetNumber: number;
  hit: boolean;
  damageRoll?: DiceRoll;
  totalDamage?: number;
  defenderNewHp?: number;
  defenderDefeated?: boolean;
}

export interface SpellResult {
  caster: Unit;
  target: Unit;
  ability: Ability;
  saveRoll: DiceRoll;
  targetNumber: number;
  savePassed: boolean;
  damageRoll?: DiceRoll;
  totalDamage?: number;
  healingRoll?: DiceRoll;
  totalHealing?: number;
  effectApplied?: StatusEffect;
  targetNewHp?: number;
  targetDefeated?: boolean;
}

// =============================================================================
// Turn Order
// =============================================================================

export interface InitiativeEntry {
  unit: Unit;
  roll: DiceRoll;
  total: number; // roll + speed modifier
}

// =============================================================================
// Battle State
// =============================================================================

export type BattlePhase =
  | 'intro' // Playing intro cutscene
  | 'rolling_initiative' // Rolling initiative for the round
  | 'select_action' // Hero selecting action (move/attack/ability/wait)
  | 'select_move' // Hero selecting movement destination
  | 'select_target' // Hero selecting ability target
  | 'executing_action' // Animation/resolution in progress
  | 'enemy_turn' // AI is deciding/acting
  | 'round_end' // Processing end-of-round effects
  | 'victory' // Battle won
  | 'defeat' // Battle lost
  | 'post_battle_explore'; // Free exploration after victory

export interface BattleState {
  config: BattleConfig;
  round: number;
  phase: BattlePhase;
  turnOrder: InitiativeEntry[];
  currentTurnIndex: number;
  units: Unit[];
  activeUnit: Unit | null;
  selectedAbility: Ability | null;
  highlightedTiles: Position[];
  targetedUnit: Unit | null;
  combatLog: string[];
}

// =============================================================================
// Persistent Zones (e.g. Entangle)
// =============================================================================

export interface Zone {
  id: string; // Unique zone ID
  type: 'entangle'; // Zone type for different behaviors
  originX: number; // Top-left grid X
  originY: number; // Top-left grid Y
  width: number; // Zone width in tiles
  height: number; // Zone height in tiles
  duration: number; // Rounds remaining
  damage: string; // Dice notation for damage
  damageOnSave: 'half' | 'none'; // What happens on save
  casterId: string; // Who created the zone (for XP tracking)
  graphics?: Phaser.GameObjects.Graphics; // Visual outline
}
