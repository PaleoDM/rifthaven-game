import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { HeroState, SaveManager } from '../systems/SaveManager';
import { ProgressBar } from '../components/ProgressBar';
import { ItemData, InventoryState, CONSUMABLE_IDS, ConsumableId } from '../data/ItemTypes';

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
  movement?: number;
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

type MenuView = 'main' | 'party' | 'inventory' | 'combat' | 'hrothgar' | 'equipment' | 'rune';

interface MenuSceneData {
  heroState: Record<string, HeroState>;
  returnScene: string;
  initialView?: MenuView;
  inventory?: InventoryState;
}

/**
 * Full-screen menu scene that overlays the game
 * Accessible via ESC key from town, travel, and battle scenes
 */
export class MenuScene extends Phaser.Scene {
  private heroState: Record<string, HeroState> = {};
  private heroesData: Record<string, HeroData> = {};
  private abilitiesData: Record<string, AbilityData> = {};
  private itemsData: Record<string, ItemData> = {};
  private inventory: InventoryState | null = null;
  private returnScene: string = '';

  private currentView: MenuView = 'main';
  private menuSelectedIndex: number = 0;
  private menuOptions: string[] = ['Party', 'Inventory', 'Combat', 'Close'];
  private menuTexts: Phaser.GameObjects.Text[] = [];

  // Input
  private escKey!: Phaser.Input.Keyboard.Key;
  private upKey!: Phaser.Input.Keyboard.Key;
  private downKey!: Phaser.Input.Keyboard.Key;
  private leftKey!: Phaser.Input.Keyboard.Key;
  private rightKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private tabKey!: Phaser.Input.Keyboard.Key;

  // Layout constants
  private readonly SIDEBAR_WIDTH = 220;
  private readonly CONTENT_X = 240;
  private readonly CONTENT_WIDTH = 540;

  // Content area elements (cleared when switching views)
  private contentElements: Phaser.GameObjects.GameObject[] = [];

  // Party view
  private partyHeroIds: string[] = [];
  private partySelectedIndex: number = 0;
  private partyElements: Phaser.GameObjects.GameObject[] = [];
  private progressBars: ProgressBar[] = [];

  // Combat view
  private combatMenuOptions: string[] = ['General', 'Experience', 'Movement', 'Conditions', 'HP', 'Arden', 'Quin', 'Veil', 'Ty', 'Thorn'];
  private combatSelectedIndex: number = 0;
  private combatMenuTexts: Phaser.GameObjects.Text[] = [];
  private combatContentScrollOffset: number = 0;
  private combatContentMaxScroll: number = 0;

  // Inventory view
  private inventoryElements: Phaser.GameObjects.GameObject[] = [];

  // Hrothgar view (choice menu)
  private hrothgarMenuOptions: string[] = ['Combat Guide', 'Manage Equipment', 'Close'];
  private hrothgarSelectedIndex: number = 0;
  private hrothgarMenuTexts: Phaser.GameObjects.Text[] = [];
  private hrothgarElements: Phaser.GameObjects.GameObject[] = [];

  // Equipment management view
  private equipmentElements: Phaser.GameObjects.GameObject[] = [];
  private equipmentHeroIndex: number = 0;
  private equipmentItemIndex: number = 0;
  private equipmentMode: 'hero' | 'item' = 'hero';

  // Rune application view
  private runeElements: Phaser.GameObjects.GameObject[] = [];
  private runeHeroIndex: number = 0;
  private runeConfirmMode: boolean = false;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(data: MenuSceneData): void {
    this.heroState = data.heroState || {};
    this.returnScene = data.returnScene || 'IshetarScene1';
    this.inventory = data.inventory || null;

    // Load data from cache
    this.heroesData = this.cache.json.get('data_heroes') || {};
    this.abilitiesData = this.cache.json.get('data_abilities') || {};
    this.itemsData = this.cache.json.get('data_items') || {};

    // Get party hero IDs
    this.partyHeroIds = Object.keys(this.heroState);

    // Reset state
    this.currentView = 'main';
    this.menuSelectedIndex = 0;
    this.partySelectedIndex = 0;
    this.combatSelectedIndex = 0;
    this.hrothgarSelectedIndex = 0;
    this.equipmentHeroIndex = 0;
    this.equipmentItemIndex = 0;
    this.equipmentMode = 'hero';
    this.partyElements = [];
    this.progressBars = [];
    this.combatMenuTexts = [];
    this.hrothgarMenuTexts = [];
    this.hrothgarElements = [];
    this.equipmentElements = [];
    this.runeElements = [];
    this.runeHeroIndex = 0;
    this.runeConfirmMode = false;

    // Setup input
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.upKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.downKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.leftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.rightKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.tabKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);

