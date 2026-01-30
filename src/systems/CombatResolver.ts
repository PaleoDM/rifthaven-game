import {
  Unit,
  Ability,
  AttackResult,
  SpellResult,
  StatusEffect,
} from '../data/BattleTypes';
import { rollAttack, rollDamage, rollSave, rollDice } from './DiceRoller';
import {
  applyDamage,
  applyHealing,
  addStatusEffect,
  hasStatusEffect,
  removeStatusEffect,
  getEffectiveDefense,
  getEffectiveAttack,
  getEffectiveDamageBonus,
  getEffectiveResilience,
} from '../entities/Unit';

/**
 * Combat Resolution System
 * Handles all attack rolls, damage calculations, spell saves, and combat effects
 */

/**
 * Resolve a physical attack (type: 'attack')
 * Attack roll: d20 + attacker.attack vs defender.defense
 * On hit: roll damage dice
 */
export function resolveAttack(
  attacker: Unit,
  defender: Unit,
  ability: Ability
): AttackResult {
  // Roll attack: d20 + effective attack modifier (includes rage/inspired bonuses)
  const effectiveAttack = getEffectiveAttack(attacker);
  const attackRoll = rollAttack(effectiveAttack);

  // Get defender's effective defense (includes buffs/debuffs like dodge)
  const targetNumber = getEffectiveDefense(defender);

  // Determine hit
  const hit = (attackRoll.finalTotal || attackRoll.total) >= targetNumber;

  const result: AttackResult = {
    attacker,
    defender,
    ability,
    attackRoll,
    targetNumber,
    hit,
  };

  if (hit && ability.damage) {
    // Roll damage
    let damageNotation = ability.damage;

    // Check for bonus damage (e.g., Azrael's psychic dagger when hidden)
    if (ability.bonusDamageIfHidden && hasStatusEffect(attacker, 'hidden')) {
      // Roll both and add
      const baseDamage = rollDamage(ability.damage);
      const bonusDamage = rollDamage(ability.bonusDamageIfHidden);

      result.damageRoll = {
        dice: `${ability.damage}+${ability.bonusDamageIfHidden}`,
        rolls: [...baseDamage.rolls, ...bonusDamage.rolls],
        total: baseDamage.total + bonusDamage.total,
        finalTotal: baseDamage.total + bonusDamage.total,
      };
    } else {
      result.damageRoll = rollDamage(damageNotation);
    }

    result.totalDamage = result.damageRoll.finalTotal || result.damageRoll.total;

    // Apply permanent damage bonus from runes (Phase 10 - Permanent Upgrades)
    if (attacker.damageBonus && attacker.damageBonus > 0) {
      result.totalDamage += attacker.damageBonus;
    }

    // Apply status effect damage bonus (e.g., Rage gives +2 damage)
    const statusDamageBonus = getEffectiveDamageBonus(attacker);
    if (statusDamageBonus > 0) {
      result.totalDamage += statusDamageBonus;
    }

    // Minimum 1 damage on hit
    result.totalDamage = Math.max(1, result.totalDamage);

    // Apply damage
    applyDamage(defender, result.totalDamage);
    result.defenderNewHp = defender.currentHp;
    result.defenderDefeated = defender.isUnconscious;

    // Breaking hidden status on attack
    if (hasStatusEffect(attacker, 'hidden')) {
      removeStatusEffect(attacker, 'hidden');
    }

    // Consume exposed status after being hit (it lasts for "next_attack")
    if (hasStatusEffect(defender, 'exposed')) {
      removeStatusEffect(defender, 'exposed');
    }
  }

  // If ability has an effect (like expose_weakness), apply it on hit
  if (hit && ability.effect && ability.type === 'attack') {
    applyAbilityEffect(defender, ability);
  }

  return result;
}

/**
 * Resolve a spell that targets an enemy
 * Save roll: d20 + defender.resilience vs caster.magic
 * Different outcomes based on save success
 */
export function resolveSpell(
  caster: Unit,
  target: Unit,
  ability: Ability
): SpellResult {
  // Save roll: d20 + effective resilience vs caster's magic (inspired gives +2)
  const effectiveResilience = getEffectiveResilience(target);
  const saveRoll = rollSave(effectiveResilience);
  const targetNumber = caster.magic;

  const savePassed = (saveRoll.finalTotal || saveRoll.total) >= targetNumber;

  const result: SpellResult = {
    caster,
    target,
    ability,
    saveRoll,
    targetNumber,
    savePassed,
  };

  // Handle damage spells
  if (ability.damage) {
    const damageRoll = rollDamage(ability.damage);
    result.damageRoll = damageRoll;

    let totalDamage = damageRoll.finalTotal || damageRoll.total;

    // Apply permanent damage bonus from runes (Phase 10 - Permanent Upgrades)
    if (caster.damageBonus && caster.damageBonus > 0) {
      totalDamage += caster.damageBonus;
    }

    // Apply damage reduction on save
    if (savePassed && ability.damageOnSave === 'half') {
      totalDamage = Math.floor(totalDamage / 2);
    } else if (savePassed && ability.damageOnSave === 'none') {
      totalDamage = 0;
    }

    // Minimum 1 damage (unless completely negated by 'none' on save)
    if (!(savePassed && ability.damageOnSave === 'none')) {
      totalDamage = Math.max(1, totalDamage);
    }

    result.totalDamage = totalDamage;

    if (totalDamage > 0) {
      applyDamage(target, totalDamage);
      result.targetNewHp = target.currentHp;
      result.targetDefeated = target.isUnconscious;
    }
  }

  // Handle effects (status conditions)
  if (ability.effect) {
    const effectApplied = applySpellEffect(target, ability, savePassed);
    if (effectApplied) {
      result.effectApplied = effectApplied;
    }
  }

  return result;
}

