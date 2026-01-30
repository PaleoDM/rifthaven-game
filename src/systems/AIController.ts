import { Unit, Ability } from '../data/BattleTypes';
import { GridManager } from './GridManager';
import { getDistance } from './CombatResolver';

/**
 * AI Decision Result
 */
export interface AIDecision {
  action: 'move' | 'attack' | 'ability' | 'wait';
  targetPosition?: { x: number; y: number }; // For movement
  targetUnit?: Unit; // For attacks/abilities
  ability?: Ability; // Which ability to use
}

// Base aggro range - actual aggro range is BASE_AGGRO_RANGE + current round
// This allows players to heal/regroup early but prevents turtling indefinitely
const BASE_AGGRO_RANGE = 5;

/**
 * AI Controller for enemy units
 * Handles decision making for enemy turns
 */
export class AIController {
  private gridManager: GridManager;
  private abilities: Record<string, Ability>;

  constructor(gridManager: GridManager, abilities: Record<string, Ability>) {
    this.gridManager = gridManager;
    this.abilities = abilities;
  }

  /**
   * Decide what an enemy unit should do on its turn
   */
  decideAction(
    enemy: Unit,
    allUnits: Unit[],
    hasMoved: boolean,
    hasActed: boolean,
    currentRound: number = 1
  ): AIDecision {
    const heroes = allUnits.filter(u => u.team === 'hero' && !u.isUnconscious);

    if (heroes.length === 0) {
      return { action: 'wait' };
    }

    // Calculate dynamic aggro range - increases each round
    // Round 1: 6 squares, Round 2: 7, Round 3: 8, etc.
    // This lets players regroup early but prevents turtling indefinitely
    const aggroRange = BASE_AGGRO_RANGE + currentRound;

    // Check aggro range - enemies won't pursue until heroes get close
    const closestHeroDistance = Math.min(
      ...heroes.map(h => getDistance(enemy.gridX, enemy.gridY, h.gridX, h.gridY))
    );

    if (closestHeroDistance > aggroRange) {
      // No heroes in aggro range - enemy waits passively
      return { action: 'wait' };
    }

    // Get enemy's abilities
    const enemyAbilities = enemy.abilities
      .map(id => this.abilities[id])
      .filter(a => a !== undefined);

    // Check if we can attack from current position
    if (!hasActed) {
      const attackDecision = this.tryAttack(enemy, heroes, enemyAbilities);
      if (attackDecision) {
        return attackDecision;
      }
    }

    // If we haven't moved, try to get in range of a target
    if (!hasMoved) {
      const moveDecision = this.decideMoveTarget(enemy, heroes, enemyAbilities, allUnits);
      if (moveDecision) {
        return moveDecision;
      }
    }

    // If we moved but haven't attacked, try again
    if (!hasActed) {
      const attackDecision = this.tryAttack(enemy, heroes, enemyAbilities);
      if (attackDecision) {
        return attackDecision;
      }
    }

    return { action: 'wait' };
  }

  /**
   * Try to find an attack or debuff we can make from current position
   */
  private tryAttack(
    enemy: Unit,
    heroes: Unit[],
    abilities: Ability[]
  ): AIDecision | null {
    // Get all offensive abilities (damage, debuffs) that target enemies
    // Filter out buffs that target allies, and abilities we can't afford
    const offensiveAbilities = abilities
      .filter(a => {
        // Must be able to afford the ability
        if (!this.canAffordAbility(enemy, a)) return false;

        // Include attacks
        if (a.type === 'attack') return true;

        // Include spells that target enemies (damage or debuff)
        if (a.type === 'spell' && a.targetType === 'enemy') return true;

        // Include debuffs
        if (a.type === 'debuff') return true;

        return false;
      })
      .sort((a, b) => {
        // Sort by estimated tactical value (damage + debuff value)
        const valueA = this.estimateAbilityValue(a);
        const valueB = this.estimateAbilityValue(b);
        return valueB - valueA;
      });

    // Find best target for each ability
    for (const ability of offensiveAbilities) {
      const target = this.selectTarget(enemy, heroes, ability);
      if (target) {
        return {
          action: ability.type === 'attack' ? 'attack' : 'ability',
          targetUnit: target,
          ability,
        };
      }
    }

    return null;
  }

