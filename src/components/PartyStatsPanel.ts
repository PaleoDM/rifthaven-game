import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { HeroState, SaveManager } from '../systems/SaveManager';
import { ProgressBar } from './ProgressBar';

// Level thresholds (matching XPTracker)
const LEVEL_THRESHOLDS = [
  { level: 1, xp: 0 },
  { level: 2, xp: 50 },
  { level: 3, xp: 125 },
  { level: 4, xp: 250 },
  { level: 5, xp: 400 },
];

interface HeroData {
  id: string;
  name: string;
  race: string;
  class: string;
  portrait: string;
  abilities: string[];
  maxHp: number;
  maxMana?: number;
  maxKi?: number;
  attack: number;
  defense: number;
  magic: number;
  resilience: number;
  speed: number;
}

interface AbilityData {
  id: string;
  name: string;
  description: string;
  type: string;
  cost: number;
  costType: string | null;
  range: number;
  levelRequired?: number;
}

interface HeroCard {
  container: Phaser.GameObjects.Container;
  hpBar: ProgressBar;
  mpBar: ProgressBar | null;
  xpBar: ProgressBar;
}

/**
 * Panel showing all party member stats
 * Two-column layout with scrolling support
 */
export class PartyStatsPanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private heroState: Record<string, HeroState>;
  private heroesData: Record<string, HeroData>;
  private abilitiesData: Record<string, AbilityData>;

  private heroCards: HeroCard[] = [];
  private scrollOffset: number = 0;
  private maxScroll: number = 0;

  // Layout constants
  private readonly PANEL_PADDING = 20;
  private readonly CARD_WIDTH = 370;
  private readonly CARD_HEIGHT = 200;
  private readonly CARD_GAP = 15;
  private readonly COLUMNS = 2;

  constructor(
    scene: Phaser.Scene,
    heroState: Record<string, HeroState>,
    heroesData: Record<string, HeroData>,
    abilitiesData: Record<string, AbilityData>,
    cameraZoom: number = 1
  ) {
    this.scene = scene;
    this.heroState = heroState;
    this.heroesData = heroesData;
    this.abilitiesData = abilitiesData;

    // Create main container
    // Scale inversely to camera zoom so UI appears at correct size
    const uiScale = 1 / cameraZoom;
    this.container = scene.add.container(0, 0);
    this.container.setScale(uiScale);
    this.container.setDepth(1001);
    this.container.setScrollFactor(0);

    this.createPanel();
  }

  private createPanel(): void {
    // Full screen semi-transparent background
    const bg = this.scene.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      GAME_CONFIG.WIDTH - 20,
      GAME_CONFIG.HEIGHT - 20,
      0x000000,
      0.95
    );
    this.container.add(bg);

    // Border
    const border = this.scene.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      GAME_CONFIG.WIDTH - 20,
      GAME_CONFIG.HEIGHT - 20
    );
    border.setStrokeStyle(2, 0xffffff);
    border.setFillStyle(0x000000, 0);
    this.container.add(border);

    // Title
    const title = this.scene.add.text(
      GAME_CONFIG.WIDTH / 2,
      25,
      'PARTY STATUS',
      {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffff00',
      }
    );
    title.setOrigin(0.5, 0.5);
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(title);

    // Hint text
    const hint = this.scene.add.text(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT - 18,
      'Arrow keys to scroll | ESC to close',
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#666666',
      }
    );
    hint.setOrigin(0.5, 0.5);
    hint.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(hint);

    // Create hero cards
    this.createHeroCards();
  }

  private createHeroCards(): void {
    const heroIds = Object.keys(this.heroState);
    const startX = this.PANEL_PADDING + 5;
    const startY = 50;

    heroIds.forEach((heroId, index) => {
      const heroData = this.heroesData[heroId];
      const state = this.heroState[heroId];
      if (!heroData || !state) return;

      // Calculate position (2-column layout)
      const col = index % this.COLUMNS;
      const row = Math.floor(index / this.COLUMNS);
      const x = startX + col * (this.CARD_WIDTH + this.CARD_GAP);
      const y = startY + row * (this.CARD_HEIGHT + this.CARD_GAP);

      const card = this.createHeroCard(heroId, heroData, state, x, y);
      this.heroCards.push(card);
    });

    // Calculate max scroll
    const totalRows = Math.ceil(heroIds.length / this.COLUMNS);
    const contentHeight = totalRows * (this.CARD_HEIGHT + this.CARD_GAP);
    const viewHeight = GAME_CONFIG.HEIGHT - 80;
    this.maxScroll = Math.max(0, contentHeight - viewHeight);
  }

  private createHeroCard(
    heroId: string,
    heroData: HeroData,
    state: HeroState,
    x: number,
    y: number
  ): HeroCard {
    const cardContainer = this.scene.add.container(x, y);
    this.container.add(cardContainer);

    // Card background
    const cardBg = this.scene.add.rectangle(
      this.CARD_WIDTH / 2,
      this.CARD_HEIGHT / 2,
      this.CARD_WIDTH,
      this.CARD_HEIGHT,
      0x1a1a2e,
      0.9
    );
    cardContainer.add(cardBg);

    // Card border
    const cardBorder = this.scene.add.rectangle(
      this.CARD_WIDTH / 2,
      this.CARD_HEIGHT / 2,
      this.CARD_WIDTH,
      this.CARD_HEIGHT
    );
    cardBorder.setStrokeStyle(1, 0x444466);
    cardBorder.setFillStyle(0x000000, 0);
    cardContainer.add(cardBorder);

    // Portrait (small)
    const portraitSize = 48;
    const portrait = this.scene.add.image(portraitSize / 2 + 8, portraitSize / 2 + 8, heroData.portrait);
    portrait.setDisplaySize(portraitSize, portraitSize);
    cardContainer.add(portrait);

    // Name and class
    const nameText = this.scene.add.text(
      portraitSize + 18,
      8,
      `${heroData.name} (Lv ${state.level})`,
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffff00',
      }
    );
    nameText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    cardContainer.add(nameText);

    const classText = this.scene.add.text(
      portraitSize + 18,
      24,
      `${heroData.race} ${heroData.class}`,
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#888888',
      }
    );
    classText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    cardContainer.add(classText);

    // Stats section (right side of portrait area)
    const statsX = portraitSize + 18;
    const statsY = 42;

    // Get max values for this hero at their level
    const maxHp = SaveManager.getMaxHp(heroId, state.level);
    const maxMana = SaveManager.getMaxMana(heroId, state.level);
    const maxKi = state.currentKi !== undefined ? SaveManager.getMaxKi(state.level) : null;

    // HP Bar
    const hpLabel = this.scene.add.text(statsX, statsY, 'HP', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ff6666',
    });
    hpLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    cardContainer.add(hpLabel);

    const hpBar = new ProgressBar(this.scene, {
      x: 0,
      y: 0,
      width: 100,
      height: 12,
      fillColor: this.getHpColor(state.currentHp, maxHp),
      backgroundColor: 0x333333,
      borderColor: 0x666666,
      showText: true,
      textFormat: 'fraction',
    });
    hpBar.setValue(state.currentHp, maxHp);
    hpBar.addToContainer(cardContainer);
    // Position the bar elements (they were created at 0,0)
    this.repositionBarInContainer(cardContainer, statsX + 25, statsY - 2);

    // MP/Ki Bar
    let mpBar: ProgressBar | null = null;
    const mpY = statsY + 16;

    if (maxKi !== null) {
      // Hero uses Ki
      const kiLabel = this.scene.add.text(statsX, mpY, 'Ki', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffcc00',
      });
      kiLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      cardContainer.add(kiLabel);

      mpBar = new ProgressBar(this.scene, {
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        fillColor: 0xffcc00,
        backgroundColor: 0x333333,
        borderColor: 0x666666,
        showText: true,
        textFormat: 'fraction',
      });
      mpBar.setValue(state.currentKi || 0, maxKi);
      mpBar.addToContainer(cardContainer);
      this.repositionBarInContainer(cardContainer, statsX + 25, mpY - 2);
    } else if (maxMana !== null) {
      // Uses Mana
      const mpLabel = this.scene.add.text(statsX, mpY, 'MP', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#6666ff',
      });
      mpLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      cardContainer.add(mpLabel);

      mpBar = new ProgressBar(this.scene, {
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        fillColor: 0x6666ff,
        backgroundColor: 0x333333,
        borderColor: 0x666666,
        showText: true,
        textFormat: 'fraction',
      });
      mpBar.setValue(state.currentMana || 0, maxMana);
      mpBar.addToContainer(cardContainer);
      this.repositionBarInContainer(cardContainer, statsX + 25, mpY - 2);
    }

    // XP Bar
    const xpY = mpY + 16;
    const xpLabel = this.scene.add.text(statsX, xpY, 'XP', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#66ff66',
    });
    xpLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    cardContainer.add(xpLabel);

    const xpToNext = this.getXpToNextLevel(state.level);
    const xpIntoLevel = this.getXpIntoCurrentLevel(state.xp, state.level);

    const xpBar = new ProgressBar(this.scene, {
      x: 0,
      y: 0,
      width: 100,
      height: 12,
      fillColor: 0x66ff66,
      backgroundColor: 0x333333,
      borderColor: 0x666666,
      showText: true,
      textFormat: 'fraction',
    });
    xpBar.setValue(xpIntoLevel, xpToNext);
    xpBar.addToContainer(cardContainer);
    this.repositionBarInContainer(cardContainer, statsX + 25, xpY - 2);

    // Combat stats (below bars)
    const combatY = 90;
    const statCol1X = 10;
    const statCol2X = 95;
    const statCol3X = 180;

    const statStyle = {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#aaaaaa',
    };

    // Helper to create high-res stat text
    const addStatText = (x: number, y: number, content: string) => {
      const text = this.scene.add.text(x, y, content, statStyle);
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      cardContainer.add(text);
    };

    // Column 1
    addStatText(statCol1X, combatY, `ATK: +${heroData.attack}`);
    addStatText(statCol1X, combatY + 14, `DEF: ${heroData.defense}`);

    // Column 2
    addStatText(statCol2X, combatY, `MAG: +${heroData.magic}`);
    addStatText(statCol2X, combatY + 14, `RES: +${heroData.resilience}`);

    // Column 3
    addStatText(statCol3X, combatY, `SPD: ${heroData.speed}`);
    addStatText(statCol3X, combatY + 14, `MOV: 4`);

    // Abilities section
    const abilitiesY = 125;
    const abilitiesLabel = this.scene.add.text(10, abilitiesY, 'Abilities:', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffff00',
    });
    abilitiesLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    cardContainer.add(abilitiesLabel);

    // Get unlocked abilities for this hero at their level
    const unlockedAbilities = this.getUnlockedAbilities(heroData, state.level);

    let abilityY = abilitiesY + 14;
    const maxAbilitiesToShow = 4;
    const displayedAbilities = unlockedAbilities.slice(0, maxAbilitiesToShow);

    displayedAbilities.forEach((ability) => {
      const costText = ability.cost > 0
        ? ` (${ability.cost} ${ability.costType === 'ki' ? 'Ki' : 'MP'})`
        : '';
      const rangeText = ability.range === 0 ? 'Self' : ability.range === 1 ? 'Melee' : `Range ${ability.range}`;

      const abilityText = this.scene.add.text(
        15,
        abilityY,
        `- ${ability.name}${costText} [${rangeText}]`,
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#cccccc',
        }
      );
      abilityText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      cardContainer.add(abilityText);
      abilityY += 13;
    });

    // Show locked abilities count if any
    const lockedCount = heroData.abilities.length - unlockedAbilities.length;
    if (lockedCount > 0) {
      const lockedText = this.scene.add.text(
        15,
        abilityY,
        `+ ${lockedCount} more at higher levels`,
        {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#666666',
        }
      );
      lockedText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      cardContainer.add(lockedText);
    }

    return {
      container: cardContainer,
      hpBar,
      mpBar,
      xpBar,
    };
  }

  /**
   * Reposition the last 4 elements added (border, bg, fill, text) of a progress bar
   */
  private repositionBarInContainer(container: Phaser.GameObjects.Container, x: number, y: number): void {
    const children = container.list;
    const barElements = children.slice(-4); // Last 4 elements are the bar parts

    barElements.forEach((element) => {
      if (element instanceof Phaser.GameObjects.Rectangle || element instanceof Phaser.GameObjects.Text) {
        element.setPosition(element.x + x, element.y + y);
      }
    });
  }

  private getHpColor(current: number, max: number): number {
    const percentage = current / max;
    if (percentage > 0.5) return 0x00ff00; // Green
    if (percentage > 0.25) return 0xffff00; // Yellow
    return 0xff0000; // Red
  }

  private getXpToNextLevel(currentLevel: number): number {
    const nextThreshold = LEVEL_THRESHOLDS.find(t => t.level === currentLevel + 1);
    const currentThreshold = LEVEL_THRESHOLDS.find(t => t.level === currentLevel);

    if (!nextThreshold) {
      // Max level - show full bar
      return 100;
    }

    return nextThreshold.xp - (currentThreshold?.xp || 0);
  }

  private getXpIntoCurrentLevel(totalXp: number, currentLevel: number): number {
    const currentThreshold = LEVEL_THRESHOLDS.find(t => t.level === currentLevel);
    const nextThreshold = LEVEL_THRESHOLDS.find(t => t.level === currentLevel + 1);

    if (!nextThreshold) {
      // Max level
      return 100;
    }

    return totalXp - (currentThreshold?.xp || 0);
  }

  private getUnlockedAbilities(heroData: HeroData, heroLevel: number): AbilityData[] {
    const unlocked: AbilityData[] = [];

    for (const abilityId of heroData.abilities) {
      const ability = this.abilitiesData[abilityId];
      if (!ability) continue;

      const levelRequired = ability.levelRequired ?? 1;
      if (heroLevel >= levelRequired) {
        unlocked.push(ability);
      }
    }

    return unlocked;
  }

  /**
   * Handle scrolling input
   */
  handleInput(upKey: Phaser.Input.Keyboard.Key, downKey: Phaser.Input.Keyboard.Key): void {
    if (this.maxScroll <= 0) return;

    const scrollSpeed = 20;

    if (Phaser.Input.Keyboard.JustDown(upKey)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - scrollSpeed);
      this.updateScroll();
    }
    if (Phaser.Input.Keyboard.JustDown(downKey)) {
      this.scrollOffset = Math.min(this.maxScroll, this.scrollOffset + scrollSpeed);
      this.updateScroll();
    }
  }

  private updateScroll(): void {
    this.heroCards.forEach((card) => {
      // Offset the Y position based on scroll
      // This is a simplified approach - for more cards we'd use a mask
      card.container.y -= this.scrollOffset;
    });
  }

  /**
   * Destroy the panel
   */
  destroy(): void {
    this.heroCards.forEach((card) => {
      card.hpBar.destroy();
      card.mpBar?.destroy();
      card.xpBar.destroy();
    });
    this.container.destroy(true);
  }
}