/**
 * Resolve a healing or buff ability
 */
export function resolveHeal(
  caster: Unit,
  target: Unit,
  ability: Ability
): SpellResult {
  const result: SpellResult = {
    caster,
    target,
    ability,
    saveRoll: { dice: 'none', rolls: [], total: 0 },
    targetNumber: 0,
    savePassed: true, // Heals don't require saves
  };

  // Handle healing
  if (ability.healing) {
    const healingRoll = rollDice(ability.healing);
    result.healingRoll = healingRoll;
    result.totalHealing = healingRoll.finalTotal || healingRoll.total;

    applyHealing(target, result.totalHealing);
    result.targetNewHp = target.currentHp;
  }

  // Handle buff effects
  if (ability.effect) {
    const effectApplied = applyBuffEffect(target, ability);
    if (effectApplied) {
      result.effectApplied = effectApplied;
    }
  }

  return result;
}

/**
 * Resolve a self-targeted ability (like Hide)
 */
export function resolveSelfAbility(
  unit: Unit,
  ability: Ability
): SpellResult {
  const result: SpellResult = {
    caster: unit,
    target: unit,
    ability,
    saveRoll: { dice: 'none', rolls: [], total: 0 },
    targetNumber: 0,
    savePassed: true,
  };

  if (ability.effect) {
    const effectApplied = applyBuffEffect(unit, ability);
    if (effectApplied) {
      result.effectApplied = effectApplied;
    }
  }

  return result;
}

/**
 * Apply an ability's effect as a status condition
 */
function applyAbilityEffect(target: Unit, ability: Ability): void {
  if (!ability.effect) return;

  const effect = ability.effect;

  // For debuffs like "expose_weakness"
  if (effect.type === 'exposed') {
    const statusEffect: StatusEffect = {
      type: 'exposed',
      duration: effect.duration === 'next_attack' ? 1 : (effect.duration as number) || 1,
      value: effect.defensePenalty,
    };
    addStatusEffect(target, statusEffect);
  }
}

/**
 * Apply spell effects based on save result
 */
function applySpellEffect(
  target: Unit,
  ability: Ability,
  savePassed: boolean
): StatusEffect | undefined {
  if (!ability.effect) return undefined;

  const effect = ability.effect;

  // Calculate duration based on save
  let duration: number;
  if (savePassed) {
    if (effect.durationOnSave === undefined || effect.durationOnSave === 0) {
      return undefined; // No effect on save
    }
    duration = typeof effect.durationOnSave === 'number'
      ? effect.durationOnSave
      : rollDice(effect.durationOnSave as string).total;
  } else {
    duration = typeof effect.durationOnFail === 'number'
      ? effect.durationOnFail
      : effect.durationOnFail
        ? rollDice(effect.durationOnFail as string).total
        : 1;
  }

  const statusEffect: StatusEffect = {
    type: effect.type as StatusEffect['type'],
    duration,
  };

  // Add specific values for certain effects
  if (effect.type === 'poison' && effect.damagePerTurn) {
    // Store the damage per turn as a value (we'll parse this when applying)
    statusEffect.value = rollDice(effect.damagePerTurn).total;
  }

  if (effect.type === 'immobilized' || effect.type === 'held') {
    addStatusEffect(target, statusEffect);
    return statusEffect;
  }

  if (effect.type === 'poison') {
    addStatusEffect(target, statusEffect);
    return statusEffect;
  }

  return undefined;
}

/**
 * Apply buff effects (no save required)
 */
function applyBuffEffect(target: Unit, ability: Ability): StatusEffect | undefined {
  if (!ability.effect) return undefined;

  const effect = ability.effect;

  // Handle status removal (Restoration)
  if (effect.type === 'remove_status') {
    // Remove the first negative status effect
    const negativeEffects = target.statusEffects.filter(
      (e) => ['poison', 'held', 'immobilized', 'exposed'].includes(e.type)
    );
    if (negativeEffects.length > 0) {
      removeStatusEffect(target, negativeEffects[0].type);
      return { type: negativeEffects[0].type, duration: 0 }; // Return what was removed
    }
    return undefined;
  }

  // Calculate duration
  let duration: number;
  if (typeof effect.duration === 'number') {
    duration = effect.duration;
  } else if (typeof effect.duration === 'string') {
    duration = rollDice(effect.duration).total;
  } else {
    duration = -1; // Permanent until broken
  }

  const statusEffect: StatusEffect = {
    type: effect.type as StatusEffect['type'],
    duration,
  };

  // Add defense bonuses
  if (effect.defenseBonus) {
    statusEffect.value = effect.defenseBonus;
  }

  addStatusEffect(target, statusEffect);
  return statusEffect;
}