  /**
   * Select the best target for an ability based on enemy type
   */
  private selectTarget(enemy: Unit, heroes: Unit[], ability: Ability): Unit | null {
    // Get heroes in range
    const inRange = heroes.filter(hero => {
      const dist = getDistance(enemy.gridX, enemy.gridY, hero.gridX, hero.gridY);
      return dist <= ability.range;
    });

    if (inRange.length === 0) return null;

    // For AOE abilities, find the target that would hit the most heroes
    if (ability.targetType === 'area' && ability.areaSize) {
      return this.selectAOETarget(enemy, heroes, ability, inRange);
    }

    // Target prioritization based on enemy type
    const enemyType = enemy.dataId;

    if (enemyType === 'spined_devil') {
      // Boss: prioritize low HP targets for kills, then squishy targets
      return this.prioritizeTarget(inRange, ['lowHp', 'lowDef', 'closest']);
    } else if (enemyType === 'imp') {
      // Imps: opportunistic, go for low HP
      return this.prioritizeTarget(inRange, ['lowHp', 'closest']);
    } else if (enemyType === 'divine_wisp_dark' || enemyType === 'ogre_shaman') {
      // Casters with debuffs: prioritize healers and high-value targets
      // For debuffs, lock down the healer; for damage, go for low HP
      if (ability.effect && !ability.damage) {
        return this.prioritizeTarget(inRange, ['healer', 'lowDef', 'closest']);
      }
      return this.prioritizeTarget(inRange, ['lowHp', 'closest']);
    } else {
      // Lemures and default: just attack closest
      return this.prioritizeTarget(inRange, ['closest']);
    }
  }

  /**
   * Select the best target for an AOE ability
   * Prioritizes targets that would hit the most heroes
   */
  private selectAOETarget(
    _enemy: Unit,
    heroes: Unit[],
    ability: Ability,
    inRange: Unit[]
  ): Unit | null {
    if (!ability.areaSize) return inRange[0];

    const aoeWidth = ability.areaSize.width;
    const aoeHeight = ability.areaSize.height;

    let bestTarget: Unit | null = null;
    let bestHitCount = 0;

    // For each potential target, calculate how many heroes would be hit
    for (const target of inRange) {
      // AOE is centered on target (same logic as executeEnemyAOEAttack)
      const originX = target.gridX - Math.floor(aoeWidth / 2);
      const originY = target.gridY - Math.floor(aoeHeight / 2);

      // Count heroes in this AOE area
      const hitCount = heroes.filter(hero => {
        if (hero.isUnconscious) return false;
        return hero.gridX >= originX &&
               hero.gridX < originX + aoeWidth &&
               hero.gridY >= originY &&
               hero.gridY < originY + aoeHeight;
      }).length;

      if (hitCount > bestHitCount) {
        bestHitCount = hitCount;
        bestTarget = target;
      } else if (hitCount === bestHitCount && bestTarget) {
        // Tie-breaker: prefer lower HP targets
        if (target.currentHp / target.maxHp < bestTarget.currentHp / bestTarget.maxHp) {
          bestTarget = target;
        }
      }
    }

    // Only use AOE if it hits multiple targets, or if no better option
    if (bestHitCount >= 2 || inRange.length === 1) {
      return bestTarget;
    }

    // If AOE would only hit 1 target, still use it (it's still damage)
    return bestTarget || inRange[0];
  }

  /**
   * Prioritize targets based on criteria
   */
  private prioritizeTarget(
    targets: Unit[],
    priorities: ('lowHp' | 'lowDef' | 'closest' | 'healer')[]
  ): Unit {
    let sorted = [...targets];

    for (const priority of priorities) {
      if (priority === 'lowHp') {
        // Sort by HP percentage (lowest first)
        sorted.sort((a, b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp));
      } else if (priority === 'lowDef') {
        // Sort by defense (lowest first) - target squishy units
        sorted.sort((a, b) => a.defense - b.defense);
      } else if (priority === 'healer') {
        // Put healers first (Lyra, anyone with healing abilities)
        sorted.sort((a, b) => {
          const aIsHealer = a.dataId === 'lyra' ? 1 : 0;
          const bIsHealer = b.dataId === 'lyra' ? 1 : 0;
          return bIsHealer - aIsHealer;
        });
      }
      // 'closest' is handled by default order in most cases
    }

    return sorted[0];
  }