    // Draw background
    this.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      GAME_CONFIG.WIDTH,
      GAME_CONFIG.HEIGHT,
      0x000000,
      0.95
    );

    // Draw sidebar
    this.createSidebar();

    // Show initial view (default to main menu)
    if (data.initialView === 'combat') {
      this.menuSelectedIndex = 2; // Combat is index 2
      this.updateMenuSelection();
      this.showCombatView();
    } else if (data.initialView === 'party') {
      this.menuSelectedIndex = 0;
      this.updateMenuSelection();
      this.showPartyView();
    } else if (data.initialView === 'hrothgar') {
      // Hrothgar's shop - show choice menu (no sidebar highlight)
      this.showHrothgarView();
    } else {
      this.showMainMenu();
    }
  }

  private createSidebar(): void {
    // Sidebar background
    this.add.rectangle(
      this.SIDEBAR_WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      this.SIDEBAR_WIDTH,
      GAME_CONFIG.HEIGHT,
      0x1a1a2e,
      1
    );

    // Sidebar border
    this.add.rectangle(
      this.SIDEBAR_WIDTH,
      GAME_CONFIG.HEIGHT / 2,
      2,
      GAME_CONFIG.HEIGHT,
      0x4a4a6a,
      1
    );

    // Title
    this.add.text(this.SIDEBAR_WIDTH / 2, 30, 'MENU', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#f0d866',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);

    // Menu options
    const startY = 100;
    const lineHeight = 40;

    this.menuTexts = [];
    this.menuOptions.forEach((option, index) => {
      const text = this.add.text(20, startY + index * lineHeight, option, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.menuTexts.push(text);
    });

    this.updateMenuSelection();

    // Instructions at bottom
    this.add.text(this.SIDEBAR_WIDTH / 2, GAME_CONFIG.HEIGHT - 30, 'ESC to close', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
  }

  private updateMenuSelection(): void {
    this.menuTexts.forEach((text, index) => {
      if (index === this.menuSelectedIndex) {
        text.setText('> ' + this.menuOptions[index]);
        text.setColor('#f0d866');
      } else {
        text.setText('  ' + this.menuOptions[index]);
        text.setColor('#ffffff');
      }
    });
  }

  private showMainMenu(): void {
    this.currentView = 'main';
    this.clearContent();

    // Show welcome message in content area
    const welcomeText = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      'Select an option from the menu',
      {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
    this.contentElements.push(welcomeText);
  }

  private clearContent(): void {
    // Destroy content elements (like welcome text)
    this.contentElements.forEach(el => el.destroy());
    this.contentElements = [];

    // Destroy party elements
    this.partyElements.forEach(el => el.destroy());
    this.partyElements = [];

    // Destroy progress bars
    this.progressBars.forEach(bar => bar.destroy());
    this.progressBars = [];

    // Destroy combat menu texts
    this.combatMenuTexts.forEach(el => el.destroy());
    this.combatMenuTexts = [];

    // Destroy inventory elements
    this.inventoryElements.forEach(el => el.destroy());
    this.inventoryElements = [];

    // Destroy hrothgar elements
    this.hrothgarMenuTexts.forEach(el => el.destroy());
    this.hrothgarMenuTexts = [];
    this.hrothgarElements.forEach(el => el.destroy());
    this.hrothgarElements = [];

    // Destroy equipment elements
    this.equipmentElements.forEach(el => el.destroy());
    this.equipmentElements = [];

    // Destroy rune elements
    this.runeElements.forEach(el => el.destroy());
    this.runeElements = [];
  }

  private showPartyView(): void {
    this.currentView = 'party';
    this.clearContent();

    if (this.partyHeroIds.length === 0) {
      this.add.text(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2,
        'No party members',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#888888',
        }
      ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      return;
    }

    // Title
    const title = this.add.text(this.CONTENT_X + 20, 20, 'Party Members', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f0d866',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.partyElements.push(title);

    // Navigation hint
    const hint = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH - 20,
      20,
      'Up/Down to browse | ESC to go back',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.partyElements.push(hint);

    // Show selected hero details
    this.renderHeroCard(this.partyHeroIds[this.partySelectedIndex]);
  }

  private renderHeroCard(heroId: string): void {
    // Clear previous card elements (keep title and hint)
    const keepElements = this.partyElements.slice(0, 2);
    this.partyElements.slice(2).forEach(el => el.destroy());
    this.partyElements = keepElements;

    this.progressBars.forEach(bar => bar.destroy());
    this.progressBars = [];

    const heroData = this.heroesData[heroId];
    const state = this.heroState[heroId];

    if (!heroData || !state) return;

    const cardX = this.CONTENT_X + 20;
    const cardY = 60;
    const cardWidth = this.CONTENT_WIDTH - 40;
    const cardHeight = GAME_CONFIG.HEIGHT - 100;

    // Card background
    const cardBg = this.add.rectangle(
      cardX + cardWidth / 2,
      cardY + cardHeight / 2,
      cardWidth,
      cardHeight,
      0x2a2a4a,
      0.8
    );
    this.partyElements.push(cardBg);

    // Card border
    const cardBorder = this.add.rectangle(
      cardX + cardWidth / 2,
      cardY + cardHeight / 2,
      cardWidth,
      cardHeight,
      0x4a4a6a,
      0
    ).setStrokeStyle(2, 0x4a4a6a);
    this.partyElements.push(cardBorder);

    // Portrait on the right side (under the counter)
    const portraitSize = 80;
    const portrait = this.add.image(
      cardX + cardWidth - 55,
      cardY + 70,
      `portrait_${heroId}`
    );
    portrait.setDisplaySize(portraitSize, portraitSize);
    this.partyElements.push(portrait);

    // Hero counter (1/4, 2/4, etc.) - above portrait
    const counter = this.add.text(
      cardX + cardWidth - 55,
      cardY + 15,
      `${this.partySelectedIndex + 1}/${this.partyHeroIds.length}`,
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
    this.partyElements.push(counter);

    // Name and class on the left
    const name = this.add.text(cardX + 20, cardY + 20, `${heroData.name} (Lv ${state.level})`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    });
    name.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.partyElements.push(name);

    const classText = this.add.text(cardX + 20, cardY + 45, `${heroData.race} ${heroData.class}`, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaaaa',
    });
    classText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.partyElements.push(classText);

    // HP Bar - on the left side
    const barX = cardX + 50;
    const barY = cardY + 80;
    const barWidth = 280;
    const barHeight = 16;

    const hpLabel = this.add.text(barX - 30, barY, 'HP', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#44ff44',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.partyElements.push(hpLabel);

    const hpBar = new ProgressBar(this, {
      x: barX,
      y: barY,
      width: barWidth,
      height: barHeight,
      fillColor: 0x44ff44,
      backgroundColor: 0x333333,
      borderColor: 0x666666,
      showText: true,
      textFormat: 'fraction',
    });
    // Use level-scaled max HP
    const scaledMaxHp = SaveManager.getMaxHp(heroId, state.level);
    hpBar.setValue(state.currentHp, scaledMaxHp);
    this.progressBars.push(hpBar);

    // MP/Ki Bar - use level-scaled max values
    const mpY = barY + 25;
    const hasMana = heroData.maxMana && heroData.maxMana > 0;
    const hasKi = heroData.maxKi && heroData.maxKi > 0;
    const scaledMaxMana = hasMana ? (SaveManager.getMaxMana(heroId, state.level) ?? 0) : 0;
    const scaledMaxKi = hasKi ? SaveManager.getMaxKi(state.level) : 0;
    const resourceMax = hasMana ? scaledMaxMana : hasKi ? scaledMaxKi : 0;
    const resourceCurrent = hasMana ? (state.currentMana ?? resourceMax) : hasKi ? (state.currentKi ?? resourceMax) : 0;
    const resourceLabel = hasMana ? 'MP' : hasKi ? 'Ki' : '';
    const resourceColor = hasMana ? 0x4444ff : 0xffaa00;

    if (resourceMax > 0) {
      const mpLabelText = this.add.text(barX - 30, mpY, resourceLabel, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: hasMana ? '#4444ff' : '#ffaa00',
      }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
      this.partyElements.push(mpLabelText);

      const mpBar = new ProgressBar(this, {
        x: barX,
        y: mpY,
        width: barWidth,
        height: barHeight,
        fillColor: resourceColor,
        backgroundColor: 0x333333,
        borderColor: 0x666666,
        showText: true,
        textFormat: 'fraction',
      });
      mpBar.setValue(resourceCurrent, resourceMax);
      this.progressBars.push(mpBar);
    }

    // XP Bar
    const xpY = resourceMax > 0 ? mpY + 25 : mpY;
    const xpThresholds = [0, 50, 125, 225, 350, 500];
    const currentLevelXp = xpThresholds[state.level - 1] || 0;
    const nextLevelXp = xpThresholds[state.level] || xpThresholds[xpThresholds.length - 1];
    const xpInLevel = state.xp - currentLevelXp;
    const xpNeeded = nextLevelXp - currentLevelXp;

    const xpLabelText = this.add.text(barX - 30, xpY, 'XP', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.partyElements.push(xpLabelText);

    const xpBar = new ProgressBar(this, {
      x: barX,
      y: xpY,
      width: barWidth,
      height: barHeight,
      fillColor: 0x888888,
      backgroundColor: 0x333333,
      borderColor: 0x666666,
      showText: true,
      textFormat: 'fraction',
    });
    xpBar.setValue(xpInLevel, xpNeeded);
    this.progressBars.push(xpBar);

    // Stats section
    const statsY = cardY + 170;
    const statsTitle = this.add.text(cardX + 20, statsY, 'Stats', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#f0d866',
    });
    statsTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.partyElements.push(statsTitle);

    // Cast to any to access optional bonus properties that may exist in future
    const stateAny = state as unknown as Record<string, unknown>;
    const stats = [
      { label: 'ATK', value: heroData.attack, bonus: (stateAny.attackBonus as number) || 0 },
      { label: 'DEF', value: heroData.defense, bonus: (stateAny.defenseBonus as number) || 0 },
      { label: 'MAG', value: heroData.magic, bonus: (stateAny.magicBonus as number) || 0 },
      { label: 'RES', value: heroData.resilience, bonus: (stateAny.resilienceBonus as number) || 0 },
      { label: 'SPD', value: heroData.speed, bonus: 0 },
      { label: 'MOV', value: heroData.movement || 4, bonus: 0 },
    ];

    const col1X = cardX + 20;
    const col2X = cardX + 120;
    const col3X = cardX + 220;

    stats.forEach((stat, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = col === 0 ? col1X : col === 1 ? col2X : col3X;
      const y = statsY + 25 + row * 22;

      const total = stat.value + stat.bonus;
      const bonusStr = stat.bonus > 0 ? ` (+${stat.bonus})` : '';

      const statText = this.add.text(x, y, `${stat.label}: ${total}${bonusStr}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: stat.bonus > 0 ? '#88ff88' : '#ffffff',
      });
      statText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.partyElements.push(statText);
    });

    // Equipment section
    const equipmentY = statsY + 80;
    const equipmentTitle = this.add.text(cardX + 20, equipmentY, 'Equipment', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#f0d866',
    });
    equipmentTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.partyElements.push(equipmentTitle);

    let equipmentEndY = equipmentY + 25;

    // Show equipped item
    if (state.equipment) {
      const itemData = this.itemsData[state.equipment];
      if (itemData) {
        const itemName = this.add.text(cardX + 30, equipmentEndY, itemData.name, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#88ccff',
        });
        itemName.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.partyElements.push(itemName);
        equipmentEndY += 18;

        const itemDesc = this.add.text(cardX + 30, equipmentEndY, itemData.description, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#888888',
          wordWrap: { width: cardWidth - 60 },
        });
        itemDesc.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.partyElements.push(itemDesc);
        equipmentEndY += 20;
      }
    } else {
      const noEquip = this.add.text(cardX + 30, equipmentEndY, '(None equipped)', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#666666',
      });
      noEquip.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.partyElements.push(noEquip);
      equipmentEndY += 20;
    }

    // Show permanent bonuses (damage runes)
    const damageBonus = state.permanentBonuses?.damageBonus ?? 0;
    if (damageBonus > 0) {
      const bonusText = this.add.text(cardX + 30, equipmentEndY, `+${damageBonus} Damage (Rune)`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ff8888',
      });
      bonusText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.partyElements.push(bonusText);
      equipmentEndY += 20;
    }

    // Abilities section
    const abilitiesY = equipmentEndY + 10;
    const abilitiesTitle = this.add.text(cardX + 20, abilitiesY, 'Abilities', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#f0d866',
    });
    abilitiesTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.partyElements.push(abilitiesTitle);

    // Get unlocked abilities
    const unlockedAbilities = heroData.abilities.filter(abilityId => {
      const ability = this.abilitiesData[abilityId];
      if (!ability) return false;
      const levelRequired = ability.levelRequired || 1;
      return state.level >= levelRequired;
    });

    // Get locked abilities count
    const lockedCount = heroData.abilities.length - unlockedAbilities.length;

    let abilityY = abilitiesY + 25;
    unlockedAbilities.forEach(abilityId => {
      const ability = this.abilitiesData[abilityId];
      if (!ability) return;

      const rangeStr = ability.range > 1 ? ` [Range ${ability.range}]` : ' [Melee]';
      const costStr = ability.cost > 0 ? ` (${ability.cost} ${ability.costType})` : '';

      const abilityText = this.add.text(cardX + 30, abilityY, `- ${ability.name}${rangeStr}${costStr}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
      });
      abilityText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.partyElements.push(abilityText);
      abilityY += 20;
    });

    // Show locked abilities hint
    if (lockedCount > 0) {
      const lockedText = this.add.text(cardX + 30, abilityY, `+ ${lockedCount} more at higher levels`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#666666',
      });
      lockedText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.partyElements.push(lockedText);
    }
  }

  private showInventoryView(): void {
    this.currentView = 'inventory';
    this.clearContent();

    // Title
    const title = this.add.text(this.CONTENT_X + 20, 20, 'Inventory', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f0d866',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.inventoryElements.push(title);

    // Navigation hint
    const hint = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH - 20,
      20,
      'ESC to go back',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.inventoryElements.push(hint);

    const contentX = this.CONTENT_X + 20;
    let contentY = 60;

    // Check if inventory exists
    if (!this.inventory) {
      const noInventory = this.add.text(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2,
        'No inventory data available',
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#888888',
        }
      ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.inventoryElements.push(noInventory);
      return;
    }

    // === CONSUMABLES SECTION ===
    const consumablesTitle = this.add.text(contentX, contentY, 'Consumables', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#88ff88',
    });
    consumablesTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.inventoryElements.push(consumablesTitle);
    contentY += 30;

    let hasConsumables = false;
    for (const itemId of CONSUMABLE_IDS) {
      const count = this.inventory.consumables[itemId as ConsumableId];
      if (count > 0) {
        hasConsumables = true;
        const item = this.itemsData[itemId];
        if (item) {
          const itemText = this.add.text(contentX + 20, contentY, `${item.name} x${count}`, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: '#ffffff',
          });
          itemText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
          this.inventoryElements.push(itemText);

          const descText = this.add.text(contentX + 30, contentY + 18, item.description, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#888888',
          });
          descText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
          this.inventoryElements.push(descText);
          contentY += 42;
        }
      }
    }

    if (!hasConsumables) {
      const noItems = this.add.text(contentX + 20, contentY, '(None)', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#666666',
      });
      noItems.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.inventoryElements.push(noItems);
      contentY += 25;
    }

    contentY += 15;

    // === EQUIPMENT SECTION ===
    const equipmentTitle = this.add.text(contentX, contentY, 'Unequipped Equipment', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#88ccff',
    });
    equipmentTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.inventoryElements.push(equipmentTitle);
    contentY += 30;

    const unequipped = this.inventory.equipment.unequipped;
    if (unequipped.length > 0) {
      for (const itemId of unequipped) {
        const item = this.itemsData[itemId];
        if (item) {
          const itemText = this.add.text(contentX + 20, contentY, item.name, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: '#ffffff',
          });
          itemText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
          this.inventoryElements.push(itemText);

          const descText = this.add.text(contentX + 30, contentY + 18, item.description, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#888888',
          });
          descText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
          this.inventoryElements.push(descText);
          contentY += 42;
        }
      }
    } else {
      const noEquip = this.add.text(contentX + 20, contentY, '(None)', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#666666',
      });
      noEquip.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.inventoryElements.push(noEquip);
      contentY += 25;
    }

    contentY += 15;

    // === DAMAGE RUNES SECTION ===
    const runesTitle = this.add.text(contentX, contentY, 'Damage Runes', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ff8888',
    });
    runesTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.inventoryElements.push(runesTitle);
    contentY += 30;

    const runeCount = this.inventory.damageRunes || 0;
    if (runeCount > 0) {
      const runeItem = this.itemsData['damage_rune'];
      const runeText = this.add.text(contentX + 20, contentY, `+1 Damage Rune x${runeCount}`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
      });
      runeText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.inventoryElements.push(runeText);

      const runeDesc = this.add.text(
        contentX + 30,
        contentY + 18,
        runeItem?.description || 'Permanently grants +1 damage to a hero.',
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#888888',
          wordWrap: { width: this.CONTENT_WIDTH - 80 },
        }
      );
      runeDesc.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.inventoryElements.push(runeDesc);

      const runeHint = this.add.text(
        contentX + 30,
        contentY + 52,
        '(Apply at Hrothgar\'s shop)',
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#666666',
        }
      );
      runeHint.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.inventoryElements.push(runeHint);
    } else {
      const noRunes = this.add.text(contentX + 20, contentY, '(None)', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#666666',
      });
      noRunes.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.inventoryElements.push(noRunes);
    }
  }

  private showHrothgarView(): void {
    this.currentView = 'hrothgar';
    this.clearContent();

    // Build menu options dynamically based on inventory
    this.hrothgarMenuOptions = ['Combat Guide', 'Manage Equipment'];
    if (this.inventory && this.inventory.damageRunes > 0) {
      this.hrothgarMenuOptions.push(`Apply Damage Rune (${this.inventory.damageRunes})`);
    }
    this.hrothgarMenuOptions.push('Close');
    this.hrothgarSelectedIndex = Math.min(this.hrothgarSelectedIndex, this.hrothgarMenuOptions.length - 1);

    // Title
    const title = this.add.text(this.CONTENT_X + 20, 20, "Elarra's Services", {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f0d866',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.hrothgarElements.push(title);

    // Navigation hint
    const hint = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH - 20,
      20,
      'Up/Down to select | Enter to confirm | ESC to leave',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.hrothgarElements.push(hint);

    // Content area background
    const contentX = this.CONTENT_X + 20;
    const contentY = 80;
    const contentWidth = this.CONTENT_WIDTH - 40;
    const contentHeight = GAME_CONFIG.HEIGHT - 140;

    const bg = this.add.rectangle(
      contentX + contentWidth / 2,
      contentY + contentHeight / 2,
      contentWidth,
      contentHeight,
      0x2a2a4a,
      0.8
    );
    this.hrothgarElements.push(bg);

    // Menu options
    const menuX = this.CONTENT_X + this.CONTENT_WIDTH / 2;
    const menuY = 160;
    const lineHeight = 50;

    this.hrothgarMenuTexts = [];
    this.hrothgarMenuOptions.forEach((option, index) => {
      const text = this.add.text(menuX, menuY + index * lineHeight, option, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
      }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.hrothgarMenuTexts.push(text);
    });

    this.updateHrothgarMenuSelection();
  }

  private updateHrothgarMenuSelection(): void {
    this.hrothgarMenuTexts.forEach((text, index) => {
      if (index === this.hrothgarSelectedIndex) {
        text.setText('> ' + this.hrothgarMenuOptions[index] + ' <');
        text.setColor('#f0d866');
      } else {
        text.setText(this.hrothgarMenuOptions[index]);
        text.setColor('#ffffff');
      }
    });
  }

  private selectHrothgarMenuItem(): void {
    const option = this.hrothgarMenuOptions[this.hrothgarSelectedIndex];

    if (option === 'Combat Guide') {
      this.showCombatView();
    } else if (option === 'Manage Equipment') {
      this.showEquipmentManagementView();
    } else if (option.startsWith('Apply Damage Rune')) {
      this.showRuneApplicationView();
    } else if (option === 'Close') {
      this.closeMenu();
    }
  }

  private showEquipmentManagementView(): void {
    this.currentView = 'equipment';
    this.clearContent();

    // Title
    const title = this.add.text(this.CONTENT_X + 20, 20, 'Manage Equipment', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f0d866',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.equipmentElements.push(title);

    // Navigation hint
    const hint = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH - 20,
      20,
      'Up/Down to select | Enter to equip/unequip | ESC to go back',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.equipmentElements.push(hint);

    this.renderEquipmentManagement();
  }

  private renderEquipmentManagement(): void {
    // Clear previous equipment content (keep title and hint)
    const keepCount = 2;
    this.equipmentElements.slice(keepCount).forEach(el => el.destroy());
    this.equipmentElements = this.equipmentElements.slice(0, keepCount);

    const contentX = this.CONTENT_X + 20;
    let contentY = 60;

    // Check if we have inventory
    if (!this.inventory) {
      const noInventory = this.add.text(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2,
        'No inventory data available',
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#888888',
        }
      ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.equipmentElements.push(noInventory);
      return;
    }

    // === HEROES SECTION ===
    const heroesTitle = this.add.text(contentX, contentY, 'Party Equipment', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#88ff88',
    });
    heroesTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.equipmentElements.push(heroesTitle);
    contentY += 30;

    // List heroes with their equipment
    const heroIds = Object.keys(this.heroState);
    heroIds.forEach((heroId, index) => {
      const heroData = this.heroesData[heroId];
      const state = this.heroState[heroId];
      if (!heroData || !state) return;

      const isSelected = this.equipmentMode === 'hero' && index === this.equipmentHeroIndex;
      const prefix = isSelected ? '> ' : '  ';
      const color = isSelected ? '#f0d866' : '#ffffff';

      const equipmentName = state.equipment
        ? this.itemsData[state.equipment]?.name || state.equipment
        : '(None)';

      const heroText = this.add.text(
        contentX + 10,
        contentY,
        `${prefix}${heroData.name}: ${equipmentName}`,
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: color,
        }
      );
      heroText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.equipmentElements.push(heroText);
      contentY += 25;
    });

    contentY += 20;

    // === UNEQUIPPED POOL ===
    const poolTitle = this.add.text(contentX, contentY, 'Available Equipment', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#88ccff',
    });
    poolTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.equipmentElements.push(poolTitle);
    contentY += 30;

    const unequipped = this.inventory.equipment.unequipped;
    if (unequipped.length === 0) {
      const noEquip = this.add.text(contentX + 10, contentY, '  (No unequipped items)', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#666666',
      });
      noEquip.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.equipmentElements.push(noEquip);
    } else {
      unequipped.forEach((itemId, index) => {
        const item = this.itemsData[itemId];
        if (!item) return;

        const isSelected = this.equipmentMode === 'item' && index === this.equipmentItemIndex;
        const prefix = isSelected ? '> ' : '  ';
        const color = isSelected ? '#f0d866' : '#ffffff';

        const itemText = this.add.text(contentX + 10, contentY, `${prefix}${item.name}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: color,
        });
        itemText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.equipmentElements.push(itemText);

        const descText = this.add.text(contentX + 30, contentY + 16, item.description, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#888888',
        });
        descText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.equipmentElements.push(descText);

        contentY += 38;
      });
    }

    // Instructions at bottom
    const instructionY = GAME_CONFIG.HEIGHT - 60;
    const instructions = this.equipmentMode === 'hero'
      ? 'Select a hero to unequip their item, or press Tab to select from available items'
      : 'Select an item to equip to the currently highlighted hero';

    const instructionText = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH / 2,
      instructionY,
      instructions,
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
        align: 'center',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
    this.equipmentElements.push(instructionText);
  }

  private handleEquipmentInput(key: 'up' | 'down' | 'enter' | 'tab'): void {
    const heroIds = Object.keys(this.heroState);
    const unequipped = this.inventory?.equipment.unequipped || [];

    if (key === 'tab') {
      // Toggle between hero and item selection
      if (this.equipmentMode === 'hero' && unequipped.length > 0) {
        this.equipmentMode = 'item';
        this.equipmentItemIndex = 0;
      } else {
        this.equipmentMode = 'hero';
      }
      this.renderEquipmentManagement();
      return;
    }

    if (key === 'up') {
      if (this.equipmentMode === 'hero') {
        this.equipmentHeroIndex = Math.max(0, this.equipmentHeroIndex - 1);
      } else {
        this.equipmentItemIndex = Math.max(0, this.equipmentItemIndex - 1);
      }
      this.renderEquipmentManagement();
      return;
    }

    if (key === 'down') {
      if (this.equipmentMode === 'hero') {
        this.equipmentHeroIndex = Math.min(heroIds.length - 1, this.equipmentHeroIndex + 1);
      } else {
        this.equipmentItemIndex = Math.min(unequipped.length - 1, this.equipmentItemIndex + 1);
      }
      this.renderEquipmentManagement();
      return;
    }

    if (key === 'enter') {
      if (this.equipmentMode === 'hero') {
        // Unequip from selected hero
        const heroId = heroIds[this.equipmentHeroIndex];
        const state = this.heroState[heroId];
        if (state?.equipment) {
          // Move equipment to unequipped pool
          this.inventory!.equipment.unequipped.push(state.equipment);
          state.equipment = null;
          this.renderEquipmentManagement();
        }
      } else {
        // Equip selected item to selected hero
        const heroId = heroIds[this.equipmentHeroIndex];
        const state = this.heroState[heroId];
        const itemId = unequipped[this.equipmentItemIndex];

        if (itemId && state) {
          // If hero has equipment, unequip it first
          if (state.equipment) {
            this.inventory!.equipment.unequipped.push(state.equipment);
          }

          // Equip the new item
          state.equipment = itemId;

          // Remove from unequipped pool
          this.inventory!.equipment.unequipped.splice(this.equipmentItemIndex, 1);

          // Reset to hero mode
          this.equipmentMode = 'hero';
          this.equipmentItemIndex = 0;

          this.renderEquipmentManagement();
        }
      }
    }
  }

  private showRuneApplicationView(): void {
    this.currentView = 'rune';
    this.clearContent();
    this.runeHeroIndex = 0;
    this.runeConfirmMode = false;

    this.renderRuneApplication();
  }

  private renderRuneApplication(): void {
    // Clear previous rune content (keep nothing - we re-render everything)
    this.runeElements.forEach(el => el.destroy());
    this.runeElements = [];

    // Title
    const title = this.add.text(this.CONTENT_X + 20, 20, 'Apply Damage Rune', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f0d866',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.runeElements.push(title);

    // Navigation hint
    const hintText = this.runeConfirmMode
      ? 'Enter to confirm | ESC to cancel'
      : 'Up/Down to select | Enter to apply | ESC to go back';
    const hint = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH - 20,
      20,
      hintText,
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.runeElements.push(hint);

    const contentX = this.CONTENT_X + 20;
    let contentY = 70;

    // Rune info
    const runeCount = this.inventory?.damageRunes || 0;
    const runeInfo = this.add.text(
      contentX,
      contentY,
      `Available: +1 Damage Rune x${runeCount}`,
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff8888',
      }
    );
    runeInfo.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.runeElements.push(runeInfo);
    contentY += 30;

    const runeDesc = this.add.text(
      contentX,
      contentY,
      'Permanently grants +1 to all damage rolls for the selected hero.',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      }
    );
    runeDesc.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.runeElements.push(runeDesc);
    contentY += 40;

    if (this.runeConfirmMode) {
      // Confirmation mode
      const heroIds = Object.keys(this.heroState);
      const heroId = heroIds[this.runeHeroIndex];
      const heroData = this.heroesData[heroId];
      const state = this.heroState[heroId];
      const currentBonus = state?.permanentBonuses?.damageBonus || 0;

      const confirmBg = this.add.rectangle(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2,
        400,
        150,
        0x3a3a5a,
        0.95
      );
      this.runeElements.push(confirmBg);

      const confirmTitle = this.add.text(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2 - 40,
        'Confirm Rune Application',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#f0d866',
        }
      ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.runeElements.push(confirmTitle);

      const confirmText = this.add.text(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2,
        `Apply +1 Damage Rune to ${heroData?.name || heroId}?`,
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ffffff',
        }
      ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.runeElements.push(confirmText);

      const newBonus = currentBonus + 1;
      const bonusText = this.add.text(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2 + 25,
        `Damage bonus: +${currentBonus} → +${newBonus}`,
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#88ff88',
        }
      ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.runeElements.push(bonusText);

      const warningText = this.add.text(
        this.CONTENT_X + this.CONTENT_WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2 + 50,
        'This cannot be undone!',
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ff8888',
        }
      ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.runeElements.push(warningText);

    } else {
      // Hero selection mode
      const selectTitle = this.add.text(contentX, contentY, 'Select a hero:', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#88ccff',
      });
      selectTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.runeElements.push(selectTitle);
      contentY += 30;

      const heroIds = Object.keys(this.heroState);
      heroIds.forEach((heroId, index) => {
        const heroData = this.heroesData[heroId];
        const state = this.heroState[heroId];
        if (!heroData || !state) return;

        const isSelected = index === this.runeHeroIndex;
        const prefix = isSelected ? '> ' : '  ';
        const color = isSelected ? '#f0d866' : '#ffffff';

        const currentBonus = state.permanentBonuses?.damageBonus || 0;
        const bonusStr = currentBonus > 0 ? ` (+${currentBonus} dmg)` : '';

        const heroText = this.add.text(
          contentX + 10,
          contentY,
          `${prefix}${heroData.name}${bonusStr}`,
          {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: color,
          }
        );
        heroText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.runeElements.push(heroText);
        contentY += 30;
      });
    }
  }

  private handleRuneInput(key: 'up' | 'down' | 'enter' | 'esc'): void {
    const heroIds = Object.keys(this.heroState);

    if (this.runeConfirmMode) {
      if (key === 'enter') {
        // Apply the rune!
        const heroId = heroIds[this.runeHeroIndex];
        const state = this.heroState[heroId];

        if (state && this.inventory && this.inventory.damageRunes > 0) {
          // Initialize permanentBonuses if needed
          if (!state.permanentBonuses) {
            state.permanentBonuses = { damageBonus: 0 };
          }
          // Apply the bonus
          state.permanentBonuses.damageBonus = (state.permanentBonuses.damageBonus || 0) + 1;
          // Consume the rune
          this.inventory.damageRunes--;

          // Return to Hrothgar menu
          this.runeConfirmMode = false;
          this.showHrothgarView();
        }
      } else if (key === 'esc') {
        // Cancel confirmation
        this.runeConfirmMode = false;
        this.renderRuneApplication();
      }
      return;
    }

    // Hero selection mode
    if (key === 'up') {
      this.runeHeroIndex = Math.max(0, this.runeHeroIndex - 1);
      this.renderRuneApplication();
    } else if (key === 'down') {
      this.runeHeroIndex = Math.min(heroIds.length - 1, this.runeHeroIndex + 1);
      this.renderRuneApplication();
    } else if (key === 'enter') {
      // Enter confirmation mode
      this.runeConfirmMode = true;
      this.renderRuneApplication();
    } else if (key === 'esc') {
      // Go back to Hrothgar menu
      this.showHrothgarView();
    }
  }

  private showCombatView(): void {
    this.currentView = 'combat';
    this.clearContent();

    // Title
    const title = this.add.text(this.CONTENT_X + 20, 20, 'Combat Guide', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f0d866',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.contentElements.push(title);

    // Navigation hint
    const hint = this.add.text(
      this.CONTENT_X + this.CONTENT_WIDTH - 20,
      20,
      'Up/Down to browse | ESC to go back',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.contentElements.push(hint);

    // Submenu on the left side
    const menuX = this.CONTENT_X + 20;
    const menuY = 60;
    const lineHeight = 28;

    this.combatMenuTexts = [];
    this.combatMenuOptions.forEach((option, index) => {
      const text = this.add.text(menuX, menuY + index * lineHeight, option, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.combatMenuTexts.push(text);
    });

    this.updateCombatMenuSelection();
    this.renderCombatContent();
  }

  private updateCombatMenuSelection(): void {
    this.combatMenuTexts.forEach((text, index) => {
      if (index === this.combatSelectedIndex) {
        text.setText('> ' + this.combatMenuOptions[index]);
        text.setColor('#f0d866');
      } else {
        text.setText('  ' + this.combatMenuOptions[index]);
        text.setColor('#ffffff');
      }
    });
  }

  private renderCombatContent(): void {
    // Clear previous content (keep title, hint, and menu texts)
    const keepCount = 2; // title and hint
    this.contentElements.slice(keepCount).forEach(el => el.destroy());
    this.contentElements = this.contentElements.slice(0, keepCount);

    const contentX = this.CONTENT_X + 140;
    const contentY = 60;
    const contentWidth = this.CONTENT_WIDTH - 160;

    // Content background
    const bg = this.add.rectangle(
      contentX + contentWidth / 2,
      GAME_CONFIG.HEIGHT / 2 + 10,
      contentWidth,
      GAME_CONFIG.HEIGHT - 80,
      0x2a2a4a,
      0.8
    );
    this.contentElements.push(bg);

    const option = this.combatMenuOptions[this.combatSelectedIndex];

    switch (option) {
      case 'General':
        this.renderGeneralGuide(contentX, contentY, contentWidth);
        break;
      case 'Experience':
        this.renderExperienceGuide(contentX, contentY, contentWidth);
        break;
      case 'Movement':
        this.renderMovementGuide(contentX, contentY, contentWidth);
        break;
      case 'Conditions':
        this.renderConditionsGuide(contentX, contentY, contentWidth);
        break;
      case 'HP':
        this.renderHPGuide(contentX, contentY, contentWidth);
        break;
      default:
        // Hero ability guides
        this.renderHeroAbilityGuide(option.toLowerCase(), contentX, contentY, contentWidth);
        break;
    }
  }

  private renderGeneralGuide(x: number, y: number, width: number): void {
    const lines = [
      { text: 'COMBAT STATISTICS', color: '#f0d866', size: '16px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'ATK (Attack)', color: '#88ff88', size: '14px' },
      { text: '  Added to d20 roll for physical attacks.', color: '#cccccc', size: '12px' },
      { text: '  Higher ATK = more likely to hit.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'DEF (Defense)', color: '#88ff88', size: '14px' },
      { text: '  Target number enemies must beat to hit you.', color: '#cccccc', size: '12px' },
      { text: '  Attack hits if: d20 + ATK >= target DEF', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'MAG (Magic)', color: '#88ff88', size: '14px' },
      { text: '  Target number for spell saves.', color: '#cccccc', size: '12px' },
      { text: '  Spell resisted if: d20 + RES >= caster MAG', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'RES (Resilience)', color: '#88ff88', size: '14px' },
      { text: '  Added to d20 roll when resisting spells.', color: '#cccccc', size: '12px' },
      { text: '  Higher RES = better at shrugging off magic.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'SPD (Speed)', color: '#88ff88', size: '14px' },
      { text: '  Added to d20 for initiative each round.', color: '#cccccc', size: '12px' },
      { text: '  Higher SPD = more likely to act first.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'ATTACKS vs SPELLS', color: '#f0d866', size: '16px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Attacks: Roll d20 + ATK vs target DEF', color: '#cccccc', size: '12px' },
      { text: '  Miss = no damage. Hit = roll damage dice.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Spells: Target rolls d20 + RES vs caster MAG', color: '#cccccc', size: '12px' },
      { text: '  Fail = full effect. Pass = half or none.', color: '#cccccc', size: '12px' },
    ];

    let lineY = y + 10;
    lines.forEach(line => {
      const text = this.add.text(x + 10, lineY, line.text, {
        fontFamily: 'monospace',
        fontSize: line.size,
        color: line.color,
        wordWrap: { width: width - 20 },
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.contentElements.push(text);
      lineY += line.text === '' ? 8 : 18;
    });
  }

  private renderExperienceGuide(x: number, y: number, width: number): void {
    const lines = [
      { text: 'EXPERIENCE SYSTEM', color: '#f0d866', size: '16px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'XP SOURCES', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Free Abilities (0 cost):', color: '#aaaaff', size: '13px' },
      { text: '  1 XP per damage dealt', color: '#cccccc', size: '12px' },
      { text: '  Minimum 1 XP per use (even on miss)', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Paid Abilities (mana/ki cost):', color: '#aaaaff', size: '13px' },
      { text: '  4 XP per resource spent', color: '#cccccc', size: '12px' },
      { text: '  XP earned regardless of hit/miss', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Killing Blow:', color: '#aaaaff', size: '13px' },
      { text: '  +5 XP bonus', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Catch-Up Bonus:', color: '#aaaaff', size: '13px' },
      { text: '  +50% XP if behind highest party level', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'LEVEL THRESHOLDS', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  Level 1:   0 XP', color: '#cccccc', size: '12px' },
      { text: '  Level 2:  50 XP', color: '#cccccc', size: '12px' },
      { text: '  Level 3: 125 XP', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'LEVEL UP REWARDS', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  Level 2: +HP, +Mana/Ki (stats only)', color: '#cccccc', size: '12px' },
      { text: '  Level 3: +HP, +Mana/Ki, NEW ABILITY', color: '#f0d866', size: '12px' },
    ];

    let lineY = y + 10;
    lines.forEach(line => {
      const text = this.add.text(x + 10, lineY, line.text, {
        fontFamily: 'monospace',
        fontSize: line.size,
        color: line.color,
        wordWrap: { width: width - 20 },
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.contentElements.push(text);
      lineY += line.text === '' ? 8 : 18;
    });
  }

  private renderMovementGuide(x: number, y: number, width: number): void {
    const lines = [
      { text: 'MOVEMENT', color: '#f0d866', size: '16px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'BASIC MOVEMENT', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  Each unit has a MOV stat (usually 4-6).', color: '#cccccc', size: '12px' },
      { text: '  Each tile costs 1 movement to enter.', color: '#cccccc', size: '12px' },
      { text: '  You can move through allies but not enemies.', color: '#cccccc', size: '12px' },
      { text: '  Moving ends your turn (unless noted).', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'TERRAIN TYPES', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Normal (grass, stone, etc.):', color: '#aaaaff', size: '13px' },
      { text: '  Costs 1 movement per tile.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Difficult (water, rubble, vines):', color: '#aaaaff', size: '13px' },
      { text: '  Costs 2 movement per tile.', color: '#cccccc', size: '12px' },
      { text: '  Slows you down but no other penalty.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Impassable (walls, deep water):', color: '#aaaaff', size: '13px' },
      { text: '  Cannot be entered.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'HAZARD ZONES', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  Some abilities create temporary zones.', color: '#cccccc', size: '12px' },
      { text: '  Zones may damage on entry or turn start.', color: '#cccccc', size: '12px' },
      { text: '  Zones disappear after a set duration.', color: '#cccccc', size: '12px' },
    ];

    let lineY = y + 10;
    lines.forEach(line => {
      const text = this.add.text(x + 10, lineY, line.text, {
        fontFamily: 'monospace',
        fontSize: line.size,
        color: line.color,
        wordWrap: { width: width - 20 },
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.contentElements.push(text);
      lineY += line.text === '' ? 8 : 18;
    });
  }

  private renderConditionsGuide(x: number, y: number, width: number): void {
    const visibleHeight = GAME_CONFIG.HEIGHT - 100; // Visible area height
    const lines = [
      { text: 'CONDITIONS (Left/Right to scroll)', color: '#f0d866', size: '16px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'DEBUFFS', color: '#ff6666', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Poison (green border)', color: '#00ff00', size: '14px' },
      { text: '  Take damage at start of each turn.', color: '#cccccc', size: '12px' },
      { text: '  Duration: 2-3 rounds (less on save).', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Held (teal border)', color: '#00ffff', size: '14px' },
      { text: '  Cannot take any action on your turn.', color: '#cccccc', size: '12px' },
      { text: '  Duration: 1-4 rounds (1 on save).', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Immobilized (blue border)', color: '#4444ff', size: '14px' },
      { text: '  Cannot move but can still act.', color: '#cccccc', size: '12px' },
      { text: '  Duration: 1 round.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Exposed (orange border)', color: '#ffa500', size: '14px' },
      { text: '  -2 DEF penalty.', color: '#cccccc', size: '12px' },
      { text: '  Clears after you are attacked.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Unconscious (black border)', color: '#888888', size: '14px' },
      { text: '  At 0 HP. Cannot act or move.', color: '#cccccc', size: '12px' },
      { text: '  Healing revives the unit.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'BUFFS', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Hidden (purple border)', color: '#aa44aa', size: '14px' },
      { text: '  +2 DEF bonus.', color: '#cccccc', size: '12px' },
      { text: '  Breaks when you attack or take damage.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Barkskin (brown border)', color: '#cd853f', size: '14px' },
      { text: '  +2 DEF bonus.', color: '#cccccc', size: '12px' },
      { text: '  Duration: 3-6 rounds.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Rage (red border)', color: '#ff4444', size: '14px' },
      { text: '  +2 ATK and +2 damage per hit.', color: '#cccccc', size: '12px' },
      { text: '  Duration: 1-4 rounds.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Inspired (gold border)', color: '#ffd700', size: '14px' },
      { text: '  +2 ATK and +2 RES.', color: '#cccccc', size: '12px' },
      { text: '  Duration: 1-4 rounds.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'Dodge (light blue border)', color: '#00bfff', size: '14px' },
      { text: '  +2 DEF bonus (evasive stance).', color: '#cccccc', size: '12px' },
      { text: '  Duration: 1-4 rounds.', color: '#888888', size: '11px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'REMOVING CONDITIONS', color: '#f0d866', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  Some abilities can cleanse conditions.', color: '#cccccc', size: '12px' },
      { text: '  Otherwise, wait for duration to expire.', color: '#cccccc', size: '12px' },
    ];

    // Calculate total content height
    let totalHeight = 10;
    lines.forEach(line => {
      totalHeight += line.text === '' ? 8 : 18;
    });
    this.combatContentMaxScroll = Math.max(0, totalHeight - visibleHeight);

    // Create a container for scrollable content
    const container = this.add.container(x, y - this.combatContentScrollOffset);
    this.contentElements.push(container);

    let lineY = 10;
    lines.forEach(line => {
      const text = this.add.text(10, lineY, line.text, {
        fontFamily: 'monospace',
        fontSize: line.size,
        color: line.color,
        wordWrap: { width: width - 20 },
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      container.add(text);
      lineY += line.text === '' ? 8 : 18;
    });

    // Create a mask to clip content
    const maskShape = this.make.graphics({ x: 0, y: 0 });
    maskShape.fillRect(x, y, width, visibleHeight);
    const mask = maskShape.createGeometryMask();
    container.setMask(mask);
    this.contentElements.push(maskShape);

    // Show scroll indicator if content is scrollable
    if (this.combatContentMaxScroll > 0) {
      const scrollHint = this.add.text(x + width - 10, y + visibleHeight - 20,
        this.combatContentScrollOffset < this.combatContentMaxScroll ? '▼' : '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888888',
      }).setOrigin(1, 0);
      scrollHint.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.contentElements.push(scrollHint);
    }
  }

  private renderHPGuide(x: number, y: number, width: number): void {
    const lines = [
      { text: 'HIT POINTS', color: '#f0d866', size: '16px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'HP BASICS', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  HP represents your health.', color: '#cccccc', size: '12px' },
      { text: '  Taking damage reduces HP.', color: '#cccccc', size: '12px' },
      { text: '  HP cannot exceed your max HP.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'HEALING', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  Healing abilities restore HP.', color: '#cccccc', size: '12px' },
      { text: '  Healing always hits (no roll needed).', color: '#cccccc', size: '12px' },
      { text: '  Most healing costs mana or ki.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'UNCONSCIOUS (0 HP)', color: '#ff6666', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  At 0 HP, a unit falls unconscious.', color: '#cccccc', size: '12px' },
      { text: '  Unconscious units cannot act or move.', color: '#cccccc', size: '12px' },
      { text: '  They remain on the battlefield.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'REVIVAL', color: '#88ff88', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  Healing an unconscious ally revives them.', color: '#cccccc', size: '12px' },
      { text: '  They wake with whatever HP is healed.', color: '#cccccc', size: '12px' },
      { text: '  Revived allies can act on their next turn.', color: '#cccccc', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: 'DEFEAT', color: '#ff6666', size: '14px' },
      { text: '', color: '#ffffff', size: '12px' },
      { text: '  If all party members are unconscious,', color: '#cccccc', size: '12px' },
      { text: '  the battle is lost.', color: '#cccccc', size: '12px' },
    ];

    let lineY = y + 10;
    lines.forEach(line => {
      const text = this.add.text(x + 10, lineY, line.text, {
        fontFamily: 'monospace',
        fontSize: line.size,
        color: line.color,
        wordWrap: { width: width - 20 },
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.contentElements.push(text);
      lineY += line.text === '' ? 8 : 18;
    });
  }

  private renderHeroAbilityGuide(heroId: string, x: number, y: number, width: number): void {
    const heroData = this.heroesData[heroId];
    const state = this.heroState[heroId];

    if (!heroData) {
      const notFound = this.add.text(x + 10, y + 10, 'Hero not found', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff6666',
      });
      notFound.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.contentElements.push(notFound);
      return;
    }

    const lines: { text: string; color: string; size: string }[] = [
      { text: `${heroData.name.toUpperCase()} - ${heroData.class}`, color: '#f0d866', size: '16px' },
      { text: heroData.race, color: '#888888', size: '12px' },
      { text: '', color: '#ffffff', size: '12px' },
    ];

    lines.push({ text: 'ABILITIES', color: '#88ff88', size: '14px' });
    lines.push({ text: '', color: '#ffffff', size: '12px' });

    // Get all abilities for this hero
    heroData.abilities.forEach((abilityId: string) => {
      const ability = this.abilitiesData[abilityId];
      if (!ability) return;

      const levelReq = ability.levelRequired || 1;
      const isUnlocked = state ? state.level >= levelReq : true;
      const lockText = isUnlocked ? '' : ` [Lv ${levelReq}]`;
      const nameColor = isUnlocked ? '#aaaaff' : '#666666';

      // Ability name
      lines.push({ text: `${ability.name}${lockText}`, color: nameColor, size: '14px' });

      if (isUnlocked) {
        // Cost
        const costText = ability.cost > 0
          ? `  Cost: ${ability.cost} ${ability.costType}`
          : '  Cost: Free';
        lines.push({ text: costText, color: '#cccccc', size: '12px' });

        // Range
        const rangeText = ability.range === 0
          ? '  Range: Self'
          : ability.range === 1
            ? '  Range: Melee (1 tile)'
            : `  Range: ${ability.range} tiles`;
        lines.push({ text: rangeText, color: '#cccccc', size: '12px' });

        // Type-specific info
        this.addAbilityMechanics(lines, ability);
      } else {
        lines.push({ text: '  (Locked - reach higher level)', color: '#666666', size: '12px' });
      }

      lines.push({ text: '', color: '#ffffff', size: '12px' });
    });

    let lineY = y + 10;
    lines.forEach(line => {
      const text = this.add.text(x + 10, lineY, line.text, {
        fontFamily: 'monospace',
        fontSize: line.size,
        color: line.color,
        wordWrap: { width: width - 20 },
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.contentElements.push(text);
      lineY += line.text === '' ? 8 : 16;
    });
  }

  private addAbilityMechanics(lines: { text: string; color: string; size: string }[], ability: AbilityData): void {
    const abilityAny = ability as unknown as Record<string, unknown>;

    // Damage
    if (abilityAny.damage) {
      const damageOnSave = abilityAny.damageOnSave === 'half' ? ' (half on save)' : '';
      lines.push({ text: `  Damage: ${abilityAny.damage}${damageOnSave}`, color: '#ff8888', size: '12px' });
    }

    // Bonus damage when hidden (sneak attack)
    if (abilityAny.bonusDamageIfHidden) {
      lines.push({ text: `  Sneak Attack: +${abilityAny.bonusDamageIfHidden} if hidden`, color: '#ff88ff', size: '12px' });
    }

    // Healing
    if (abilityAny.healing) {
      lines.push({ text: `  Healing: ${abilityAny.healing}`, color: '#88ff88', size: '12px' });
    }

    // AOE
    if (abilityAny.areaSize) {
      const size = abilityAny.areaSize as { width: number; height: number };
      lines.push({ text: `  Area: ${size.width}x${size.height} tiles`, color: '#ffff88', size: '12px' });
    }

    // Effects
    if (abilityAny.effect) {
      const effect = abilityAny.effect as Record<string, unknown>;
      const effectType = effect.type as string;

      switch (effectType) {
        case 'hidden':
          lines.push({ text: '  Effect: Become hidden (+2 DEF)', color: '#88ffff', size: '12px' });
          lines.push({ text: '  Breaks on: attack or taking damage', color: '#888888', size: '11px' });
          break;
        case 'exposed':
          lines.push({ text: '  Effect: Target exposed (-2 DEF)', color: '#88ffff', size: '12px' });
          lines.push({ text: '  Duration: Until next attack on them', color: '#888888', size: '11px' });
          break;
        case 'barkskin':
          lines.push({ text: '  Effect: Target gains +2 DEF', color: '#88ffff', size: '12px' });
          lines.push({ text: `  Duration: ${effect.duration} rounds`, color: '#888888', size: '11px' });
          break;
        case 'held':
          lines.push({ text: '  Effect: Target cannot act', color: '#88ffff', size: '12px' });
          lines.push({ text: `  Duration: ${effect.durationOnFail} rounds (${effect.durationOnSave} on save)`, color: '#888888', size: '11px' });
          break;
        case 'poison':
          lines.push({ text: `  Effect: ${effect.damagePerTurn} poison/turn`, color: '#88ffff', size: '12px' });
          lines.push({ text: `  Duration: ${effect.durationOnFail} rounds (${effect.durationOnSave} on save)`, color: '#888888', size: '11px' });
          break;
        case 'immobilized':
          lines.push({ text: '  Effect: Target cannot move', color: '#88ffff', size: '12px' });
          lines.push({ text: `  Duration: ${effect.durationOnFail} round(s)`, color: '#888888', size: '11px' });
          break;
        case 'entangle_zone':
          lines.push({ text: '  Effect: Creates vine zone', color: '#88ffff', size: '12px' });
          lines.push({ text: '  Damages on entry & turn start', color: '#888888', size: '11px' });
          lines.push({ text: `  Duration: ${effect.duration} rounds`, color: '#888888', size: '11px' });
          break;
        case 'remove_status':
          lines.push({ text: '  Effect: Remove 1 negative status', color: '#88ffff', size: '12px' });
          break;
        case 'rage':
          lines.push({ text: '  Effect: +2 ATK, +2 damage per hit', color: '#88ffff', size: '12px' });
          lines.push({ text: `  Duration: ${effect.duration} rounds`, color: '#888888', size: '11px' });
          break;
        case 'inspired':
          lines.push({ text: '  Effect: +2 ATK, +2 RES', color: '#88ffff', size: '12px' });
          lines.push({ text: `  Duration: ${effect.duration} rounds`, color: '#888888', size: '11px' });
          break;
        case 'dodge':
          lines.push({ text: '  Effect: +2 DEF (evasive stance)', color: '#88ffff', size: '12px' });
          lines.push({ text: `  Duration: ${effect.duration} rounds`, color: '#888888', size: '11px' });
          break;
      }
    }

    // Description
    lines.push({ text: `  "${ability.description}"`, color: '#888888', size: '11px' });
  }

  private selectMenuItem(): void {
    const option = this.menuOptions[this.menuSelectedIndex];

    switch (option) {
      case 'Party':
        this.partySelectedIndex = 0;
        this.showPartyView();
        break;
      case 'Inventory':
        this.showInventoryView();
        break;
      case 'Combat':
        this.combatSelectedIndex = 0;
        this.showCombatView();
        break;
      case 'Close':
        this.closeMenu();
        break;
    }
  }

  private closeMenu(): void {
    this.scene.stop();
    this.scene.resume(this.returnScene);
  }

  update(): void {
    // ESC to close or go back
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      if (this.currentView === 'main') {
        this.closeMenu();
      } else if (this.currentView === 'hrothgar') {
        // From Hrothgar menu, close entirely (return to town)
        this.closeMenu();
      } else if (this.currentView === 'equipment') {
        // From equipment management, go back to Hrothgar menu
        this.showHrothgarView();
      } else if (this.currentView === 'rune') {
        // From rune application, handle via handleRuneInput
        this.handleRuneInput('esc');
      } else if (this.currentView === 'combat' && this.hrothgarMenuTexts.length > 0) {
        // If we came from Hrothgar, go back to Hrothgar menu
        this.showHrothgarView();
      } else {
        this.showMainMenu();
      }
      return;
    }

    // Tab key for equipment mode switching
    if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
      if (this.currentView === 'equipment') {
        this.handleEquipmentInput('tab');
      }
      return;
    }

    // Navigation
    if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
      if (this.currentView === 'main') {
        this.menuSelectedIndex = Math.max(0, this.menuSelectedIndex - 1);
        this.updateMenuSelection();
      } else if (this.currentView === 'party') {
        this.partySelectedIndex = Math.max(0, this.partySelectedIndex - 1);
        this.renderHeroCard(this.partyHeroIds[this.partySelectedIndex]);
      } else if (this.currentView === 'combat') {
        this.combatSelectedIndex = Math.max(0, this.combatSelectedIndex - 1);
        this.combatContentScrollOffset = 0; // Reset scroll on menu change
        this.updateCombatMenuSelection();
        this.renderCombatContent();
      } else if (this.currentView === 'hrothgar') {
        this.hrothgarSelectedIndex = Math.max(0, this.hrothgarSelectedIndex - 1);
        this.updateHrothgarMenuSelection();
      } else if (this.currentView === 'equipment') {
        this.handleEquipmentInput('up');
      } else if (this.currentView === 'rune') {
        this.handleRuneInput('up');
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
      if (this.currentView === 'main') {
        this.menuSelectedIndex = Math.min(this.menuOptions.length - 1, this.menuSelectedIndex + 1);
        this.updateMenuSelection();
      } else if (this.currentView === 'party') {
        this.partySelectedIndex = Math.min(this.partyHeroIds.length - 1, this.partySelectedIndex + 1);
        this.renderHeroCard(this.partyHeroIds[this.partySelectedIndex]);
      } else if (this.currentView === 'combat') {
        this.combatSelectedIndex = Math.min(this.combatMenuOptions.length - 1, this.combatSelectedIndex + 1);
        this.combatContentScrollOffset = 0; // Reset scroll on menu change
        this.updateCombatMenuSelection();
        this.renderCombatContent();
      } else if (this.currentView === 'hrothgar') {
        this.hrothgarSelectedIndex = Math.min(this.hrothgarMenuOptions.length - 1, this.hrothgarSelectedIndex + 1);
        this.updateHrothgarMenuSelection();
      } else if (this.currentView === 'equipment') {
        this.handleEquipmentInput('down');
      } else if (this.currentView === 'rune') {
        this.handleRuneInput('down');
      }
    }

    // Left/Right for scrolling content in combat view
    if (Phaser.Input.Keyboard.JustDown(this.leftKey)) {
      if (this.currentView === 'combat' && this.combatContentMaxScroll > 0) {
        this.combatContentScrollOffset = Math.max(0, this.combatContentScrollOffset - 60);
        this.renderCombatContent();
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.rightKey)) {
      if (this.currentView === 'combat' && this.combatContentMaxScroll > 0) {
        this.combatContentScrollOffset = Math.min(this.combatContentMaxScroll, this.combatContentScrollOffset + 60);
        this.renderCombatContent();
      }
    }

    // Enter to select
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      if (this.currentView === 'main') {
        this.selectMenuItem();
      } else if (this.currentView === 'hrothgar') {
        this.selectHrothgarMenuItem();
      } else if (this.currentView === 'equipment') {
        this.handleEquipmentInput('enter');
      } else if (this.currentView === 'rune') {
        this.handleRuneInput('enter');
      }
    }
  }
}