/**
 * Check if a unit can use a specific ability
 * Returns { canUse: boolean, reason?: string }
 */
export function canUseAbility(
  unit: Unit,
  ability: Ability
): { canUse: boolean; reason?: string } {
  // Check mana cost
  if (ability.costType === 'mana') {
    if (!unit.currentMana || unit.currentMana < ability.cost) {
      return { canUse: false, reason: 'Not enough mana' };
    }
  }

  // Check ki cost
  if (ability.costType === 'ki') {
    if (!unit.currentKi || unit.currentKi < ability.cost) {
      return { canUse: false, reason: 'Not enough ki' };
    }
  }

  // Check if already hidden (can't hide again)
  if (ability.id === 'hide' && hasStatusEffect(unit, 'hidden')) {
    return { canUse: false, reason: 'Already hidden' };
  }

  return { canUse: true };
}

/**
 * Deduct the cost of using an ability
 */
export function payAbilityCost(unit: Unit, ability: Ability): void {
  if (ability.costType === 'mana' && unit.currentMana !== undefined) {
    unit.currentMana = Math.max(0, unit.currentMana - ability.cost);
  }

  if (ability.costType === 'ki' && unit.currentKi !== undefined) {
    unit.currentKi = Math.max(0, unit.currentKi - ability.cost);
  }
}

/**
 * Calculate Manhattan distance between two grid positions
 */
export function getDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

/**
 * Check if a target is in range of an ability
 */
export function isInRange(
  attacker: Unit,
  target: Unit,
  ability: Ability
): boolean {
  const distance = getDistance(
    attacker.gridX,
    attacker.gridY,
    target.gridX,
    target.gridY
  );
  return distance <= ability.range;
}

/**
 * Get all valid targets for an ability
 */
export function getValidTargets(
  caster: Unit,
  ability: Ability,
  allUnits: Unit[]
): Unit[] {
  return allUnits.filter((target) => {
    // Check target type
    if (ability.targetType === 'self') {
      // Self-targeting: must be caster and not unconscious
      if (target.isUnconscious) return false;
      return target === caster;
    }

    if (ability.targetType === 'enemy') {
      // Enemy targeting: skip unconscious enemies (can't attack downed foes)
      if (target.isUnconscious) return false;
      return target.team !== caster.team && isInRange(caster, target, ability);
    }

    if (ability.targetType === 'ally') {
      // Ally targeting (heals/buffs): ALLOW unconscious allies for revival!
      return target.team === caster.team && isInRange(caster, target, ability);
    }

    if (ability.targetType === 'area') {
      // For area abilities, we return enemies in range (the area selection is separate)
      if (target.isUnconscious) return false;
      return target.team !== caster.team && isInRange(caster, target, ability);
    }

    return false;
  });
}

/**
 * Format combat result for display
 */
export function formatAttackResult(result: AttackResult): string {
  const { attacker, defender, ability, attackRoll, targetNumber, hit } = result;

  let text = `${attacker.name} uses ${ability.name} on ${defender.name}!\n`;
  text += `Attack: ${attackRoll.rolls[0]} + ${attacker.attack} = ${attackRoll.finalTotal} vs DEF ${targetNumber}\n`;

  if (hit) {
    text += `HIT! `;
    if (result.damageRoll) {
      text += `Damage: ${result.totalDamage}\n`;
    }
    if (result.defenderDefeated) {
      text += `${defender.name} is defeated!`;
    }
  } else {
    text += `MISS!`;
  }

  return text;
}

/**
 * Format spell result for display
 */
export function formatSpellResult(result: SpellResult): string {
  const { caster, target, ability, saveRoll, targetNumber, savePassed } = result;

  let text = `${caster.name} casts ${ability.name}`;
  if (target !== caster) {
    text += ` on ${target.name}`;
  }
  text += `!\n`;

  // Only show save roll for offensive spells
  if (ability.targetType === 'enemy' && saveRoll.dice !== 'none') {
    const effectiveRes = getEffectiveResilience(target);
    text += `Save: ${saveRoll.rolls[0]} + ${effectiveRes} = ${saveRoll.finalTotal} vs MAG ${targetNumber}\n`;
    text += savePassed ? `SAVED! ` : `FAILED! `;
  }

  if (result.totalDamage !== undefined && result.totalDamage > 0) {
    text += `Damage: ${result.totalDamage}\n`;
  }

  if (result.totalHealing !== undefined && result.totalHealing > 0) {
    text += `Healed for ${result.totalHealing}!\n`;
  }

  if (result.effectApplied) {
    text += `${target.name} is now ${result.effectApplied.type}!`;
  }

  if (result.targetDefeated) {
    text += `${target.name} is defeated!`;
  }

  return text;
}