  /**
   * Decide where to move to get in attack range
   */
  private decideMoveTarget(
    enemy: Unit,
    heroes: Unit[],
    abilities: Ability[],
    allUnits: Unit[]
  ): AIDecision | null {
    const moveRange = this.gridManager.getMovementRange(
      enemy.gridX,
      enemy.gridY,
      6, // Standard movement
      enemy
    );

    if (moveRange.length === 0) return null;

    // Find the best ability to use (prefer melee for Lemures, ranged for Imps at distance)
    const preferredAbility = this.getPreferredAbility(enemy, abilities, heroes);
    const attackRange = preferredAbility?.range || 1;

    // Find the best position to move to
    let bestPosition: { x: number; y: number } | null = null;
    let bestScore = -Infinity;

    for (const pos of moveRange) {
      const score = this.evaluateMovePosition(
        pos,
        enemy,
        heroes,
        attackRange,
        allUnits
      );
      if (score > bestScore) {
        bestScore = score;
        bestPosition = pos;
      }
    }

    // Also consider staying in place
    const stayScore = this.evaluateMovePosition(
      { x: enemy.gridX, y: enemy.gridY },
      enemy,
      heroes,
      attackRange,
      allUnits
    );

    // Only move if it improves position significantly
    if (bestPosition && bestScore > stayScore + 0.5) {
      return {
        action: 'move',
        targetPosition: bestPosition,
      };
    }

    return null;
  }

  /**
   * Get the preferred ability for an enemy type
   */
  private getPreferredAbility(
    enemy: Unit,
    abilities: Ability[],
    heroes: Unit[]
  ): Ability | null {
    // Get all offensive abilities (attacks, damaging spells, debuffs)
    const offensiveAbilities = abilities.filter(a => {
      if (!this.canAffordAbility(enemy, a)) return false;
      if (a.type === 'attack') return true;
      if (a.type === 'spell' && a.targetType === 'enemy') return true;
      if (a.type === 'debuff') return true;
      return false;
    });

    if (offensiveAbilities.length === 0) return null;

    const enemyType = enemy.dataId;

    if (enemyType === 'imp') {
      // Imps: prefer ranged if not adjacent to any hero
      const adjacentHero = heroes.some(
        h => getDistance(enemy.gridX, enemy.gridY, h.gridX, h.gridY) <= 1
      );
      if (!adjacentHero) {
        const ranged = offensiveAbilities.find(a => a.range > 1);
        if (ranged) return ranged;
      }
    }

    // Shadow wisps and similar casters: prefer debuffs at range
    if (enemyType === 'divine_wisp_dark' || enemyType === 'ogre_shaman') {
      const debuffs = offensiveAbilities.filter(a =>
        a.effect && !a.damage && a.range > 1
      );
      if (debuffs.length > 0) {
        // Prefer hold over other debuffs
        const hold = debuffs.find(a => a.id === 'hold');
        if (hold) return hold;
        return debuffs[0];
      }
    }

    // Default: prefer highest tactical value
    return offensiveAbilities.sort((a, b) => {
      const valueA = this.estimateAbilityValue(a);
      const valueB = this.estimateAbilityValue(b);
      return valueB - valueA;
    })[0];
  }

