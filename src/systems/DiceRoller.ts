import { DiceRoll } from '../data/BattleTypes';

/**
 * Dice rolling utility for the combat system
 * Supports standard dice notation (e.g., "1d20", "2d6+3")
 */

/**
 * Roll a single die with the given number of sides
 */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parse dice notation and roll
 * Supports: "1d20", "2d6", "1d8+2", "3d6-1"
 */
export function rollDice(notation: string): DiceRoll {
  // Parse notation like "2d6+3" or "1d20"
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);

  if (!match) {
    console.error(`Invalid dice notation: ${notation}`);
    return {
      dice: notation,
      rolls: [0],
      total: 0,
    };
  }

  const numDice = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  const rolls: number[] = [];
  let total = 0;

  for (let i = 0; i < numDice; i++) {
    const roll = rollDie(sides);
    rolls.push(roll);
    total += roll;
  }

  return {
    dice: notation,
    rolls,
    total,
    modifier: modifier !== 0 ? modifier : undefined,
    finalTotal: total + modifier,
  };
}

/**
 * Roll initiative: d20 + speed modifier
 */
export function rollInitiative(speedModifier: number): DiceRoll {
  const roll = rollDie(20);
  return {
    dice: '1d20',
    rolls: [roll],
    total: roll,
    modifier: speedModifier,
    finalTotal: roll + speedModifier,
  };
}

/**
 * Roll an attack: d20 + attack modifier
 */
export function rollAttack(attackModifier: number): DiceRoll {
  const roll = rollDie(20);
  return {
    dice: '1d20',
    rolls: [roll],
    total: roll,
    modifier: attackModifier,
    finalTotal: roll + attackModifier,
  };
}

/**
 * Roll a saving throw: d20 + resilience modifier
 */
export function rollSave(resilienceModifier: number): DiceRoll {
  const roll = rollDie(20);
  return {
    dice: '1d20',
    rolls: [roll],
    total: roll,
    modifier: resilienceModifier,
    finalTotal: roll + resilienceModifier,
  };
}

/**
 * Roll damage using dice notation
 */
export function rollDamage(notation: string): DiceRoll {
  return rollDice(notation);
}

/**
 * Format a dice roll for display
 * e.g., "1d20+3 = [15] + 3 = 18"
 */
export function formatRoll(roll: DiceRoll): string {
  const rollsStr = roll.rolls.length > 1
    ? `[${roll.rolls.join(', ')}]`
    : `[${roll.rolls[0]}]`;

  if (roll.modifier && roll.modifier !== 0) {
    const sign = roll.modifier > 0 ? '+' : '';
    return `${roll.dice} = ${rollsStr} ${sign}${roll.modifier} = ${roll.finalTotal}`;
  }

  return `${roll.dice} = ${rollsStr} = ${roll.total}`;
}