  /**
   * Evaluate how good a movement position is
   */
  private evaluateMovePosition(
    pos: { x: number; y: number },
    enemy: Unit,
    heroes: Unit[],
    desiredRange: number,
    _allUnits: Unit[]
  ): number {
    let score = 0;

    // Find closest hero
    let closestHeroDist = Infinity;
    let targetHero: Unit | null = null;

    for (const hero of heroes) {
      const dist = getDistance(pos.x, pos.y, hero.gridX, hero.gridY);
      if (dist < closestHeroDist) {
        closestHeroDist = dist;
        targetHero = hero;
      }
    }

    if (!targetHero) return -1000;

    // Reward being in attack range
    if (closestHeroDist <= desiredRange) {
      score += 100;
    }

    // Reward getting closer to heroes (inverse distance)
    score -= closestHeroDist * 5;

    // For ranged enemies (Imps), prefer to stay at range 2 if possible
    if (enemy.dataId === 'imp' && desiredRange > 1) {
      if (closestHeroDist === 2) {
        score += 20; // Bonus for optimal range
      } else if (closestHeroDist === 1) {
        score -= 10; // Slight penalty for being too close
      }
    }

    // Shadow Wisps: ranged casters that prefer range 2 for debuffs
    if (enemy.dataId === 'divine_wisp_dark') {
      if (closestHeroDist === 2) {
        score += 25; // Strong bonus for optimal debuff range
      } else if (closestHeroDist === 1) {
        score -= 15; // Penalty for being in melee (squishy caster)
      }
    }

    // Spined Devil prefers to engage multiple targets
    if (enemy.dataId === 'spined_devil') {
      const heroesInMeleeRange = heroes.filter(
        h => getDistance(pos.x, pos.y, h.gridX, h.gridY) <= 1
      ).length;
      score += heroesInMeleeRange * 15;
    }

    return score;
  }

  /**
   * Estimate average damage from dice notation
   */
  private estimateDamage(dice: string): number {
    // Parse dice notation like "1d6", "2d8", "3d6"
    const match = dice.match(/(\d+)d(\d+)/);
    if (!match) return 0;
    const count = parseInt(match[1]);
    const sides = parseInt(match[2]);
    return count * ((sides + 1) / 2); // Average roll
  }

  /**
   * Estimate the tactical value of any ability (damage, debuffs, buffs)
   * Returns an estimated "effective damage" value for AI decision-making
   */
  private estimateAbilityValue(ability: Ability): number {
    // Direct damage abilities
    if (ability.damage) {
      return this.estimateDamage(ability.damage);
    }

    // Effect-based abilities (debuffs, DoTs, healing)
    if (ability.effect) {
      const effect = ability.effect;

      // Hold/stun effects - taking a hero out of action is very valuable
      if (effect.type === 'held') {
        return 10; // Equivalent to negating ~10 damage worth of hero actions
      }

      // Poison effects - DoT damage over time
      if (effect.type === 'poison' && effect.damagePerTurn) {
        const dotDamage = this.estimateDamage(effect.damagePerTurn);
        const avgDuration = effect.durationOnFail
          ? (typeof effect.durationOnFail === 'string'
              ? this.estimateDamage(effect.durationOnFail)
              : effect.durationOnFail)
          : 3;
        return dotDamage * avgDuration * 0.7; // Discount for delayed damage
      }

      // Immobilize effects
      if (effect.type === 'immobilized') {
        return 6; // Less valuable than hold but still useful
      }

      // Exposed/defense reduction
      if (effect.type === 'exposed') {
        return 5; // Sets up follow-up attacks
      }
    }

    // Healing abilities (for ally targeting)
    if (ability.healing) {
      return this.estimateDamage(ability.healing);
    }

    return 0;
  }

  /**
   * Check if enemy can afford to use an ability (has enough mana/ki)
   */
  private canAffordAbility(enemy: Unit, ability: Ability): boolean {
    if (!ability.cost || ability.cost === 0) return true;

    if (ability.costType === 'mana') {
      return (enemy.currentMana ?? 0) >= ability.cost;
    }
    if (ability.costType === 'ki') {
      return (enemy.currentKi ?? 0) >= ability.cost;
    }

    return true;
  }

  /**
   * Find path to get adjacent to a target
   */
  findPathToTarget(
    enemy: Unit,
    target: Unit,
    _allUnits: Unit[]
  ): { x: number; y: number }[] | null {
    // Try to find path to each adjacent tile of target
    const adjacentTiles = [
      { x: target.gridX - 1, y: target.gridY },
      { x: target.gridX + 1, y: target.gridY },
      { x: target.gridX, y: target.gridY - 1 },
      { x: target.gridX, y: target.gridY + 1 },
    ];

    let bestPath: { x: number; y: number }[] | null = null;

    for (const tile of adjacentTiles) {
      const path = this.gridManager.findPath(
        enemy.gridX,
        enemy.gridY,
        tile.x,
        tile.y,
        enemy
      );
      if (path && (!bestPath || path.length < bestPath.length)) {
        bestPath = path;
      }
    }

    return bestPath;
  }
}
