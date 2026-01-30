import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import {
  BattleConfig,
  HeroData,
  EnemyData,
  Unit,
  BattlePhase,
  InitiativeEntry,
  Ability,
  STATUS_COLORS,
  StatusEffectType,
  Zone,
} from '../data/BattleTypes';
import { createHeroUnit, createEnemyUnit, moveUnitToGrid, resetUnitTurnState, hasStatusEffect, createHpBar, createConditionMarkers, updateConditionMarkers, updateHpBar, applyHealing, markUnitMoved } from '../entities/Unit';
import { GridManager } from '../systems/GridManager';
import { rollInitiative, rollDice } from '../systems/DiceRoller';
import {
  resolveAttack,
  resolveSpell,
  resolveHeal,
  resolveSelfAbility,
  canUseAbility,
  payAbilityCost,
  getValidTargets,
  getDistance,
} from '../systems/CombatResolver';
import { AIController } from '../systems/AIController';
import { DialogueRenderer } from '../systems/DialogueRenderer';
import { XPTracker } from '../systems/XPTracker';
import { HeroState, SaveManager, SaveSlotPreview } from '../systems/SaveManager';
import { ProgressBar } from '../components/ProgressBar';
import { InventoryManager } from '../systems/InventoryManager';
import { LootManager } from '../systems/LootManager';
import { InventoryState, ChestState, createDefaultInventory, ConsumableId, ItemData, createDefaultEquipmentBonusState } from '../data/ItemTypes';

interface BattleSceneData {
  battleMap: string;
  heroId: string; // The player-selected hero (for return to town)
  devMode?: boolean; // Dev mode unlocks all abilities regardless of level
  heroState?: Record<string, HeroState>; // Hero state from save (Phase 5)
  gameFlags?: Record<string, boolean>; // Game flags from save
  playTime?: number; // Play time from save
  inventory?: InventoryState; // Party inventory from save (Phase 10)
  chests?: Record<string, ChestState>; // Chest states from save (Phase 10)
  returnScene?: string; // Scene to return to after battle
  returnPosition?: { x: number; y: number }; // Position to return to in that scene
  // Opening battle "lights on" reveal
  showLightsOnReveal?: boolean; // Start with black screen and do flash reveal
  battleIntroDialogue?: { speaker: string; text: string; portrait?: string }[]; // Dialogue to show after reveal
}

// Movement range for all units (per Phase 4 design: fixed 6 squares)
const MOVEMENT_RANGE = 6;

export class BattleScene extends Phaser.Scene {
  // Map and display
  private mapImage!: Phaser.GameObjects.Image;
  private gridOverlay!: Phaser.GameObjects.Graphics;
  private highlightGraphics!: Phaser.GameObjects.Graphics;

  // Battle configuration
  private battleConfig!: BattleConfig;
  private battleMap: string = 'abandoned_distillery';
  private heroId: string = 'arden';
  private devMode: boolean = false;
  private returnScene: string = 'SparkworksScene';
  private returnPosition: { x: number; y: number } | null = null;

  // Lights-on reveal for opening battle
  private showLightsOnReveal: boolean = false;
  private battleIntroDialogue: { speaker: string; text: string; portrait?: string }[] = [];
  private blackOverlay: Phaser.GameObjects.Rectangle | null = null;

  // Data references
  private heroesData!: Record<string, HeroData>;
  private enemiesData!: Record<string, EnemyData>;
  private abilitiesData!: Record<string, Ability>;

  // Grid system
  private gridManager!: GridManager;

  // AI system
  private aiController!: AIController;

  // Units
  private units: Unit[] = [];
  private heroUnits: Unit[] = [];
  private enemyUnits: Unit[] = [];

  // Static props (non-interactable decorations)
  private propSprites: Phaser.GameObjects.Sprite[] = [];

  // Selection state
  private selectedUnit: Unit | null = null;
  private movementTiles: { x: number; y: number }[] = [];
  private isMoving: boolean = false;
  private isInMovementMode: boolean = false;

  // Turn system state
  private turnOrder: InitiativeEntry[] = [];
  private currentTurnIndex: number = 0;
  private round: number = 0;
  private phase: BattlePhase = 'rolling_initiative';
  private activeUnit: Unit | null = null;

  // Action menu state
  private actionMenuContainer: Phaser.GameObjects.Container | null = null;
  private actionMenuIndex: number = 0;
  private showingActionMenu: boolean = false;

  // Item submenu state
  private itemMenuContainer: Phaser.GameObjects.Container | null = null;
  private itemMenuIndex: number = 0;
  private showingItemMenu: boolean = false;
  private selectedItemId: string | null = null;

  // Targeting state
  private isTargeting: boolean = false;
  private selectedAbility: Ability | null = null;
  private validTargets: Unit[] = [];
  private targetIndex: number = 0;
  private targetHighlightGraphics!: Phaser.GameObjects.Graphics;

  // AOE targeting state
  private isAOETargeting: boolean = false;
  private aoeOrigin: { x: number; y: number } = { x: 0, y: 0 };
  private aoeSize: { width: number; height: number } = { width: 2, height: 2 };
  private validAOETiles: { x: number; y: number }[] = [];

  // Persistent zones (e.g. Entangle)
  private zones: Zone[] = [];
  private zoneGraphics!: Phaser.GameObjects.Graphics;

  // Cursor for keyboard movement
  private cursorGraphics!: Phaser.GameObjects.Graphics;
  private cursorPosition: { x: number; y: number } = { x: 0, y: 0 };
  private pathPreviewGraphics!: Phaser.GameObjects.Graphics;

  // Camera
  private readonly CAMERA_ZOOM = 1.5;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // UI references
  private uiContainer!: Phaser.GameObjects.Container;
  private turnOrderContainer!: Phaser.GameObjects.Container;
  private roundText!: Phaser.GameObjects.Text;

  // Combat log
  private combatLogContainer!: Phaser.GameObjects.Container;
  private combatLogMessages: string[] = [];
  private readonly MAX_LOG_MESSAGES = 8;

  // Active unit panel (bottom-left, shows active hero's stats during their turn)
  private activeUnitPanel: Phaser.GameObjects.Container | null = null;

  // Dialogue system for cutscenes
  private dialogueRenderer!: DialogueRenderer;

  // Victory/Defeat screen
  private resultScreenContainer: Phaser.GameObjects.Container | null = null;

  // Battle statistics for summary
  private battleStats = {
    enemiesDefeated: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    roundsCompleted: 0,
  };

  // Click-to-advance system (Shining Force style)
  private waitingForAdvance: boolean = false;
  private pendingAdvanceCallback: (() => void) | null = null;

  // Action result panel (Phase 5 - enhanced feedback)
  private actionResultPanel: Phaser.GameObjects.Container | null = null;
  private currentActionXP: number = 0; // XP earned in current action
  private hasEarnedXPThisTurn: boolean = false; // Only first action per turn earns XP

  // Enemy turn indicator (Phase 8 - visual polish)
  private enemyTurnIndicator: Phaser.GameObjects.Container | null = null;

  // Input grace period (prevents stuck keys from TravelScene transition)
  private inputEnabled: boolean = false;

  // Native key state tracking for camera panning (avoids Phaser's stale key state bug)
  private cameraPanKeys = { up: false, down: false, left: false, right: false };
  private cameraPanKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private cameraPanKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  // XP and progression tracking (Phase 5)
  private xpTracker!: XPTracker;
  private heroState: Record<string, HeroState> = {};
  private gameFlags: Record<string, boolean> = {};
  private playTime: number = 0;
  private sessionStartTime: number = 0;

  constructor() {
    super({ key: 'BattleScene' });
  }

  create(data: BattleSceneData): void {
    // Stop any camera follow from previous scene (e.g., TravelScene)
    this.cameras.main.stopFollow();

    // Start combat music (stop any previous music first)
    // If doing lights-on reveal, delay music until the reveal
    this.sound.stopAll();
    if (!this.showLightsOnReveal) {
      this.sound.play('music_combat', { loop: true, volume: 0.5 });
    }

    // Disable input briefly to prevent stuck keys from previous scene (TravelScene transition)
    this.inputEnabled = false;
    this.time.delayedCall(200, () => {
      this.inputEnabled = true;
    });

    // Setup native key tracking for camera panning (avoids Phaser's stale key state bug)
    this.cameraPanKeys = { up: false, down: false, left: false, right: false };
    this.setupCameraPanKeyListeners();

    this.battleMap = data.battleMap || 'abandoned_distillery';
    this.heroId = data.heroId || 'arden';
    this.devMode = data.devMode ?? false;
    this.returnScene = data.returnScene || 'SparkworksScene';
    this.returnPosition = data.returnPosition || null;
    this.showLightsOnReveal = data.showLightsOnReveal ?? false;
    this.battleIntroDialogue = data.battleIntroDialogue || [];

    // Initialize hero state and XP tracking (Phase 5)
    this.heroState = data.heroState || SaveManager.createInitialHeroState();
    this.gameFlags = data.gameFlags || {};
    this.playTime = data.playTime || 0;
    this.sessionStartTime = Date.now();
    this.xpTracker = new XPTracker(this.heroState);

    // Initialize inventory and loot system (Phase 10)
    // Load items data from Phaser cache (loaded in PreloadScene)
    const itemsJson = this.cache.json.get('data_items');
    if (itemsJson) {
      InventoryManager.setItemsData(itemsJson);
    }
    this.inventory = data.inventory || createDefaultInventory();
    this.chestStates = data.chests || {};
    this.inventoryManager = new InventoryManager(this.inventory, this.heroState);
    this.lootManager = new LootManager(this.chestStates, this.inventoryManager);
    this.explorationChests = [];

    // Reset state
    this.selectedUnit = null;
    this.movementTiles = [];
    this.isMoving = false;
    this.isInMovementMode = false;
    this.cursorPosition = { x: 0, y: 0 };
    this.units = [];
    this.heroUnits = [];
    this.enemyUnits = [];
    this.propSprites = [];

    // Reset turn system state
    this.turnOrder = [];
    this.currentTurnIndex = 0;
    this.round = 0;
    this.phase = 'rolling_initiative';
    this.activeUnit = null;

    // Reset action menu and targeting state
    this.actionMenuContainer = null;
    this.actionMenuIndex = 0;
    this.showingActionMenu = false;
    this.isTargeting = false;
    this.selectedAbility = null;
    this.validTargets = [];
    this.targetIndex = 0;

    // Reset item menu state
    this.itemMenuContainer = null;
    this.itemMenuIndex = 0;
    this.showingItemMenu = false;
    this.selectedItemId = null;

    // Reset AOE targeting state
    this.isAOETargeting = false;
    this.aoeOrigin = { x: 0, y: 0 };
    this.aoeSize = { width: 2, height: 2 };
    this.validAOETiles = [];

    // Reset persistent zones
    this.zones = [];

    // Reset combat log
    this.combatLogMessages = [];

    // Reset click-to-advance state
    this.waitingForAdvance = false;
    this.pendingAdvanceCallback = null;

    // Load data
    this.loadBattleData();

    // Override hero state if battle config specifies a heroLevel (for testing)
    if (this.battleConfig.heroLevel && !data.heroState) {
      this.heroState = SaveManager.createHeroStateAtLevel(this.battleConfig.heroLevel);
      this.xpTracker = new XPTracker(this.heroState);
    }

    // Initialize grid manager
    this.gridManager = new GridManager(
      this.battleConfig.terrain,
      this.battleConfig.gridWidth,
      this.battleConfig.gridHeight
    );

    // Initialize AI controller
    this.aiController = new AIController(this.gridManager, this.abilitiesData);

    // Setup the battle map
    this.setupMap();

    // Create highlight graphics (below units)
    this.highlightGraphics = this.add.graphics();

    // Create path preview graphics (below cursor, above highlights)
    this.pathPreviewGraphics = this.add.graphics();

    // Create zone graphics (for persistent effects like Entangle)
    this.zoneGraphics = this.add.graphics();
    this.zoneGraphics.setDepth(5); // Above terrain, below units

    // Create cursor graphics (on top of everything except UI)
    this.cursorGraphics = this.add.graphics();

    // Create target highlight graphics
    this.targetHighlightGraphics = this.add.graphics();

    // Place units
    this.placeHeroes();
    this.placeEnemies();

    // Place static props (non-interactable decorations)
    this.placeProps();

    // Register units with grid manager
    this.units.forEach(unit => {
      this.gridManager.placeUnit(unit, unit.gridX, unit.gridY);
    });

    // Setup camera
    this.setupCamera();

    // Spawn treasure chests early so they're visible during combat as a teaser
    this.spawnExplorationChests();

    // Draw grid overlay (on top of units)
    this.drawGridOverlay();

    // Setup input
    this.setupInput();

    // Show battle start info
    this.showBattleInfo();

    // Initialize dialogue renderer for cutscenes - position at bottom-left
    this.dialogueRenderer = new DialogueRenderer(this);
    this.dialogueRenderer.setScrollFactor(0);
    this.dialogueRenderer.setPosition(10, 480);
    // Make main camera ignore dialogue (it will be rendered by uiCamera)
    this.cameras.main.ignore(this.dialogueRenderer.getContainer());

    // Reset battle stats
    this.battleStats = {
      enemiesDefeated: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      roundsCompleted: 0,
    };

    // Check if we need to do the lights-on reveal (opening battle from cutscene)
    if (this.showLightsOnReveal) {
      this.doLightsOnReveal();
    } else if (this.battleConfig.introCutscene && this.battleConfig.introCutscene.length > 0) {
      // Standard intro cutscene from battle config
      this.showIntroCutscene();
    } else {
      // No intro cutscene - show dev menu (or start battle in player mode)
      this.time.delayedCall(500, () => {
        this.showDevBattleMenu();
      });
    }
  }

  /**
   * Do the "lights on" reveal for the opening battle
   * Shows black screen, flash effect, then reveals the battle with all sprites
   */
  private lightsOnDialogueIndex: number = 0;

  private doLightsOnReveal(): void {
    this.phase = 'intro';

    // Create black overlay covering everything
    this.blackOverlay = this.add.rectangle(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000
    );
    this.blackOverlay.setScrollFactor(0);
    this.blackOverlay.setDepth(9000); // Above everything except UI

    // Brief pause, then flash and reveal
    this.time.delayedCall(300, () => {
      // Create flash effect
      const flash = this.add.rectangle(
        this.cameras.main.width / 2,
        this.cameras.main.height / 2,
        this.cameras.main.width,
        this.cameras.main.height,
        0xffffff,
        0
      );
      flash.setScrollFactor(0);
      flash.setDepth(9001);

      // Start combat music
      this.sound.play('music_combat', { loop: true, volume: 0.5 });

      // Flash animation
      this.tweens.add({
        targets: flash,
        alpha: 1,
        duration: 200,
        yoyo: true,
        onComplete: () => {
          flash.destroy();

          // Remove black overlay to reveal the battle
          if (this.blackOverlay) {
            this.blackOverlay.destroy();
            this.blackOverlay = null;
          }

          // Show battle intro dialogue if provided
          if (this.battleIntroDialogue.length > 0) {
            this.lightsOnDialogueIndex = 0;
            this.showNextLightsOnDialogueLine();
          } else {
            // No dialogue, go straight to dev menu
            this.showDevBattleMenu();
          }
        }
      });
    });
  }

  private showNextLightsOnDialogueLine(): void {
    if (this.lightsOnDialogueIndex >= this.battleIntroDialogue.length) {
      // Dialogue complete, show dev menu
      this.showDevBattleMenu();
      return;
    }

    const line = this.battleIntroDialogue[this.lightsOnDialogueIndex];
    const portraitKey = line.portrait || `portrait_${line.speaker.toLowerCase()}`;

    this.dialogueRenderer.startDialogue(
      [line.text],
      line.speaker,
      () => {
        this.lightsOnDialogueIndex++;
        this.showNextLightsOnDialogueLine();
      },
      this.textures.exists(portraitKey) ? portraitKey : undefined
    );
  }

  /**
   * Show the pre-battle intro cutscene
   * Supports both simple string[] and CutsceneLine[] formats
   */
  private introCutsceneIndex: number = 0;

  private showIntroCutscene(): void {
    this.phase = 'intro';
    const cutscene = this.battleConfig.introCutscene!;

    // Check if using new format (array of objects with speaker/text)
    if (cutscene.length > 0 && typeof cutscene[0] === 'object') {
      this.introCutsceneIndex = 0;
      this.showNextCutsceneLine();
    } else {
      // Old format - simple string array with Narrator
      this.dialogueRenderer.startDialogue(
        cutscene as string[],
        'Narrator',
        () => {
          this.showDevBattleMenu();
        }
      );
    }
  }

  private showNextCutsceneLine(): void {
    const cutscene = this.battleConfig.introCutscene as { speaker: string; text: string; portrait?: string }[];

    if (this.introCutsceneIndex >= cutscene.length) {
      // Cutscene complete
      this.showDevBattleMenu();
      return;
    }

    const line = cutscene[this.introCutsceneIndex];
    const portraitKey = line.portrait || `portrait_${line.speaker.toLowerCase()}`;

    this.dialogueRenderer.startDialogue(
      [line.text],
      line.speaker,
      () => {
        this.introCutsceneIndex++;
        this.showNextCutsceneLine();
      },
      this.textures.exists(portraitKey) ? portraitKey : undefined
    );
  }

  /**
   * Show dev menu to choose between running battle or auto-winning (dev mode only)
   * In player mode, goes straight to battle
   */
  private devBattleMenuContainer: Phaser.GameObjects.Container | null = null;
  private devMenuSelectedIndex: number = 0;

  private showDevBattleMenu(): void {
    // If no enemies and explore mode, skip straight to exploration
    if (this.enemyUnits.length === 0 && this.battleConfig.postVictoryMode === 'explore') {
      this.time.delayedCall(300, () => {
        this.enterExplorationMode();
      });
      return;
    }

    // In player mode, skip the menu and go straight to battle
    if (!this.devMode) {
      this.time.delayedCall(300, () => {
        this.startNewRound();
      });
      return;
    }

    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    this.devBattleMenuContainer = this.add.container(0, 0);
    this.devBattleMenuContainer.setScrollFactor(0);
    this.devBattleMenuContainer.setDepth(2000);
    this.cameras.main.ignore(this.devBattleMenuContainer);

    // Semi-transparent background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.7);
    bg.fillRect(0, 0, screenWidth, screenHeight);
    this.devBattleMenuContainer.add(bg);

    // Menu box
    const boxWidth = 300;
    const boxHeight = 150;
    const boxX = (screenWidth - boxWidth) / 2;
    const boxY = (screenHeight - boxHeight) / 2;

    const box = this.add.graphics();
    box.fillStyle(0x222244, 1);
    box.fillRoundedRect(boxX, boxY, boxWidth, boxHeight, 10);
    box.lineStyle(3, 0xffff00, 1);
    box.strokeRoundedRect(boxX, boxY, boxWidth, boxHeight, 10);
    this.devBattleMenuContainer.add(box);

    // Title
    const title = this.add.text(screenWidth / 2, boxY + 25, 'BATTLE OPTIONS', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffff00',
      fontStyle: 'bold',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    title.setOrigin(0.5);
    this.devBattleMenuContainer.add(title);

    // Options
    const options = ['Run Fight', 'Auto Win'];
    const optionTexts: Phaser.GameObjects.Text[] = [];

    options.forEach((option, index) => {
      const text = this.add.text(screenWidth / 2, boxY + 60 + index * 35, option, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: index === 0 ? '#ffffff' : '#888888',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      text.setOrigin(0.5);
      optionTexts.push(text);
      this.devBattleMenuContainer!.add(text);
    });

    // Instructions
    const instructions = this.add.text(screenWidth / 2, boxY + boxHeight - 20, '↑↓ Select | Enter Confirm', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
    });
    instructions.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    instructions.setOrigin(0.5);
    this.devBattleMenuContainer.add(instructions);

    // Input handling
    this.devMenuSelectedIndex = 0;

    const updateSelection = () => {
      optionTexts.forEach((text, index) => {
        text.setColor(index === this.devMenuSelectedIndex ? '#ffffff' : '#888888');
      });
    };

    const handleInput = (event: KeyboardEvent) => {
      if (!this.devBattleMenuContainer) return;

      if (event.key === 'ArrowUp') {
        this.devMenuSelectedIndex = Math.max(0, this.devMenuSelectedIndex - 1);
        updateSelection();
      } else if (event.key === 'ArrowDown') {
        this.devMenuSelectedIndex = Math.min(options.length - 1, this.devMenuSelectedIndex + 1);
        updateSelection();
      } else if (event.key === 'Enter') {
        // Remove listener
        window.removeEventListener('keydown', handleInput);

        // Destroy menu
        this.devBattleMenuContainer?.destroy();
        this.devBattleMenuContainer = null;

        if (this.devMenuSelectedIndex === 0) {
          // Run Fight
          this.time.delayedCall(300, () => {
            this.startNewRound();
          });
        } else {
          // Auto Win - trigger victory
          this.autoWinBattle();
        }
      }
    };

    window.addEventListener('keydown', handleInput);
  }

  /**
   * Auto-win the battle for testing purposes
   */
  private autoWinBattle(): void {
    // Mark all enemies as defeated
    this.enemyUnits.forEach((enemy) => {
      enemy.currentHp = 0;
      enemy.isUnconscious = true;
      if (enemy.sprite) {
        enemy.sprite.setAlpha(0.3);
      }
    });

    // Trigger victory
    this.handleVictory();
  }

  private loadBattleData(): void {
    // Load battle configuration
    this.battleConfig = this.cache.json.get(`data_battle_${this.battleMap}`);
    if (!this.battleConfig) {
      console.error(`Battle config not found for: ${this.battleMap}`);
      return;
    }

    // Load hero and enemy data
    this.heroesData = this.cache.json.get('data_heroes');
    this.enemiesData = this.cache.json.get('data_enemies');
    this.abilitiesData = this.cache.json.get('data_abilities');
  }

  private setupMap(): void {
    // Load the battle map as background
    // Use mapImage from config if specified, otherwise fall back to battleMap name
    const mapKey = this.battleConfig.mapImage || `map_${this.battleMap}`;
    this.mapImage = this.add.image(0, 0, mapKey);
    this.mapImage.setOrigin(0, 0);

    // Calculate scale based on actual texture size vs expected grid size
    // Expected size: gridWidth * TILE_SIZE (32px per tile)
    const expectedWidth = this.battleConfig.gridWidth * GAME_CONFIG.TILE_SIZE;
    const actualWidth = this.mapImage.width;
    const scale = expectedWidth / actualWidth;
    this.mapImage.setScale(scale);
  }

  private placeHeroes(): void {
    // Get all 5 heroes in order (Rifthaven heroes)
    const heroIds = ['arden', 'quin', 'veil', 'ty', 'thorn'];
    const positions = this.battleConfig.heroStartPositions;

    heroIds.forEach((heroId, index) => {
      if (index >= positions.length) return;

      const heroData = this.heroesData[heroId];
      if (!heroData) {
        console.error(`Hero data not found for: ${heroId}`);
        return;
      }

      const pos = positions[index];
      const unit = createHeroUnit(heroData, pos.x, pos.y, this);

      // Apply saved hero state (Phase 5 - level, current HP/Mana)
      const savedState = this.heroState[heroId];
      if (savedState) {
        const level = savedState.level;

        // Update max stats based on level from SaveManager
        unit.maxHp = SaveManager.getMaxHp(heroId, level);
        const maxMana = SaveManager.getMaxMana(heroId, level);
        if (maxMana !== null) {
          unit.maxMana = maxMana;
        }
        // Veil uses Ki instead of Mana
        if (heroId === 'veil') {
          unit.maxKi = SaveManager.getMaxKi(level);
        }

        // Set current HP/Mana from saved state (capped at new max)
        unit.currentHp = Math.min(savedState.currentHp, unit.maxHp);
        if (savedState.currentMana !== null && savedState.currentMana !== undefined) {
          unit.currentMana = Math.min(savedState.currentMana, unit.maxMana || 0);
        }
        if (savedState.currentKi !== undefined && savedState.currentKi !== null) {
          unit.currentKi = Math.min(savedState.currentKi, unit.maxKi || 0);
        }

        // Also update heroesData level for ability checks
        heroData.level = level;

        // Set equipment from saved state (Phase 10 - Equipment System)
        if (savedState.equipment) {
          unit.equipment = savedState.equipment;
          unit.equipmentBonusState = createDefaultEquipmentBonusState();
        }

        // Set permanent damage bonus from saved state (Phase 10 - Permanent Upgrades)
        if (savedState.permanentBonuses?.damageBonus) {
          unit.damageBonus = savedState.permanentBonuses.damageBonus;
        }
      }

      // Heroes face direction specified in config (default south)
      const heroFacing = this.battleConfig.heroFacing || 'south';
      unit.facing = heroFacing;
      const facingToSprite: Record<string, string> = {
        north: 'back',
        south: 'front',
        east: 'right',
        west: 'left'
      };
      if (unit.sprite) {
        unit.sprite.setTexture(`${heroData.sprite}_${facingToSprite[heroFacing]}`);
        // Make sprite interactive
        unit.sprite.setInteractive({ useHandCursor: true });
        unit.sprite.on('pointerdown', () => this.onUnitClicked(unit));
      }

      // Create HP bar above unit
      createHpBar(unit, this);

      // Create condition markers around unit
      createConditionMarkers(unit, this);

      this.units.push(unit);
      this.heroUnits.push(unit);
    });
  }

  private placeEnemies(): void {
    // Track instance counts for unique IDs
    const instanceCounts: Record<string, number> = {};

    this.battleConfig.enemies.forEach((placement) => {
      const enemyData = this.enemiesData[placement.type];
      if (!enemyData) {
        console.error(`Enemy data not found for: ${placement.type}`);
        return;
      }

      // Generate unique instance ID
      instanceCounts[placement.type] = (instanceCounts[placement.type] || 0) + 1;
      const instanceId = `${placement.type}_${instanceCounts[placement.type]}`;

      const unit = createEnemyUnit(
        enemyData,
        instanceId,
        placement.x,
        placement.y,
        this
      );

      // Set enemy facing direction (configurable per battle, default south = facing heroes)
      const enemyFacing = this.battleConfig.enemyFacing || 'south';
      unit.facing = enemyFacing;
      const facingToSprite: Record<string, string> = {
        north: 'back',
        south: 'front',
        east: 'right',
        west: 'left'
      };
      if (unit.sprite) {
        unit.sprite.setTexture(`${enemyData.sprite}_${facingToSprite[enemyFacing]}`);
        // Make sprite interactive
        unit.sprite.setInteractive({ useHandCursor: true });
        unit.sprite.on('pointerdown', () => this.onUnitClicked(unit));
      }

      // Create HP bar above unit
      createHpBar(unit, this);

      // Create condition markers around unit
      createConditionMarkers(unit, this);

      this.units.push(unit);
      this.enemyUnits.push(unit);
    });
  }

  /**
   * Place static props (non-interactable decorations like unconscious NPCs)
   */
  private placeProps(): void {
    if (!this.battleConfig.props) return;

    this.propSprites = [];

    this.battleConfig.props.forEach((prop) => {
      // Calculate pixel position (center of tile)
      const pixelX = prop.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const pixelY = prop.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

      // Create sprite
      const sprite = this.add.sprite(pixelX, pixelY, prop.sprite);

      // Scale to fit tile (same as units)
      sprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);

      // Apply rotation if specified (convert degrees to radians)
      if (prop.rotation) {
        sprite.setAngle(prop.rotation);
      }

      // Set depth below units but above map
      sprite.setDepth(50);

      this.propSprites.push(sprite);
    });
  }

  private setupCamera(): void {
    const mapWidth = this.battleConfig.gridWidth * GAME_CONFIG.TILE_SIZE;
    const mapHeight = this.battleConfig.gridHeight * GAME_CONFIG.TILE_SIZE;

    // Set camera bounds to map size
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

    // Zoom in for better view
    this.cameras.main.setZoom(this.CAMERA_ZOOM);

    // Center camera on hero start positions (not map center)
    const heroPositions = this.battleConfig.heroStartPositions;
    if (heroPositions && heroPositions.length > 0) {
      // Calculate center of hero positions
      const avgX = heroPositions.reduce((sum, p) => sum + p.x, 0) / heroPositions.length;
      const avgY = heroPositions.reduce((sum, p) => sum + p.y, 0) / heroPositions.length;
      const centerX = avgX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const centerY = avgY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      this.cameras.main.centerOn(centerX, centerY);
    } else {
      // Fallback to map center
      const centerX = mapWidth / 2;
      const centerY = mapHeight / 2;
      this.cameras.main.centerOn(centerX, centerY);
    }

    // Create a separate UI camera that doesn't zoom (for fixed UI elements)
    this.uiCamera = this.cameras.add(0, 0, GAME_CONFIG.WIDTH, GAME_CONFIG.HEIGHT);
    this.uiCamera.setScroll(0, 0);

    // Make UI camera ignore world objects (so it only renders UI)
    this.uiCamera.ignore(this.mapImage);
    this.uiCamera.ignore(this.highlightGraphics);
    this.uiCamera.ignore(this.cursorGraphics);
    this.uiCamera.ignore(this.pathPreviewGraphics);
    this.uiCamera.ignore(this.targetHighlightGraphics);
    this.uiCamera.ignore(this.zoneGraphics);

    // Ignore prop sprites
    if (this.propSprites) {
      this.propSprites.forEach(sprite => {
        this.uiCamera.ignore(sprite);
      });
    }

    // Ignore all unit sprites, HP bar containers, and condition marker containers
    this.units.forEach(unit => {
      if (unit.sprite) {
        this.uiCamera.ignore(unit.sprite);
      }
      if (unit.hpBarContainer) {
        this.uiCamera.ignore(unit.hpBarContainer);
      }
      if (unit.conditionMarkerContainer) {
        this.uiCamera.ignore(unit.conditionMarkerContainer);
      }
    });
  }

  private drawGridOverlay(): void {
    this.gridOverlay = this.add.graphics();
    this.gridOverlay.lineStyle(1, GAME_CONFIG.GRID_COLOR, GAME_CONFIG.GRID_ALPHA);

    const mapWidth = this.battleConfig.gridWidth * GAME_CONFIG.TILE_SIZE;
    const mapHeight = this.battleConfig.gridHeight * GAME_CONFIG.TILE_SIZE;

    // Vertical lines
    for (let x = 0; x <= mapWidth; x += GAME_CONFIG.TILE_SIZE) {
      this.gridOverlay.moveTo(x, 0);
      this.gridOverlay.lineTo(x, mapHeight);
    }

    // Horizontal lines
    for (let y = 0; y <= mapHeight; y += GAME_CONFIG.TILE_SIZE) {
      this.gridOverlay.moveTo(0, y);
      this.gridOverlay.lineTo(mapWidth, y);
    }

    this.gridOverlay.strokePath();

    // Make UI camera ignore the grid overlay
    this.uiCamera.ignore(this.gridOverlay);
  }

  private setupInput(): void {
    // ENTER key - context-dependent confirm
    const enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    enterKey.on('down', () => {
      // Handle shrine save menu
      if (this.shrineSaveMenuVisible) {
        this.handleShrineSaveMenuInput('enter');
        return;
      }

      // Handle click-to-advance first (Shining Force style)
      if (this.waitingForAdvance) {
        this.handleAdvance();
        return;
      }

      // Handle dialogue advancement
      if (this.dialogueRenderer && this.dialogueRenderer.isDialogueActive()) {
        this.dialogueRenderer.advance();
        return;
      }

      // Handle shrine interaction during exploration
      if (this.phase === 'post_battle_explore' && this.isAdjacentToShrine() && !this.shrineDialogueActive) {
        this.handleShrineInteraction();
        return;
      }

      // Handle loot popup dismissal
      if (this.lootPopupActive) {
        this.hideLootPopup();
        return;
      }

      // Handle chest interaction during exploration
      if (this.phase === 'post_battle_explore') {
        const adjacentChest = this.getAdjacentChest();
        if (adjacentChest && !this.lootPopupActive) {
          this.handleChestInteraction();
          return;
        }
      }

      if (this.isAOETargeting) {
        this.confirmAOETarget();
      } else if (this.isTargeting) {
        // Check if we're targeting for an item or an ability
        if (this.selectedItemId) {
          const target = this.validTargets[this.targetIndex];
          if (target) {
            this.executeItemUse(target);
          }
        } else {
          this.confirmTarget();
        }
      } else if (this.showingItemMenu) {
        this.confirmItemMenuSelection();
      } else if (this.showingActionMenu) {
        this.confirmActionMenuSelection();
      } else if (this.isInMovementMode && this.selectedUnit) {
        this.confirmCursorMove();
      } else if (this.phase === 'victory' || this.phase === 'defeat') {
        // Handled by result screen now
        this.handleResultScreenInput();
      }
    });

    // ESC to cancel/deselect, or open menu when nothing to cancel
    const escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    escKey.on('down', () => {
      // Handle shrine save menu
      if (this.shrineSaveMenuVisible) {
        this.handleShrineSaveMenuInput('esc');
        return;
      }

      // Handle defeat screen - ESC returns to town without retry
      if (this.phase === 'defeat' && this.resultScreenContainer) {
        this.returnToTown();
        return;
      }

      if (this.isAOETargeting) {
        this.cancelAOETargeting();
      } else if (this.isTargeting) {
        // Check if we're targeting for an item - go back to item menu
        if (this.selectedItemId) {
          this.cancelItemTargeting();
        } else {
          this.cancelTargeting();
        }
      } else if (this.showingItemMenu) {
        this.hideItemMenu();
        this.showActionMenu();
      } else if (this.showingActionMenu) {
        this.hideActionMenu();
      } else if (this.isInMovementMode) {
        this.exitMovementMode();
      } else if (this.selectedUnit) {
        this.deselectUnit();
      } else {
        // Nothing to cancel - open menu
        // Sync hero stats so menu shows real-time HP/mana
        this.syncHeroStateFromUnits();
        this.scene.pause();
        this.scene.launch('MenuScene', {
          heroState: this.heroState,
          returnScene: 'BattleScene',
          inventory: this.inventoryManager.getInventory(),
        });
      }
    });

    // W to Wait (end turn without acting) - only when not in menu/targeting
    const waitKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    waitKey.on('down', () => {
      if (!this.showingActionMenu && !this.isTargeting) {
        this.waitAction();
      }
    });

    // Q to toggle Action menu (show/hide) or close Item menu
    const toggleMenuKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    toggleMenuKey.on('down', () => {
      if (this.showingItemMenu) {
        this.hideItemMenu();
        this.showActionMenu();
      } else if (this.activeUnit && this.activeUnit.team === 'hero' && !this.isTargeting && !this.isInMovementMode) {
        if (this.showingActionMenu) {
          this.hideActionMenu();
        } else {
          this.showActionMenu();
        }
      }
    });

    // I for Item menu
    const itemKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    itemKey.on('down', () => {
      if (this.showingActionMenu && this.inventoryManager.hasAnyConsumables()) {
        this.selectActionMenuOption('item');
      }
    });

    // M for Move
    const moveKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    moveKey.on('down', () => {
      if (this.showingActionMenu) {
        // Find and select the Move option
        this.selectActionMenuOption('move');
      }
    });

    // A, S, D for abilities (1st, 2nd, 3rd ability in menu)
    const abilityKey1 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    abilityKey1.on('down', () => {
      if (this.showingActionMenu) {
        this.selectActionMenuByIndex(0); // First ability
      }
    });

    const abilityKey2 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    abilityKey2.on('down', () => {
      if (this.showingActionMenu) {
        this.selectActionMenuByIndex(1); // Second ability
      }
    });

    const abilityKey3 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    abilityKey3.on('down', () => {
      if (this.showingActionMenu) {
        this.selectActionMenuByIndex(2); // Third ability
      }
    });

    // Arrow keys - used for cursor movement in movement mode, camera pan otherwise
    this.cursors = this.input.keyboard!.createCursorKeys();
    const cursors = this.cursors;

    // Reset keyboard state to prevent keys from carrying over from previous scene
    this.input.keyboard!.resetKeys();

    // Track last key press time to prevent rapid repeats
    let lastMoveTime = 0;
    const moveDelay = 120; // ms between cursor moves

    this.events.on('update', () => {
      const now = Date.now();

      // Handle shrine save menu navigation
      if (this.shrineSaveMenuVisible) {
        if (now - lastMoveTime > moveDelay) {
          if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
            this.handleShrineSaveMenuInput('up');
            lastMoveTime = now;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.down)) {
            this.handleShrineSaveMenuInput('down');
            lastMoveTime = now;
          }
        }
        return; // Don't process other input while menu is visible
      }

      if (this.showingItemMenu) {
        // In item menu: up/down to navigate
        if (now - lastMoveTime > moveDelay) {
          if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
            this.navigateItemMenu(-1);
            lastMoveTime = now;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.down)) {
            this.navigateItemMenu(1);
            lastMoveTime = now;
          }
        }
      } else if (this.showingActionMenu) {
        // In action menu: up/down to navigate
        if (now - lastMoveTime > moveDelay) {
          if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
            this.navigateActionMenu(-1);
            lastMoveTime = now;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.down)) {
            this.navigateActionMenu(1);
            lastMoveTime = now;
          }
        }
      } else if (this.isAOETargeting) {
        // In AOE targeting mode: arrow keys move the AOE origin
        if (now - lastMoveTime > moveDelay) {
          let moved = false;
          if (Phaser.Input.Keyboard.JustDown(cursors.left)) {
            this.moveAOECursor(-1, 0);
            moved = true;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.right)) {
            this.moveAOECursor(1, 0);
            moved = true;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
            this.moveAOECursor(0, -1);
            moved = true;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.down)) {
            this.moveAOECursor(0, 1);
            moved = true;
          }
          if (moved) {
            lastMoveTime = now;
          }
        }
      } else if (this.isTargeting) {
        // In targeting mode: left/right to cycle targets
        if (now - lastMoveTime > moveDelay) {
          if (Phaser.Input.Keyboard.JustDown(cursors.left) || Phaser.Input.Keyboard.JustDown(cursors.up)) {
            this.cycleTarget(-1);
            lastMoveTime = now;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.right) || Phaser.Input.Keyboard.JustDown(cursors.down)) {
            this.cycleTarget(1);
            lastMoveTime = now;
          }
        }
      } else if (this.isInMovementMode && this.selectedUnit) {
        // In movement mode: arrow keys move cursor
        if (now - lastMoveTime > moveDelay) {
          let moved = false;

          if (Phaser.Input.Keyboard.JustDown(cursors.left)) {
            this.moveCursor(-1, 0);
            moved = true;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.right)) {
            this.moveCursor(1, 0);
            moved = true;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
            this.moveCursor(0, -1);
            moved = true;
          } else if (Phaser.Input.Keyboard.JustDown(cursors.down)) {
            this.moveCursor(0, 1);
            moved = true;
          }

          if (moved) {
            lastMoveTime = now;
          }
        }
      } else if (this.phase === 'post_battle_explore') {
        // Exploration mode: arrow keys move party
        this.handleExplorationInput();
      } else if (this.inputEnabled && this.phase !== 'intro' && this.phase !== 'rolling_initiative' && this.phase !== 'victory' && this.phase !== 'defeat') {
        // Not in any special mode: arrow keys pan camera (but not during cutscenes or initiative roll)
        // Use native key tracking to avoid Phaser's stale key state bug from TravelScene
        const panSpeed = 5;

        if (this.cameraPanKeys.left) {
          this.cameras.main.scrollX -= panSpeed;
        }
        if (this.cameraPanKeys.right) {
          this.cameras.main.scrollX += panSpeed;
        }
        if (this.cameraPanKeys.up) {
          this.cameras.main.scrollY -= panSpeed;
        }
        if (this.cameraPanKeys.down) {
          this.cameras.main.scrollY += panSpeed;
        }
      }
    });

    // Click on map to select units or enter movement mode
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.onMapClicked(pointer);
    });
  }

  /**
   * Setup native browser key listeners for camera panning.
   * This avoids Phaser's stale key state bug when transitioning from TravelScene.
   */
  private setupCameraPanKeyListeners(): void {
    // Remove any existing listeners
    this.cleanupCameraPanKeyListeners();

    // Track key presses using native browser events
    this.cameraPanKeyHandler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp': this.cameraPanKeys.up = true; break;
        case 'ArrowDown': this.cameraPanKeys.down = true; break;
        case 'ArrowLeft': this.cameraPanKeys.left = true; break;
        case 'ArrowRight': this.cameraPanKeys.right = true; break;
      }
    };

    this.cameraPanKeyUpHandler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp': this.cameraPanKeys.up = false; break;
        case 'ArrowDown': this.cameraPanKeys.down = false; break;
        case 'ArrowLeft': this.cameraPanKeys.left = false; break;
        case 'ArrowRight': this.cameraPanKeys.right = false; break;
      }
    };

    window.addEventListener('keydown', this.cameraPanKeyHandler);
    window.addEventListener('keyup', this.cameraPanKeyUpHandler);

    // Also clean up when scene shuts down
    this.events.on('shutdown', this.cleanupCameraPanKeyListeners, this);
  }

  private cleanupCameraPanKeyListeners(): void {
    if (this.cameraPanKeyHandler) {
      window.removeEventListener('keydown', this.cameraPanKeyHandler);
      this.cameraPanKeyHandler = null;
    }
    if (this.cameraPanKeyUpHandler) {
      window.removeEventListener('keyup', this.cameraPanKeyUpHandler);
      this.cameraPanKeyUpHandler = null;
    }
  }

  // ============================================
  // Selection and Movement
  // ============================================

  private onUnitClicked(unit: Unit): void {
    if (this.isMoving) return;

    // If clicking the same unit, deselect
    if (this.selectedUnit === unit) {
      this.deselectUnit();
      return;
    }

    // Select the unit
    this.selectUnit(unit);
  }

  private selectUnit(unit: Unit): void {
    // Deselect previous
    if (this.selectedUnit) {
      this.deselectUnit();
    }

    this.selectedUnit = unit;

    // Add selection highlight to sprite
    if (unit.sprite) {
      unit.sprite.setTint(0xffff00); // Yellow tint for selection
    }

    // Calculate and show movement range for all units
    this.movementTiles = this.gridManager.getMovementRange(
      unit.gridX,
      unit.gridY,
      MOVEMENT_RANGE,
      unit
    );
    this.drawMovementHighlight(unit.team);

    // For heroes, enter movement mode only if it's their turn and they haven't moved
    if (unit.team === 'hero') {
      const isActiveUnit = this.activeUnit === unit;
      const canMove = !unit.hasMoved && isActiveUnit;

      if (canMove) {
        this.enterMovementMode(unit);
      }
    }
  }

  private deselectUnit(): void {
    if (this.selectedUnit?.sprite) {
      this.selectedUnit.sprite.clearTint();
    }
    this.selectedUnit = null;
    this.movementTiles = [];
    this.isInMovementMode = false;
    this.clearHighlights();
    this.clearCursor();
    this.clearPathPreview();
  }

  private onMapClicked(pointer: Phaser.Input.Pointer): void {
    // Handle click-to-advance first (Shining Force style)
    if (this.waitingForAdvance) {
      this.handleAdvance();
      return;
    }

    if (this.isMoving) return;

    // Convert screen position to world position
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const gridPos = this.gridManager.pixelToGrid(worldPoint.x, worldPoint.y);

    // Check if clicked on a unit (handled by sprite click, but backup)
    const clickedUnit = this.gridManager.getUnitAt(gridPos.x, gridPos.y);
    if (clickedUnit) {
      // Unit clicks are handled by sprite pointerdown
      return;
    }

    // If in movement mode, clicking a valid tile moves cursor there and confirms
    if (this.isInMovementMode && this.selectedUnit && this.selectedUnit.team === 'hero') {
      const isValidMove = this.movementTiles.some(
        t => t.x === gridPos.x && t.y === gridPos.y
      );

      if (isValidMove) {
        // Move cursor to clicked position and confirm
        this.cursorPosition = { x: gridPos.x, y: gridPos.y };
        this.drawCursor();
        this.drawPathPreview();
        this.confirmCursorMove();
        return;
      }
    }

    // Clicked empty space - deselect
    this.deselectUnit();
  }

  private async moveSelectedUnit(toX: number, toY: number): Promise<void> {
    if (!this.selectedUnit || this.isMoving) return;

    const unit = this.selectedUnit;
    this.isMoving = true;
    this.isInMovementMode = false;

    // Clear highlights and cursor during movement
    this.clearHighlights();
    this.clearCursor();
    this.clearPathPreview();

    // Get path to destination
    const path = this.gridManager.findPath(
      unit.gridX,
      unit.gridY,
      toX,
      toY,
      unit
    );

    if (!path || path.length === 0) {
      this.isMoving = false;
      return;
    }

    // Update grid manager (remove from old position)
    this.gridManager.removeUnit(unit);

    // Animate along path
    for (const step of path) {
      // Update facing based on movement direction
      this.updateUnitFacing(unit, step.x, step.y);

      // Animate movement to this step
      await moveUnitToGrid(unit, step.x, step.y, this, true, 100);
    }

    // Update grid manager (place at new position)
    this.gridManager.placeUnit(unit, toX, toY);

    // Mark unit as moved (this also reduces Azrael's actions if he moved)
    markUnitMoved(unit);

    this.isMoving = false;

    // Check for zone entry damage
    const zonesEntered = this.getZonesAtPosition(toX, toY);
    for (const zone of zonesEntered) {
      this.applyZoneDamage(unit, zone, 'entry');
    }

    // Check if unit was defeated by zone damage
    if (unit.currentHp <= 0) {
      this.checkBattleEnd();
      if (this.phase === 'victory' || this.phase === 'defeat') {
        return;
      }
      // End turn if hero was defeated
      this.endCurrentTurn();
      return;
    }

    // Keep unit selected but update movement range (which should now be 0)
    this.movementTiles = [];
    this.clearHighlights();

    // After moving, show the action menu so player can attack/use abilities
    if (this.activeUnit === unit && unit.team === 'hero') {
      this.time.delayedCall(200, () => {
        this.showActionMenu();
      });
    } else {
      // Just deselect if this isn't the active hero's turn
      this.time.delayedCall(500, () => {
        this.deselectUnit();
      });
    }
  }

  private updateUnitFacing(unit: Unit, toX: number, toY: number): void {
    const dx = toX - unit.gridX;
    const dy = toY - unit.gridY;

    let newFacing: 'north' | 'south' | 'east' | 'west' = unit.facing;
    let spriteDir = 'front';

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal movement
      if (dx > 0) {
        newFacing = 'east';
        spriteDir = 'right';
      } else {
        newFacing = 'west';
        spriteDir = 'left';
      }
    } else {
      // Vertical movement
      if (dy > 0) {
        newFacing = 'south';
        spriteDir = 'front';
      } else {
        newFacing = 'north';
        spriteDir = 'back';
      }
    }

    unit.facing = newFacing;

    // Update sprite texture
    if (unit.sprite) {
      // Determine base sprite name
      const heroData = this.heroesData[unit.dataId];
      const enemyData = this.enemiesData[unit.dataId];
      const baseSprite = heroData?.sprite || enemyData?.sprite || `sprite_${unit.dataId}`;
      unit.sprite.setTexture(`${baseSprite}_${spriteDir}`);
    }
  }

  // ============================================
  // Cursor Movement Mode
  // ============================================

  private enterMovementMode(unit: Unit): void {
    this.isInMovementMode = true;
    this.cursorPosition = { x: unit.gridX, y: unit.gridY };
    this.drawCursor();

    // Center camera on unit
    const pixelPos = this.gridManager.gridToPixel(unit.gridX, unit.gridY);
    this.cameras.main.pan(pixelPos.x, pixelPos.y, 200);
  }

  private exitMovementMode(): void {
    this.isInMovementMode = false;
    this.clearCursor();
    this.clearPathPreview();
  }

  private moveCursor(dx: number, dy: number): void {
    if (!this.selectedUnit || !this.isInMovementMode) return;

    const newX = this.cursorPosition.x + dx;
    const newY = this.cursorPosition.y + dy;

    // Allow cursor to move freely to any valid, walkable tile
    // The path preview shows if a valid path exists, and confirmation only works on blue tiles
    const isValidPosition = this.gridManager.isValidPosition(newX, newY);
    const isWalkable = this.gridManager.isWalkable(newX, newY);

    if (isValidPosition && isWalkable) {
      this.cursorPosition = { x: newX, y: newY };
      this.drawCursor();
      this.drawPathPreview();

      // Pan camera to follow cursor
      const pixelPos = this.gridManager.gridToPixel(newX, newY);
      this.cameras.main.pan(pixelPos.x, pixelPos.y, 100);
    }
  }

  private confirmCursorMove(): void {
    if (!this.selectedUnit || !this.isInMovementMode) return;

    const cursorX = this.cursorPosition.x;
    const cursorY = this.cursorPosition.y;

    // If cursor is on the unit's current position, just end movement mode (stay in place)
    if (cursorX === this.selectedUnit.gridX && cursorY === this.selectedUnit.gridY) {
      this.exitMovementMode();
      this.deselectUnit();
      return;
    }

    // Only allow moving to valid movement tiles (the blue highlighted squares)
    const isValidMove = this.movementTiles.some(
      t => t.x === cursorX && t.y === cursorY
    );

    if (!isValidMove) {
      // Cursor is not on a valid destination - do nothing
      return;
    }

    // Move to the cursor position
    this.moveSelectedUnit(cursorX, cursorY);
  }

  private drawCursor(): void {
    this.clearCursor();

    const pixelX = this.cursorPosition.x * GAME_CONFIG.TILE_SIZE;
    const pixelY = this.cursorPosition.y * GAME_CONFIG.TILE_SIZE;
    const size = GAME_CONFIG.TILE_SIZE;

    // Draw animated cursor (yellow pulsing border)
    this.cursorGraphics.lineStyle(3, 0xffff00, 1);
    this.cursorGraphics.strokeRect(pixelX + 2, pixelY + 2, size - 4, size - 4);

    // Inner white border for visibility
    this.cursorGraphics.lineStyle(1, 0xffffff, 0.8);
    this.cursorGraphics.strokeRect(pixelX + 4, pixelY + 4, size - 8, size - 8);
  }

  private clearCursor(): void {
    this.cursorGraphics.clear();
  }

  private drawPathPreview(): void {
    this.clearPathPreview();

    if (!this.selectedUnit) return;

    const startX = this.selectedUnit.gridX;
    const startY = this.selectedUnit.gridY;
    const endX = this.cursorPosition.x;
    const endY = this.cursorPosition.y;

    // Don't draw path if cursor is on the unit
    if (startX === endX && startY === endY) return;

    // Get the path
    const path = this.gridManager.findPath(startX, startY, endX, endY, this.selectedUnit);
    if (!path || path.length === 0) return;

    // Draw path as a series of connected dots/lines
    this.pathPreviewGraphics.lineStyle(3, 0x00ff00, 0.7);

    // Start from unit position
    const startPixel = this.gridManager.gridToPixel(startX, startY);
    this.pathPreviewGraphics.moveTo(startPixel.x, startPixel.y);

    // Draw line through each step
    for (const step of path) {
      const stepPixel = this.gridManager.gridToPixel(step.x, step.y);
      this.pathPreviewGraphics.lineTo(stepPixel.x, stepPixel.y);
    }

    this.pathPreviewGraphics.strokePath();

    // Draw small circles at each waypoint
    this.pathPreviewGraphics.fillStyle(0x00ff00, 0.8);
    for (const step of path) {
      const stepPixel = this.gridManager.gridToPixel(step.x, step.y);
      this.pathPreviewGraphics.fillCircle(stepPixel.x, stepPixel.y, 4);
    }
  }

  private clearPathPreview(): void {
    this.pathPreviewGraphics.clear();
  }

  // ============================================
  // Highlighting
  // ============================================

  private drawMovementHighlight(team: 'hero' | 'enemy' = 'hero'): void {
    this.clearHighlights();

    // Use blue for heroes, red for enemies
    const fillColor = team === 'hero' ? 0x4444ff : 0xff4444;
    const strokeColor = team === 'hero' ? 0x6666ff : 0xff6666;

    // Draw semi-transparent tiles for movement range
    this.highlightGraphics.fillStyle(fillColor, 0.4);

    for (const tile of this.movementTiles) {
      const pixelX = tile.x * GAME_CONFIG.TILE_SIZE;
      const pixelY = tile.y * GAME_CONFIG.TILE_SIZE;
      this.highlightGraphics.fillRect(
        pixelX,
        pixelY,
        GAME_CONFIG.TILE_SIZE,
        GAME_CONFIG.TILE_SIZE
      );
    }

    // Draw border around movement tiles
    this.highlightGraphics.lineStyle(2, strokeColor, 0.8);
    for (const tile of this.movementTiles) {
      const pixelX = tile.x * GAME_CONFIG.TILE_SIZE;
      const pixelY = tile.y * GAME_CONFIG.TILE_SIZE;
      this.highlightGraphics.strokeRect(
        pixelX,
        pixelY,
        GAME_CONFIG.TILE_SIZE,
        GAME_CONFIG.TILE_SIZE
      );
    }
  }

  private clearHighlights(): void {
    this.highlightGraphics.clear();
  }

  // ============================================
  // UI
  // ============================================

  private showBattleInfo(): void {
    // Create a UI container that stays fixed on screen
    this.uiContainer = this.add.container(0, 0);
    this.uiContainer.setScrollFactor(0);

    // Get screen dimensions accounting for zoom
    const screenWidth = this.cameras.main.width;

    // Battle title at top
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x000000, 0.8);
    titleBg.fillRoundedRect(screenWidth / 2 - 150, 10, 300, 40, 5);
    this.uiContainer.add(titleBg);

    const titleText = this.add.text(
      screenWidth / 2,
      30,
      this.battleConfig.displayName,
      {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ff4444',
        fontStyle: 'bold',
      }
    ).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
    this.uiContainer.add(titleText);

    // Unit count info
    const infoBg = this.add.graphics();
    infoBg.fillStyle(0x000000, 0.7);
    infoBg.fillRoundedRect(10, 60, 200, 85, 5);
    this.uiContainer.add(infoBg);

    const heroCountText = this.add.text(
      20,
      70,
      `Heroes: ${this.heroUnits.length}`,
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#44ff44',
      }
    );
    heroCountText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.uiContainer.add(heroCountText);

    const enemyCountText = this.add.text(
      20,
      90,
      `Enemies: ${this.enemyUnits.length}`,
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff4444',
      }
    );
    enemyCountText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.uiContainer.add(enemyCountText);

    // Round display
    this.roundText = this.add.text(
      20,
      115,
      'Round 0',
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffff44',
      }
    );
    this.roundText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.uiContainer.add(this.roundText);

    // Make main camera ignore UI (it will be rendered by uiCamera instead)
    this.cameras.main.ignore(this.uiContainer);
  }

  // ============================================
  // Turn System
  // ============================================

  /**
   * Start a new round - roll initiative for all units and begin
   */
  private startNewRound(): void {
    this.round++;
    this.phase = 'rolling_initiative';

    // Reset all units' turn state
    this.units.forEach((unit) => {
      if (!unit.isUnconscious) {
        resetUnitTurnState(unit);
      }
    });

    // Roll initiative for all living units
    this.rollAllInitiative();

    // Show initiative results with a brief delay
    this.showInitiativeRolls();

    // Start first turn after showing results
    this.time.delayedCall(1500, () => {
      this.currentTurnIndex = 0;
      this.startNextTurn();
    });
  }

  /**
   * Roll initiative for all living units and sort turn order
   */
  private rollAllInitiative(): void {
    this.turnOrder = [];

    // Roll for each living unit
    const livingUnits = this.units.filter((u) => !u.isUnconscious);

    for (const unit of livingUnits) {
      const initiativeRoll = rollInitiative(unit.speed);
      let total = initiativeRoll.finalTotal || initiativeRoll.total;

      // Swift Anklet: +2 initiative bonus
      if (unit.equipment === 'swift_anklet') {
        total += 2;
        this.addCombatLogMessage(`${unit.name}'s Swift Anklet grants +2 initiative!`);
      }

      this.turnOrder.push({
        unit,
        roll: initiativeRoll,
        total,
      });
    }

    // Sort by initiative (highest first)
    // Ties broken by speed, then by team (heroes win ties)
    this.turnOrder.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.unit.speed !== a.unit.speed) return b.unit.speed - a.unit.speed;
      // Heroes win ties
      if (a.unit.team === 'hero' && b.unit.team === 'enemy') return -1;
      if (a.unit.team === 'enemy' && b.unit.team === 'hero') return 1;
      return 0;
    });

    console.log('Initiative Order:', this.turnOrder.map(
      (e) => {
        const equipBonus = e.unit.equipment === 'swift_anklet' ? ' (+2 Swift Anklet)' : '';
        return `${e.unit.name}: ${e.roll.rolls[0]} + ${e.unit.speed}${equipBonus} = ${e.total}`;
      }
    ));
  }

  /**
   * Show initiative rolls briefly
   */
  private showInitiativeRolls(): void {
    // Update round display
    if (this.roundText) {
      this.roundText.setText(`Round ${this.round}`);
    }

    // Update turn order UI
    this.updateTurnOrderUI();

    // Show a floating message
    this.showFloatingMessage(`Round ${this.round} - Rolling Initiative!`);
  }

  /**
   * Start the next unit's turn
   */
  private startNextTurn(): void {
    // Find next living unit
    while (
      this.currentTurnIndex < this.turnOrder.length &&
      this.turnOrder[this.currentTurnIndex].unit.isUnconscious
    ) {
      this.currentTurnIndex++;
    }

    // If we've gone through all units, start new round
    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.endRound();
      return;
    }

    const entry = this.turnOrder[this.currentTurnIndex];
    this.activeUnit = entry.unit;

    // Highlight active unit in turn order
    this.updateTurnOrderUI();

    // Update active unit panel (shows hero stats in bottom-left)
    this.updateActiveUnitPanel();

    // Different handling for hero vs enemy
    if (this.activeUnit.team === 'hero') {
      this.startHeroTurn(this.activeUnit);
    } else {
      this.startEnemyTurn(this.activeUnit);
    }
  }

  /**
   * Process status effects at the start of a unit's turn
   * Returns true if the unit can act, false if their turn should be skipped
   */
  private processStartOfTurnEffects(unit: Unit): { canAct: boolean; skipReason?: string } {
    // Check for held - skip turn entirely
    const heldEffect = unit.statusEffects.find(e => e.type === 'held');
    if (heldEffect) {
      this.addCombatLogMessage(`${unit.name} is held and skips their turn!`);

      // Decrement hold duration
      heldEffect.duration--;
      if (heldEffect.duration <= 0) {
        unit.statusEffects = unit.statusEffects.filter(e => e.type !== 'held');
        this.addCombatLogMessage(`${unit.name} is no longer held.`);
      }

      // Update condition markers to show new duration
      updateConditionMarkers(unit, this);
      this.updateTurnOrderUI();
      return { canAct: false, skipReason: 'held' };
    }

    // Process poison damage at turn start
    const poisonEffect = unit.statusEffects.find(e => e.type === 'poison');
    if (poisonEffect && poisonEffect.value) {
      const poisonDamage = poisonEffect.value;
      this.addCombatLogMessage(`${unit.name} takes ${poisonDamage} poison damage!`);

      // Import and use applyDamage
      unit.currentHp = Math.max(0, unit.currentHp - poisonDamage);
      this.showDamageNumber(unit, poisonDamage, false);

      // Check if unit was defeated by poison
      if (unit.currentHp === 0) {
        unit.isUnconscious = true;
        unit.statusEffects.push({ type: 'unconscious', duration: -1 });
        this.addCombatLogMessage(`${unit.name} has succumbed to poison!`);
        this.handleUnitDefeated(unit);
        this.updateTurnOrderUI();
        return { canAct: false, skipReason: 'defeated' };
      }

      // Decrement poison duration
      poisonEffect.duration--;
      if (poisonEffect.duration <= 0) {
        unit.statusEffects = unit.statusEffects.filter(e => e.type !== 'poison');
        this.addCombatLogMessage(`${unit.name} has recovered from poison.`);
      }

      // Update condition markers to show new poison duration
      updateConditionMarkers(unit, this);
    }

    // Process zone damage (Entangle) at turn start
    if (!unit.isUnconscious) {
      this.processZoneTurnStart(unit);

      // Check if unit was defeated by zone damage
      if (unit.currentHp <= 0) {
        return { canAct: false, skipReason: 'defeated' };
      }
    }

    // Process other status effect durations (barkskin, exposed, hidden, immobilized, rage, dodge, inspired)
    // These tick down at start of unit's turn
    const tickingEffects = ['barkskin', 'exposed', 'hidden', 'immobilized', 'rage', 'dodge', 'inspired'];
    let effectChanged = false;
    for (const effectType of tickingEffects) {
      const effect = unit.statusEffects.find(e => e.type === effectType);
      if (effect && effect.duration > 0) {
        effect.duration--;
        effectChanged = true;
        if (effect.duration <= 0) {
          unit.statusEffects = unit.statusEffects.filter(e => e.type !== effectType);
          this.addCombatLogMessage(`${unit.name}'s ${effectType} effect has worn off.`);
        }
      }
    }

    // Update condition markers if any effects changed (duration decrement or expiration)
    if (effectChanged) {
      updateConditionMarkers(unit, this);
    }

    this.updateTurnOrderUI();
    return { canAct: true };
  }

  /**
   * Start a hero unit's turn
   */
  private startHeroTurn(unit: Unit): void {
    this.phase = 'select_action';

    // Reset XP flag - only first action per turn earns XP
    this.hasEarnedXPThisTurn = false;

    // Center camera on the active hero
    const pixelPos = this.gridManager.gridToPixel(unit.gridX, unit.gridY);
    this.cameras.main.pan(pixelPos.x, pixelPos.y, 300);

    // Show turn notification
    this.showFloatingMessage(`${unit.name}'s Turn`);

    // Process start-of-turn effects (poison, held, etc.)
    this.time.delayedCall(300, () => {
      const result = this.processStartOfTurnEffects(unit);

      if (!result.canAct) {
        // Skip turn if held or defeated
        this.showFloatingMessage(`${unit.name} is ${result.skipReason}!`, 0xff69b4);
        this.time.delayedCall(1000, () => {
          this.endCurrentTurn();
        });
        return;
      }

      // Check for battle end after poison damage
      this.checkBattleEnd();
      if (this.phase === 'victory' || this.phase === 'defeat') {
        return;
      }

      // Show action menu
      this.showActionMenu();
    });
  }

  /**
   * Start an enemy unit's turn (AI controlled)
   */
  private startEnemyTurn(unit: Unit): void {
    this.phase = 'enemy_turn';

    // Show which enemy is acting
    this.showFloatingMessage(`${unit.name}'s Turn`, 0xff4444);

    // Highlight the enemy
    if (unit.sprite) {
      unit.sprite.setTint(0xff4444);
    }

    // Show corner bracket indicator
    this.showEnemyTurnIndicator(unit);

    // Center camera on enemy
    const pixelPos = this.gridManager.gridToPixel(unit.gridX, unit.gridY);
    this.cameras.main.pan(pixelPos.x, pixelPos.y, 300);

    // Process start-of-turn effects (poison, held, etc.)
    this.time.delayedCall(500, () => {
      const result = this.processStartOfTurnEffects(unit);

      if (!result.canAct) {
        // Skip turn if held or defeated
        this.showFloatingMessage(`${unit.name} is ${result.skipReason}!`, 0xff69b4);
        if (unit.sprite) {
          unit.sprite.clearTint();
        }
        this.hideEnemyTurnIndicator();
        this.time.delayedCall(1000, () => {
          this.checkBattleEnd();
          if (this.phase !== 'victory' && this.phase !== 'defeat') {
            this.endCurrentTurn();
          }
        });
        return;
      }

      // Check for battle end after poison damage
      this.checkBattleEnd();
      if (this.phase === 'victory' || this.phase === 'defeat') {
        return;
      }

      // Execute AI turn
      this.executeEnemyAI(unit);
    });
  }

  /**
   * Execute AI decision making and actions for an enemy
   */
  private executeEnemyAI(unit: Unit): void {
    let hasMoved = false;
    let hasActed = false;

    // AI decision loop - move then attack, or attack then move
    const executeNextAction = () => {
      const decision = this.aiController.decideAction(
        unit,
        this.units,
        hasMoved,
        hasActed,
        this.round
      );

      switch (decision.action) {
        case 'move':
          if (decision.targetPosition) {
            hasMoved = true;
            this.executeEnemyMove(unit, decision.targetPosition, () => {
              // After moving, try to act
              this.time.delayedCall(300, executeNextAction);
            });
          } else {
            executeNextAction();
          }
          break;

        case 'attack':
        case 'ability':
          if (decision.targetUnit && decision.ability) {
            hasActed = true;
            this.executeEnemyAttack(unit, decision.targetUnit, decision.ability, () => {
              // After attacking, check if we can still move
              if (!hasMoved) {
                this.time.delayedCall(500, executeNextAction);
              } else {
                this.finishEnemyTurn(unit);
              }
            });
          } else {
            this.finishEnemyTurn(unit);
          }
          break;

        case 'wait':
        default:
          this.finishEnemyTurn(unit);
          break;
      }
    };

    // Start the AI decision loop
    this.time.delayedCall(300, executeNextAction);
  }

  /**
   * Execute enemy movement
   */
  private executeEnemyMove(
    unit: Unit,
    target: { x: number; y: number },
    onComplete: () => void
  ): void {
    // Find path to target
    const path = this.gridManager.findPath(
      unit.gridX,
      unit.gridY,
      target.x,
      target.y,
      unit
    );

    if (!path || path.length === 0) {
      onComplete();
      return;
    }

    // Limit path to movement range
    let limitedPath = path.slice(0, MOVEMENT_RANGE);

    // Ensure final destination is not occupied (can path through allies but not stop on them)
    while (limitedPath.length > 0) {
      const finalPos = limitedPath[limitedPath.length - 1];
      const occupant = this.gridManager.getUnitAt(finalPos.x, finalPos.y);
      if (!occupant || occupant === unit) {
        break; // Valid destination
      }
      // Trim the path to stop one step earlier
      limitedPath = limitedPath.slice(0, -1);
    }

    if (limitedPath.length === 0) {
      // No valid movement possible
      onComplete();
      return;
    }

    this.addCombatLogMessage(`${unit.name} moves`);

    // Animate movement along path
    let pathIndex = 0;
    const moveAlongPath = () => {
      if (pathIndex >= limitedPath.length) {
        // Check for zone entry damage at final position
        const finalPos = limitedPath[limitedPath.length - 1];
        if (finalPos) {
          const zonesEntered = this.getZonesAtPosition(finalPos.x, finalPos.y);
          for (const zone of zonesEntered) {
            this.applyZoneDamage(unit, zone, 'entry');
          }
        }
        onComplete();
        return;
      }

      const nextPos = limitedPath[pathIndex];

      // Update facing based on movement direction
      const dx = nextPos.x - unit.gridX;
      const dy = nextPos.y - unit.gridY;
      if (dx > 0) unit.facing = 'east';
      else if (dx < 0) unit.facing = 'west';
      else if (dy > 0) unit.facing = 'south';
      else if (dy < 0) unit.facing = 'north';

      // Update grid manager's unit tracking first (before animation)
      this.gridManager.moveUnit(unit, nextPos.x, nextPos.y);

      // Calculate target pixel position for indicator
      const targetPixelX = nextPos.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const targetPixelY = nextPos.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

      // Animate enemy turn indicator alongside sprite
      if (this.enemyTurnIndicator) {
        this.tweens.add({
          targets: this.enemyTurnIndicator,
          x: targetPixelX,
          y: targetPixelY,
          duration: 100,
          ease: 'Linear',
        });
      }

      // Animate sprite movement
      moveUnitToGrid(unit, nextPos.x, nextPos.y, this, true, 100).then(() => {
        pathIndex++;
        moveAlongPath();
      });
    };

    moveAlongPath();
  }

  /**
   * Execute enemy attack
   */
  private executeEnemyAttack(
    unit: Unit,
    target: Unit,
    ability: Ability,
    onComplete: () => void
  ): void {
    // Update facing toward target
    const dx = target.gridX - unit.gridX;
    const dy = target.gridY - unit.gridY;
    if (Math.abs(dx) > Math.abs(dy)) {
      unit.facing = dx > 0 ? 'east' : 'west';
    } else {
      unit.facing = dy > 0 ? 'south' : 'north';
    }

    // Check if this is an AOE ability - handle differently
    if (ability.targetType === 'area' && ability.areaSize) {
      this.executeEnemyAOEAttack(unit, target, ability, onComplete);
      return;
    }

    // Build result lines for action panel
    const resultLines: string[] = [];

    // Resolve the attack
    if (ability.type === 'attack') {
      // Ambusher's Ring: +2 ATK on first attack of battle
      let ambusherBonus = 0;
      if (unit.equipment === 'ambushers_ring' &&
          unit.equipmentBonusState &&
          !unit.equipmentBonusState.firstAttackUsed) {
        ambusherBonus = 2;
        unit.attack += 2;
        unit.equipmentBonusState.firstAttackUsed = true;
        this.addCombatLogMessage(`${unit.name}'s Ambusher's Ring grants +2 ATK!`);
      }

      const result = resolveAttack(unit, target, ability);

      // Restore attack stat if bonus was applied
      if (ambusherBonus > 0) {
        unit.attack -= ambusherBonus;
      }

      // Build descriptive result lines
      const rollTotal = result.attackRoll.finalTotal || result.attackRoll.total;
      const bonusText = ambusherBonus > 0 ? ` (+${ambusherBonus})` : '';
      resultLines.push(`${unit.name} uses ${ability.name}!`);
      resultLines.push(`Rolls ${result.attackRoll.rolls[0]} + ${unit.attack + ambusherBonus}${bonusText} = ${rollTotal} vs DEF ${result.targetNumber}`);

      if (result.hit && result.totalDamage !== undefined) {
        resultLines.push(`HIT! ${result.totalDamage} damage to ${target.name}!`);
        this.showDamageNumber(target, result.totalDamage, false);
        this.trackDamage(result.totalDamage, false);

        // Flash the target
        if (target.sprite) {
          target.sprite.setTint(0xff0000);
          this.time.delayedCall(200, () => {
            target.sprite?.clearTint();
          });
        }

        if (result.defenderDefeated) {
          resultLines.push(`${target.name} is DEFEATED!`);

          // Bloodstone: heal 2 HP on first kill
          if (unit.equipment === 'bloodstone' &&
              unit.equipmentBonusState &&
              !unit.equipmentBonusState.firstKillUsed) {
            unit.equipmentBonusState.firstKillUsed = true;
            applyHealing(unit, 2);
            this.showDamageNumber(unit, 2, true);
            this.addCombatLogMessage(`${unit.name}'s Bloodstone heals 2 HP!`);
            resultLines.push(`${unit.name}'s Bloodstone heals 2 HP!`);
          }

          this.handleUnitDefeated(target);
        }
      } else {
        resultLines.push(`MISS!`);
      }

      // Combat log
      this.addCombatLogMessage(`${unit.name} → ${ability.name} → ${target.name}`);
      this.addCombatLogMessage(`  ATK: ${rollTotal} vs DEF ${result.targetNumber} - ${result.hit ? 'HIT' : 'MISS'}`);

    } else {
      // Spell attack
      // Wardstone: +2 RES on first save of battle (for defender)
      let wardstoneBonus = 0;
      if (target.equipment === 'wardstone' &&
          target.equipmentBonusState &&
          !target.equipmentBonusState.firstSaveUsed) {
        wardstoneBonus = 2;
        target.resilience += 2;
        target.equipmentBonusState.firstSaveUsed = true;
        this.addCombatLogMessage(`${target.name}'s Wardstone grants +2 RES!`);
      }

      const result = resolveSpell(unit, target, ability);

      // Restore resilience if bonus was applied
      if (wardstoneBonus > 0) {
        target.resilience -= wardstoneBonus;
      }

      resultLines.push(`${unit.name} casts ${ability.name}!`);

      if (result.saveRoll.dice !== 'none') {
        const saveTotal = result.saveRoll.finalTotal || result.saveRoll.total;
        const bonusText = wardstoneBonus > 0 ? ` (+${wardstoneBonus})` : '';
        resultLines.push(`${target.name} rolls ${result.saveRoll.rolls[0]} + ${target.resilience + wardstoneBonus}${bonusText} = ${saveTotal} vs MAG ${result.targetNumber}`);
        resultLines.push(result.savePassed ? 'Save PASSED!' : 'Save FAILED!');
      }

      if (result.totalDamage !== undefined && result.totalDamage > 0) {
        resultLines.push(`${result.totalDamage} damage to ${target.name}!`);
        this.showDamageNumber(target, result.totalDamage, false);
        this.trackDamage(result.totalDamage, false);

        if (target.sprite) {
          target.sprite.setTint(0xff0000);
          this.time.delayedCall(200, () => {
            target.sprite?.clearTint();
          });
        }
      }

      if (result.effectApplied) {
        resultLines.push(`${target.name} is ${result.effectApplied.type}!`);
        // Update condition markers to show new effect
        updateConditionMarkers(target, this);
      }

      if (result.targetDefeated) {
        resultLines.push(`${target.name} is DEFEATED!`);

        // Bloodstone: heal 2 HP on first kill
        if (unit.equipment === 'bloodstone' &&
            unit.equipmentBonusState &&
            !unit.equipmentBonusState.firstKillUsed) {
          unit.equipmentBonusState.firstKillUsed = true;
          applyHealing(unit, 2);
          this.showDamageNumber(unit, 2, true);
          this.addCombatLogMessage(`${unit.name}'s Bloodstone heals 2 HP!`);
          resultLines.push(`${unit.name}'s Bloodstone heals 2 HP!`);
        }

        this.handleUnitDefeated(target);
      }

      // Combat log
      this.addCombatLogMessage(`${unit.name} → ${ability.name} → ${target.name}`);
    }

    // Show action result panel, then continue
    this.showActionResultPanel(resultLines, () => {
      this.checkBattleEnd();
      if (this.phase !== 'victory' && this.phase !== 'defeat') {
        onComplete();
      }
    });
  }

  /**
   * Execute enemy AOE attack - hits all heroes in the area
   */
  private executeEnemyAOEAttack(
    unit: Unit,
    primaryTarget: Unit,
    ability: Ability,
    onComplete: () => void
  ): void {
    if (!ability.areaSize) return;

    // Calculate AOE area centered on the primary target
    // The AOE origin is positioned so the target is roughly in the center
    const aoeWidth = ability.areaSize.width;
    const aoeHeight = ability.areaSize.height;
    const originX = Math.max(0, primaryTarget.gridX - Math.floor(aoeWidth / 2));
    const originY = Math.max(0, primaryTarget.gridY - Math.floor(aoeHeight / 2));

    // Find all heroes in the AOE area
    const heroesInArea = this.units.filter(u => {
      if (u.team !== 'hero' || u.isUnconscious) return false;
      return u.gridX >= originX &&
             u.gridX < originX + aoeWidth &&
             u.gridY >= originY &&
             u.gridY < originY + aoeHeight;
    });

    // Show visual indicator of AOE area
    this.showEnemyAOEIndicator(originX, originY, aoeWidth, aoeHeight, heroesInArea);

    // Pay the mana cost
    if (ability.cost && ability.costType === 'mana' && unit.currentMana !== undefined) {
      unit.currentMana = Math.max(0, unit.currentMana - ability.cost);
    }

    // Build result lines
    const resultLines: string[] = [];
    resultLines.push(`${unit.name} casts ${ability.name}!`);
    resultLines.push(`(${aoeWidth}x${aoeHeight} area)`);

    this.addCombatLogMessage(`${unit.name} → ${ability.name} (AOE)`);

    // Delay to show the AOE indicator before resolving
    this.time.delayedCall(600, () => {
      // Clear AOE indicator
      this.clearEnemyAOEIndicator();

      if (heroesInArea.length === 0) {
        resultLines.push('No targets hit!');
        this.addCombatLogMessage('  No targets hit!');
      } else {
        let totalDefeated = 0;

        // Resolve spell against each hero in the area
        heroesInArea.forEach(target => {
          // Wardstone: +2 RES on first save of battle
          let wardstoneBonus = 0;
          if (target.equipment === 'wardstone' &&
              target.equipmentBonusState &&
              !target.equipmentBonusState.firstSaveUsed) {
            wardstoneBonus = 2;
            target.resilience += 2;
            target.equipmentBonusState.firstSaveUsed = true;
            this.addCombatLogMessage(`${target.name}'s Wardstone grants +2 RES!`);
          }

          const result = resolveSpell(unit, target, ability);

          // Restore resilience if bonus was applied
          if (wardstoneBonus > 0) {
            target.resilience -= wardstoneBonus;
          }

          // Log save roll
          if (result.saveRoll.dice !== 'none') {
            const saveTotal = result.saveRoll.finalTotal || result.saveRoll.total;
            const bonusText = wardstoneBonus > 0 ? `(+${wardstoneBonus})` : '';
            const saveResult = result.savePassed ? 'SAVED!' : 'FAILED!';
            this.addCombatLogMessage(`  ${target.name}: SAVE ${result.saveRoll.rolls[0]}+${target.resilience + wardstoneBonus}${bonusText}=${saveTotal} - ${saveResult}`);
            resultLines.push(`${target.name}: ${saveResult}`);
          }

          // Apply damage
          if (result.totalDamage !== undefined && result.totalDamage > 0) {
            this.addCombatLogMessage(`    DMG: ${result.totalDamage}`);
            resultLines.push(`  ${result.totalDamage} damage!`);
            this.showDamageNumber(target, result.totalDamage, false);
            this.trackDamage(result.totalDamage, false);

            // Flash the target
            if (target.sprite) {
              target.sprite.setTint(0xff0000);
              this.time.delayedCall(200, () => {
                target.sprite?.clearTint();
              });
            }
          }

          if (result.targetDefeated) {
            totalDefeated++;
            resultLines.push(`${target.name} is DEFEATED!`);
            this.handleUnitDefeated(target);
          }
        });

        if (totalDefeated > 0) {
          this.addCombatLogMessage(`  ${totalDefeated} defeated!`);
        }
      }

      // Show action result panel, then continue
      this.showActionResultPanel(resultLines, () => {
        this.checkBattleEnd();
        if (this.phase !== 'victory' && this.phase !== 'defeat') {
          onComplete();
        }
      });
    });
  }

  /**
   * Show visual indicator for enemy AOE attack
   */
  private showEnemyAOEIndicator(
    originX: number,
    originY: number,
    width: number,
    height: number,
    targets: Unit[]
  ): void {
    // Draw the AOE area highlight
    this.cursorGraphics.clear();
    this.cursorGraphics.fillStyle(0xff4400, 0.4);

    for (let dx = 0; dx < width; dx++) {
      for (let dy = 0; dy < height; dy++) {
        const tx = originX + dx;
        const ty = originY + dy;
        const pixelX = tx * GAME_CONFIG.TILE_SIZE;
        const pixelY = ty * GAME_CONFIG.TILE_SIZE;
        this.cursorGraphics.fillRect(pixelX, pixelY, GAME_CONFIG.TILE_SIZE, GAME_CONFIG.TILE_SIZE);
      }
    }

    // Draw border
    this.cursorGraphics.lineStyle(3, 0xff0000, 1);
    const startX = originX * GAME_CONFIG.TILE_SIZE;
    const startY = originY * GAME_CONFIG.TILE_SIZE;
    const aoeWidth = width * GAME_CONFIG.TILE_SIZE;
    const aoeHeight = height * GAME_CONFIG.TILE_SIZE;
    this.cursorGraphics.strokeRect(startX, startY, aoeWidth, aoeHeight);

    // Highlight targets in the area with red tint
    targets.forEach(target => {
      if (target.sprite) {
        target.sprite.setTint(0xff0000);
      }
    });
  }

  /**
   * Clear enemy AOE indicator
   */
  private clearEnemyAOEIndicator(): void {
    this.cursorGraphics.clear();
    // Clear any target tints
    this.units.forEach(u => {
      if (u.sprite && !u.isUnconscious) {
        u.sprite.clearTint();
      }
    });
  }

  /**
   * Finish an enemy's turn
   */
  private finishEnemyTurn(unit: Unit): void {
    // Clear enemy highlight
    if (unit.sprite) {
      unit.sprite.clearTint();
    }

    // No pause needed after movement-only turns - advance quickly
    this.time.delayedCall(300, () => {
      this.endCurrentTurn();
    });
  }

  /**
   * End the current unit's turn and advance to next
   */
  private endCurrentTurn(): void {
    // Clear selection
    if (this.activeUnit?.sprite) {
      this.activeUnit.sprite.clearTint();
    }
    this.hideEnemyTurnIndicator();
    this.deselectUnit();

    // Advance to next unit
    this.currentTurnIndex++;
    this.startNextTurn();
  }

  /**
   * Handle end of round - process status effects, check victory/defeat
   */
  private endRound(): void {
    this.phase = 'round_end';

    // Track completed rounds
    this.battleStats.roundsCompleted = this.round;

    // Process zone durations (decrement and remove expired)
    this.processZoneRoundEnd();

    // Check victory/defeat conditions
    const allEnemiesDefeated = this.enemyUnits.every((u) => u.isUnconscious);
    const allHeroesDefeated = this.heroUnits.every((u) => u.isUnconscious);

    if (allEnemiesDefeated) {
      this.handleVictory();
      return;
    }

    if (allHeroesDefeated) {
      this.handleDefeat();
      return;
    }

    // Start new round
    this.time.delayedCall(500, () => {
      this.startNewRound();
    });
  }

  /**
   * Handle victory condition
   */
  private handleVictory(): void {
    this.phase = 'victory';
    this.hideActiveUnitPanel();
    this.showFloatingMessage('Victory!', 0x44ff44);

    // Update final round count
    this.battleStats.roundsCompleted = this.round;

    // Mark this battle as complete in game flags
    this.gameFlags[`${this.battleMap}_battle_complete`] = true;

    // Show victory screen after a brief delay
    this.time.delayedCall(1000, () => {
      this.showResultScreen(true);
    });
  }

  /**
   * Handle defeat condition
   */
  private handleDefeat(): void {
    this.phase = 'defeat';
    this.hideActiveUnitPanel();
    this.showFloatingMessage('Defeat...', 0xff4444);

    // Update final round count
    this.battleStats.roundsCompleted = this.round;

    // Show defeat screen after a brief delay
    this.time.delayedCall(1000, () => {
      this.showResultScreen(false);
    });
  }

  /**
   * Show the victory or defeat result screen
   */
  private showResultScreen(isVictory: boolean): void {
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    // Create container for result screen
    this.resultScreenContainer = this.add.container(0, 0);
    this.resultScreenContainer.setScrollFactor(0);
    this.resultScreenContainer.setDepth(1000);
    this.cameras.main.ignore(this.resultScreenContainer);

    // Semi-transparent background overlay
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.8);
    overlay.fillRect(0, 0, screenWidth, screenHeight);
    this.resultScreenContainer.add(overlay);

    // Result box
    const boxWidth = 400;
    const boxHeight = isVictory ? 320 : 280;
    const boxX = (screenWidth - boxWidth) / 2;
    const boxY = (screenHeight - boxHeight) / 2;

    const box = this.add.graphics();
    box.fillStyle(isVictory ? 0x1a3a1a : 0x3a1a1a, 1);
    box.fillRoundedRect(boxX, boxY, boxWidth, boxHeight, 10);
    box.lineStyle(3, isVictory ? 0x44ff44 : 0xff4444, 1);
    box.strokeRoundedRect(boxX, boxY, boxWidth, boxHeight, 10);
    this.resultScreenContainer.add(box);

    // Title
    const title = this.add.text(screenWidth / 2, boxY + 30, isVictory ? 'VICTORY!' : 'DEFEAT', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: isVictory ? '#44ff44' : '#ff4444',
      fontStyle: 'bold',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    title.setOrigin(0.5);
    this.resultScreenContainer.add(title);

    // Battle summary
    let yPos = boxY + 80;
    const lineHeight = 28;

    const summaryLines = [
      `Enemies Defeated: ${this.battleStats.enemiesDefeated}`,
      `Damage Dealt: ${this.battleStats.totalDamageDealt}`,
      `Damage Taken: ${this.battleStats.totalDamageTaken}`,
      `Rounds: ${this.battleStats.roundsCompleted}`,
    ];

    for (const line of summaryLines) {
      const text = this.add.text(screenWidth / 2, yPos, line, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      text.setOrigin(0.5);
      this.resultScreenContainer.add(text);
      yPos += lineHeight;
    }

    // Hero status
    yPos += 10;
    const statusTitle = this.add.text(screenWidth / 2, yPos, 'Party Status:', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaaaa',
    });
    statusTitle.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    statusTitle.setOrigin(0.5);
    this.resultScreenContainer.add(statusTitle);
    yPos += 24;

    for (const hero of this.heroUnits) {
      const hpColor = hero.isUnconscious ? '#ff4444' : (hero.currentHp < hero.maxHp / 2 ? '#ffaa00' : '#44ff44');
      const statusText = hero.isUnconscious ? 'KO' : `${hero.currentHp}/${hero.maxHp}`;
      const heroStatus = this.add.text(screenWidth / 2, yPos, `${hero.name}: ${statusText}`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: hpColor,
      });
      heroStatus.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      heroStatus.setOrigin(0.5);
      this.resultScreenContainer.add(heroStatus);
      yPos += 20;
    }

    // Instructions
    yPos = boxY + boxHeight - 40;
    if (isVictory) {
      const continueText = this.add.text(screenWidth / 2, yPos, 'Press ENTER to continue', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888888',
      });
      continueText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      continueText.setOrigin(0.5);
      this.resultScreenContainer.add(continueText);
    } else {
      const retryText = this.add.text(screenWidth / 2, yPos, 'Press ENTER to retry  |  Press ESC to return to town', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      });
      retryText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      retryText.setOrigin(0.5);
      this.resultScreenContainer.add(retryText);
    }
  }

  /**
   * Handle input on the result screen
   */
  private handleResultScreenInput(isRetry: boolean = false): void {
    if (!this.resultScreenContainer) return;

    if (this.phase === 'victory') {
      // Check for victory cutscene
      if (this.battleConfig.victoryCutscene && this.battleConfig.victoryCutscene.length > 0) {
        // Hide result screen and show cutscene
        this.resultScreenContainer.destroy();
        this.resultScreenContainer = null;
        this.showVictoryCutscene();
      } else {
        // Return to town directly
        this.returnToTown();
      }
    } else if (this.phase === 'defeat') {
      if (isRetry) {
        // Restart the battle
        this.scene.restart({ battleMap: this.battleMap, heroId: this.heroId });
      } else {
        // Return to town
        this.returnToTown();
      }
    }
  }

  /**
   * Setup victory scene positioning - move heroes around rescued NPCs, set props upright
   */
  private setupVictoryScenePositions(): void {
    // For abandoned_distillery: set Dante upright and position heroes around him
    if (this.battleMap === 'abandoned_distillery' && this.propSprites.length > 0) {
      // Dante is the first prop - set him upright (front-facing, no rotation)
      const danteSprite = this.propSprites[0];
      danteSprite.setTexture('sprite_dante_front');
      danteSprite.setAngle(0);

      // Dante is at (8, 8) - position surviving heroes around him
      const heroPositions = [
        { x: 7, y: 8 },  // Left of Dante
        { x: 9, y: 8 },  // Right of Dante
        { x: 8, y: 9 },  // Below Dante
        { x: 7, y: 9 },  // Below-left
        { x: 9, y: 9 },  // Below-right
      ];

      let posIndex = 0;
      this.heroUnits.forEach((hero) => {
        if (!hero.isUnconscious && hero.sprite && posIndex < heroPositions.length) {
          const pos = heroPositions[posIndex];
          const pixelX = pos.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
          const pixelY = pos.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

          // Update grid position
          hero.gridX = pos.x;
          hero.gridY = pos.y;

          // Move sprite to new position
          hero.sprite.setPosition(pixelX, pixelY);

          // Face north (toward Dante) - use back sprite for north-facing
          hero.facing = 'north';
          hero.sprite.setTexture(`sprite_${hero.dataId}_back`);

          posIndex++;
        }
      });
    }
  }

  /**
   * Show the post-battle victory cutscene
   * Supports both simple string[] and CutsceneLine[] formats
   */
  private victoryCutsceneIndex: number = 0;

  private showVictoryCutscene(): void {
    const cutscene = this.battleConfig.victoryCutscene!;

    // Setup victory scene positioning if specified in battle config
    this.setupVictoryScenePositions();

    // Check if using new format (array of objects with speaker/text)
    if (cutscene.length > 0 && typeof cutscene[0] === 'object') {
      this.victoryCutsceneIndex = 0;
      this.showNextVictoryCutsceneLine();
    } else {
      // Old format - simple string array with Narrator
      this.dialogueRenderer.startDialogue(
        cutscene as string[],
        'Narrator',
        () => {
          this.onVictoryCutsceneComplete();
        }
      );
    }
  }

  private showNextVictoryCutsceneLine(): void {
    const cutscene = this.battleConfig.victoryCutscene as { speaker: string; text: string; portrait?: string }[];

    if (this.victoryCutsceneIndex >= cutscene.length) {
      // Cutscene complete
      this.onVictoryCutsceneComplete();
      return;
    }

    const line = cutscene[this.victoryCutsceneIndex];
    const portraitKey = line.portrait || `portrait_${line.speaker.toLowerCase()}`;

    this.dialogueRenderer.startDialogue(
      [line.text],
      line.speaker,
      () => {
        this.victoryCutsceneIndex++;
        this.showNextVictoryCutsceneLine();
      },
      this.textures.exists(portraitKey) ? portraitKey : undefined
    );
  }

  private onVictoryCutsceneComplete(): void {
    // Check for special post-victory scene
    if (this.battleConfig.postVictoryScene === 'meris_encounter') {
      this.time.delayedCall(300, () => {
        this.showMerisEncounter();
      });
    } else if (this.battleMap === 'quetzi_shrine' && this.propSprites.length >= 3) {
      // Special rescue animation for Quetzi Shrine
      this.time.delayedCall(300, () => {
        this.playQuetziRescueAnimation();
      });
    } else if (this.battleConfig.postVictoryMode === 'explore') {
      // Enter exploration mode
      this.time.delayedCall(300, () => {
        this.enterExplorationMode();
      });
    } else if (this.battleConfig.postVictoryMode === 'to_be_continued') {
      // Show "To Be Continued" screen
      this.time.delayedCall(300, () => {
        this.showToBeContinued();
      });
    } else {
      // After cutscene, return to town
      this.time.delayedCall(300, () => {
        this.returnToTown();
      });
    }
  }

  /**
   * Animated sequence where Dalrick and Mickell stand up, walk to Quetzi,
   * and carry her off the left side of the map
   */
  private playQuetziRescueAnimation(): void {
    // Props are: [0] Quetzi at (12, 8), [1] Dalrick at (14, 7), [2] Mickell at (14, 9)
    const quetziSprite = this.propSprites[0];
    const dalrickSprite = this.propSprites[1];
    const mickellSprite = this.propSprites[2];

    // Calculate pixel positions - each stays in their own row
    const quetziPixelX = 12 * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const dalrickPixelY = 7 * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2; // Row 7
    const mickellPixelY = 9 * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2; // Row 9

    // Phase 1: Rotate Dalrick and Mickell upright (90° -> 0°)
    this.tweens.add({
      targets: [dalrickSprite, mickellSprite],
      angle: 0,
      duration: 500,
      ease: 'Power2',
      onComplete: () => {
        // Phase 2: Both walk horizontally to align with Quetzi (staying in their own rows)
        this.tweens.add({
          targets: dalrickSprite,
          x: quetziPixelX,
          y: dalrickPixelY, // Stay in row 7
          duration: 800,
          ease: 'Power1',
        });

        this.tweens.add({
          targets: mickellSprite,
          x: quetziPixelX,
          y: mickellPixelY, // Stay in row 9
          duration: 800,
          ease: 'Power1',
          onComplete: () => {
            // Short pause before carrying Quetzi away
            this.time.delayedCall(300, () => {
              // Phase 3: All three move off the left side of the map (each in their own row)
              const exitX = -GAME_CONFIG.TILE_SIZE; // Off the left edge

              this.tweens.add({
                targets: [quetziSprite, dalrickSprite, mickellSprite],
                x: exitX,
                duration: 1500,
                ease: 'Power1',
                onComplete: () => {
                  // Hide the props after they exit
                  quetziSprite.setVisible(false);
                  dalrickSprite.setVisible(false);
                  mickellSprite.setVisible(false);

                  // Now enter exploration mode
                  this.time.delayedCall(300, () => {
                    this.enterExplorationMode();
                  });
                },
              });
            });
          },
        });
      },
    });
  }

  /**
   * Enter post-battle exploration mode
   * Player can move freely and collect loot before exiting
   */
  private enterExplorationMode(): void {
    this.phase = 'post_battle_explore';

    // Check if this battle heals the party on victory (story moment before shrines)
    if (this.battleConfig.healPartyOnVictory) {
      this.heroUnits.forEach((hero) => {
        hero.currentHp = hero.maxHp;
        if (hero.maxMana !== undefined) hero.currentMana = hero.maxMana;
        if (hero.maxKi !== undefined) hero.currentKi = hero.maxKi;
        hero.isUnconscious = false;
        // Restore sprite visibility if it was dimmed
        if (hero.sprite) hero.sprite.setAlpha(1);
      });
    }

    // Switch from combat music to exploration music
    this.sound.stopAll();
    this.sound.play('music_travel', { loop: true, volume: 0.5 });

    // Clear battle UI but keep heroes visible
    this.clearBattleElements();

    // Hide all hero HP bars during exploration
    this.heroUnits.forEach((hero) => {
      if (hero.hpBarContainer) {
        hero.hpBarContainer.setVisible(false);
      }
    });

    // Use the player's chosen hero as party leader (or first surviving if they're down)
    let partyLeader = this.heroUnits.find((h) => h.dataId === this.heroId && !h.isUnconscious);
    if (!partyLeader) {
      // Player's hero is down, use first surviving hero
      partyLeader = this.heroUnits.find((h) => !h.isUnconscious);
    }
    if (!partyLeader) {
      // All heroes down somehow? Return to travel
      this.exitExploration();
      return;
    }

    // Store reference for exploration movement
    this.explorationLeader = partyLeader;

    // If playerStart is specified, move party leader there
    if (this.battleConfig.playerStart && partyLeader.sprite) {
      const startPos = this.battleConfig.playerStart;
      partyLeader.gridX = startPos.x;
      partyLeader.gridY = startPos.y;
      partyLeader.sprite.setPosition(
        startPos.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
        startPos.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2
      );
    }

    // Position other heroes behind the leader (they follow)
    this.heroUnits.forEach((hero) => {
      if (hero !== partyLeader && !hero.isUnconscious && hero.sprite) {
        // Hide other heroes - we just show the party leader moving
        hero.sprite.setVisible(false);
      }
    });

    // Set up camera to follow the party leader smoothly
    if (partyLeader.sprite) {
      this.cameras.main.startFollow(partyLeader.sprite, true, 0.1, 0.1);
      // Set hero depth above chests (depth 5) so hero walks in front
      partyLeader.sprite.setDepth(15);
    }

    // Track start time for exit trigger grace period
    this.explorationStartTime = this.time.now;
    this.explorationMoving = false;

    // Draw exit trigger zone visualization
    this.drawExitTriggers();

    // Spawn shrine for Quetzi Shrine map (at Vessan's old position)
    if (this.battleMap === 'quetzi_shrine') {
      this.spawnExplorationShrine(11, 8);
    }

    // Spawn treasure chests for this battle map
    this.spawnExplorationChests();
  }

  // Reference to party leader during exploration
  private explorationLeader: Unit | null = null;
  private explorationMoving: boolean = false;
  private explorationStartTime: number = 0;

  // Exploration shrine (for Quetzi Shrine map)
  private explorationShrine: { sprite: Phaser.GameObjects.Sprite; gridX: number; gridY: number } | null = null;
  private shrineDialogueActive: boolean = false;
  private shrineSaveMenuVisible: boolean = false;
  private shrineSaveMenuContainer: Phaser.GameObjects.Container | null = null;
  private shrineSaveMenuSelectedIndex: number = 0;
  private shrineSaveMenuTexts: Phaser.GameObjects.Text[] = [];
  private shrineSaveMenuMode: 'confirm' | 'slots' | 'overwrite' = 'confirm';
  private selectedSaveSlot: number = 1;
  private saveSlotPreviews: SaveSlotPreview[] = [];
  private shrineSaveMenuOptions: string[] = [];

  // Treasure chests (Phase 10 - Loot System)
  private explorationChests: { sprite: Phaser.GameObjects.Sprite; id: string; gridX: number; gridY: number; opened: boolean }[] = [];
  private inventoryManager!: InventoryManager;
  private lootManager!: LootManager;
  private inventory: InventoryState = createDefaultInventory();
  private chestStates: Record<string, ChestState> = {};
  private lootPopupActive: boolean = false;
  private lootPopupContainer: Phaser.GameObjects.Container | null = null;

  /**
   * Handle exploration movement input (called from update)
   */
  private handleExplorationInput(): void {
    if (this.phase !== 'post_battle_explore' || !this.explorationLeader) return;
    if (this.explorationMoving) return;
    if (this.shrineDialogueActive || this.shrineSaveMenuVisible) return;
    if (this.lootPopupActive) return;

    let dx = 0;
    let dy = 0;

    if (this.cursors.left.isDown) dx = -1;
    else if (this.cursors.right.isDown) dx = 1;
    else if (this.cursors.up.isDown) dy = -1;
    else if (this.cursors.down.isDown) dy = 1;

    if (dx === 0 && dy === 0) return;

    // Update facing direction and sprite immediately
    const facingMap: Record<string, 'north' | 'south' | 'east' | 'west'> = {
      '-1,0': 'west',
      '1,0': 'east',
      '0,-1': 'north',
      '0,1': 'south',
    };
    const facing = facingMap[`${dx},${dy}`];
    if (facing && this.explorationLeader.sprite) {
      this.explorationLeader.facing = facing;
      const facingToSprite: Record<string, string> = {
        north: 'back',
        south: 'front',
        east: 'right',
        west: 'left',
      };
      const spriteKey = `sprite_${this.explorationLeader.dataId}_${facingToSprite[facing]}`;
      if (this.textures.exists(spriteKey)) {
        this.explorationLeader.sprite.setTexture(spriteKey);
      }
    }

    const newX = this.explorationLeader.gridX + dx;
    const newY = this.explorationLeader.gridY + dy;

    // Check bounds
    if (
      newX < 0 ||
      newX >= this.battleConfig.gridWidth ||
      newY < 0 ||
      newY >= this.battleConfig.gridHeight
    ) {
      // Check if CURRENT position (before the move) is within exit trigger
      // This handles walking off the edge when already in the exit zone
      const currentX = this.explorationLeader.gridX;
      const currentY = this.explorationLeader.gridY;
      if (this.checkExitTrigger(currentX, currentY)) {
        this.exitExploration();
      }
      return;
    }

    // Check terrain (0 = walkable, 1 = difficult but walkable, 2 = impassable)
    const terrain = this.battleConfig.terrain[newY]?.[newX];
    if (terrain === 2 || terrain === undefined) return;

    // Check if shrine is blocking the tile
    if (this.explorationShrine && newX === this.explorationShrine.gridX && newY === this.explorationShrine.gridY) {
      return; // Can't walk through the shrine
    }

    // Check if chest is blocking the tile
    for (const chest of this.explorationChests) {
      if (newX === chest.gridX && newY === chest.gridY) {
        return; // Can't walk through chests
      }
    }

    // Move the leader with smooth tweening
    this.explorationMoving = true;
    this.explorationLeader.gridX = newX;
    this.explorationLeader.gridY = newY;

    const targetX = newX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const targetY = newY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

    if (this.explorationLeader.sprite) {
      this.tweens.add({
        targets: this.explorationLeader.sprite,
        x: targetX,
        y: targetY,
        duration: 150,
        ease: 'Linear',
        onComplete: () => {
          this.explorationMoving = false;
          // Check if new position triggers exit
          if (this.checkExitTrigger(newX, newY)) {
            this.exitExploration();
          }
        },
      });
    } else {
      this.explorationMoving = false;
    }
  }

  /**
   * Check if a position triggers the map exit
   * Includes a 1 second grace period after entering exploration mode
   */
  private checkExitTrigger(x: number, y: number): boolean {
    const trigger = this.battleConfig.exitTrigger;
    if (!trigger) return false;

    // Grace period: don't trigger exits for 1 second after entering exploration
    if (this.time.now - this.explorationStartTime < 1000) return false;

    const bounds = trigger.bounds;
    return x >= bounds.x1 && x <= bounds.x2 && y >= bounds.y1 && y <= bounds.y2;
  }

  /**
   * Draw visual indicators for exit trigger zones during exploration
   */
  private drawExitTriggers(): void {
    const trigger = this.battleConfig.exitTrigger;
    if (!trigger) return;

    const tileSize = GAME_CONFIG.TILE_SIZE;
    const cornerLength = 8;
    const halfTile = tileSize / 2;

    // Dev mode: bright yellow for visibility
    // Player mode: light gray with grow/shrink animation
    const color = this.devMode ? 0xffff00 : 0xb0b0b0;
    const alpha = this.devMode ? 0.9 : 0.85;

    const bounds = trigger.bounds;
    for (let gridX = bounds.x1; gridX <= bounds.x2; gridX++) {
      for (let gridY = bounds.y1; gridY <= bounds.y2; gridY++) {
        // Create a graphics object for each tile, centered on the tile
        const graphics = this.add.graphics();
        const centerX = gridX * tileSize + halfTile;
        const centerY = gridY * tileSize + halfTile;
        graphics.setPosition(centerX, centerY);

        graphics.lineStyle(2, color, alpha);

        // Draw corner brackets relative to center (-halfTile to +halfTile)
        // Top-left corner
        graphics.moveTo(-halfTile, -halfTile + cornerLength);
        graphics.lineTo(-halfTile, -halfTile);
        graphics.lineTo(-halfTile + cornerLength, -halfTile);
        // Top-right corner
        graphics.moveTo(halfTile - cornerLength, -halfTile);
        graphics.lineTo(halfTile, -halfTile);
        graphics.lineTo(halfTile, -halfTile + cornerLength);
        // Bottom-right corner
        graphics.moveTo(halfTile, halfTile - cornerLength);
        graphics.lineTo(halfTile, halfTile);
        graphics.lineTo(halfTile - cornerLength, halfTile);
        // Bottom-left corner
        graphics.moveTo(-halfTile + cornerLength, halfTile);
        graphics.lineTo(-halfTile, halfTile);
        graphics.lineTo(-halfTile, halfTile - cornerLength);

        graphics.strokePath();

        // Make UI camera ignore this graphics (prevents double-rendering)
        this.uiCamera.ignore(graphics);

        // Add grow/shrink animation (player mode only)
        if (!this.devMode) {
          this.tweens.add({
            targets: graphics,
            scale: { from: 0.95, to: 1.05 },
            duration: 800,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1,
          });
        }
      }
    }
  }

  /**
   * Spawn a shrine NPC for exploration mode (used in Quetzi Shrine)
   */
  private spawnExplorationShrine(gridX: number, gridY: number): void {
    const pixelX = gridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const pixelY = gridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

    // Create shrine sprite (using pelor sprite as the shrine)
    const shrineSprite = this.add.sprite(pixelX, pixelY, 'sprite_pelor_front');
    shrineSprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);
    shrineSprite.setDepth(100);

    // Make UI camera ignore this sprite
    this.uiCamera.ignore(shrineSprite);

    this.explorationShrine = { sprite: shrineSprite, gridX, gridY };
  }

  /**
   * Check if player is adjacent to the shrine
   */
  private isAdjacentToShrine(): boolean {
    if (!this.explorationShrine || !this.explorationLeader) return false;

    const dx = Math.abs(this.explorationLeader.gridX - this.explorationShrine.gridX);
    const dy = Math.abs(this.explorationLeader.gridY - this.explorationShrine.gridY);

    // Adjacent means within 1 tile (including diagonals)
    return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
  }

  /**
   * Handle interaction with the exploration shrine
   */
  private handleShrineInteraction(): void {
    if (this.shrineDialogueActive) return;

    this.shrineDialogueActive = true;

    // Restore all heroes to full HP/Mana/Ki
    this.heroState = SaveManager.restoreAllResources(this.heroState);

    // Update heroUnits to reflect restored resources
    this.heroUnits.forEach(hero => {
      const state = this.heroState[hero.dataId];
      if (state) {
        hero.currentHp = state.currentHp;
        hero.maxHp = SaveManager.getMaxHp(hero.dataId, state.level);
        if (state.currentMana !== undefined) {
          (hero as any).currentMana = state.currentMana;
        }
        if (state.currentKi !== undefined) {
          (hero as any).currentKi = state.currentKi;
        }
      }
    });

    // Show shrine dialogue (same as town shrine)
    this.dialogueRenderer.startDialogue(
      ['*You burn your offering at the shrine. You find yourself fully rested. Would you like to record your progress for the bards?*'],
      'Shrine',
      () => {
        this.showShrineSaveMenu();
      }
    );
  }

  /**
   * Show the save menu at the shrine (initial Yes/No confirmation)
   */
  private showShrineSaveMenu(): void {
    this.shrineSaveMenuMode = 'confirm';
    this.shrineSaveMenuOptions = ['Yes', 'No'];
    this.renderShrineSaveMenu('Save Progress?');
  }

  /**
   * Show the slot selection menu
   */
  private showSaveSlotSelectionMenu(): void {
    this.saveSlotPreviews = SaveManager.getAllSlotPreviews();
    this.shrineSaveMenuMode = 'slots';

    this.shrineSaveMenuOptions = this.saveSlotPreviews.map((preview) => {
      if (preview.isEmpty) {
        return `Slot ${preview.slot}: [Empty]`;
      } else {
        const heroName = this.getHeroDisplayName(preview.mainHero || 'unknown');
        const level = preview.heroLevels?.[0] || 1;
        const time = this.formatPlayTimeShrine(preview.playTime || 0);
        return `Slot ${preview.slot}: ${heroName} Lv${level} ${time}`;
      }
    });
    this.shrineSaveMenuOptions.push('Cancel');

    this.renderShrineSaveMenu('Select Save Slot');
  }

  /**
   * Show overwrite confirmation menu
   */
  private showOverwriteConfirmationMenu(): void {
    const preview = this.saveSlotPreviews.find(p => p.slot === this.selectedSaveSlot);
    const heroName = this.getHeroDisplayName(preview?.mainHero || 'unknown');

    this.shrineSaveMenuMode = 'overwrite';
    this.shrineSaveMenuOptions = ['Yes', 'No'];
    this.renderShrineSaveMenu(`Overwrite ${heroName}?`);
  }

  private formatPlayTimeShrine(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private getHeroDisplayName(heroId: string): string {
    const names: Record<string, string> = {
      arden: 'Arden',
      quin: 'Quin',
      veil: 'Veil',
      ty: 'Ty',
      thorn: 'Thorn',
    };
    return names[heroId] || heroId;
  }

  /**
   * Render the shrine save menu with current options
   */
  private renderShrineSaveMenu(title: string): void {
    // Clean up existing menu
    if (this.shrineSaveMenuContainer) {
      this.shrineSaveMenuContainer.destroy();
    }

    this.shrineSaveMenuVisible = true;
    this.shrineSaveMenuSelectedIndex = 0;

    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    // Calculate menu dimensions based on options
    const menuWidth = this.shrineSaveMenuMode === 'slots' ? 280 : 200;
    const menuHeight = this.shrineSaveMenuOptions.length * 25 + 60;

    // Create menu container (fixed to screen)
    this.shrineSaveMenuContainer = this.add.container(screenWidth / 2, screenHeight / 2);
    this.shrineSaveMenuContainer.setScrollFactor(0);
    this.shrineSaveMenuContainer.setDepth(3000);

    // Background
    const bg = this.add.rectangle(0, 0, menuWidth, menuHeight, 0x1a1a2e, 0.95);
    bg.setStrokeStyle(2, 0x4a4a6a);
    this.shrineSaveMenuContainer.add(bg);

    // Title
    const titleText = this.add.text(0, -menuHeight / 2 + 20, title, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#f0d866',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
    this.shrineSaveMenuContainer.add(titleText);

    // Options
    this.shrineSaveMenuTexts = [];
    const startY = -menuHeight / 2 + 50;

    this.shrineSaveMenuOptions.forEach((option, i) => {
      const text = this.add.text(0, startY + i * 25, option, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: i === 0 ? '#ffff00' : '#ffffff',
      }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
      this.shrineSaveMenuContainer!.add(text);
      this.shrineSaveMenuTexts.push(text);
    });

    // Make main camera ignore this menu
    this.cameras.main.ignore(this.shrineSaveMenuContainer);
  }

  /**
   * Hide the shrine save menu
   */
  private hideShrineSaveMenu(): void {
    if (this.shrineSaveMenuContainer) {
      this.shrineSaveMenuContainer.destroy();
      this.shrineSaveMenuContainer = null;
    }
    this.shrineSaveMenuTexts = [];
    this.shrineSaveMenuVisible = false;
    this.shrineDialogueActive = false;
  }

  /**
   * Handle input for shrine save menu
   */
  private handleShrineSaveMenuInput(key: 'up' | 'down' | 'enter' | 'esc'): void {
    if (!this.shrineSaveMenuVisible) return;

    const maxIndex = this.shrineSaveMenuOptions.length - 1;

    if (key === 'up') {
      this.shrineSaveMenuSelectedIndex = Math.max(0, this.shrineSaveMenuSelectedIndex - 1);
    } else if (key === 'down') {
      this.shrineSaveMenuSelectedIndex = Math.min(maxIndex, this.shrineSaveMenuSelectedIndex + 1);
    } else if (key === 'enter') {
      this.handleShrineSaveMenuSelection();
      return;
    } else if (key === 'esc') {
      this.hideShrineSaveMenu();
      return;
    }

    // Update visual selection
    this.shrineSaveMenuTexts.forEach((text, i) => {
      text.setColor(i === this.shrineSaveMenuSelectedIndex ? '#ffff00' : '#ffffff');
    });
  }

  /**
   * Handle selection in shrine save menu based on current mode
   */
  private handleShrineSaveMenuSelection(): void {
    const selectedOption = this.shrineSaveMenuOptions[this.shrineSaveMenuSelectedIndex];

    if (this.shrineSaveMenuMode === 'confirm') {
      if (selectedOption === 'Yes') {
        this.showSaveSlotSelectionMenu();
      } else {
        this.hideShrineSaveMenu();
      }
    } else if (this.shrineSaveMenuMode === 'slots') {
      if (selectedOption === 'Cancel') {
        this.hideShrineSaveMenu();
        return;
      }

      // Extract slot number from choice
      const slotMatch = selectedOption.match(/^Slot (\d+):/);
      if (!slotMatch) return;

      this.selectedSaveSlot = parseInt(slotMatch[1], 10);
      const preview = this.saveSlotPreviews.find(p => p.slot === this.selectedSaveSlot);

      if (preview && !preview.isEmpty) {
        this.showOverwriteConfirmationMenu();
      } else {
        this.saveGameFromShrine(this.selectedSaveSlot);
      }
    } else if (this.shrineSaveMenuMode === 'overwrite') {
      if (selectedOption === 'Yes') {
        this.saveGameFromShrine(this.selectedSaveSlot);
      } else {
        this.hideShrineSaveMenu();
      }
    }
  }

  /**
   * Save the game from the shrine
   */
  private saveGameFromShrine(slot: number): void {
    // Calculate current play time
    const sessionSeconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const totalPlayTime = this.playTime + sessionSeconds;

    const saveData = {
      slot: slot,
      mainHero: this.heroId,
      currentMap: 'quetzi_shrine_exploration',
      playerPosition: this.explorationLeader ? { x: this.explorationLeader.gridX, y: this.explorationLeader.gridY } : { x: 0, y: 0 },
      playTime: totalPlayTime,
      heroState: this.heroState,
      flags: { ...this.gameFlags, 'quetzi_shrine_battle_complete': true },
      timestamp: new Date().toISOString(),
      inventory: this.inventory,
      chests: this.chestStates,
    };

    const success = SaveManager.save(saveData);

    this.hideShrineSaveMenu();

    if (success) {
      this.playTime = totalPlayTime;
      this.sessionStartTime = Date.now();

      this.dialogueRenderer.startDialogue(
        ['*Your progress has been recorded by the bards.*'],
        'Shrine',
        () => {
          this.shrineDialogueActive = false;
        }
      );
    } else {
      this.dialogueRenderer.startDialogue(
        ['*The bards seem distracted. Your progress could not be recorded.*'],
        'Shrine',
        () => {
          this.shrineDialogueActive = false;
        }
      );
    }
  }

  /**
   * Sync hero HP/mana/ki from units back to heroState
   * Must be called before exiting battle to persist damage taken
   */
  private syncHeroStateFromUnits(): void {
    for (const hero of this.heroUnits) {
      const heroId = hero.dataId;
      const state = this.heroState[heroId];
      if (!state) continue;

      // Sync current HP (capped at max for safety)
      state.currentHp = Math.max(0, Math.min(hero.currentHp, hero.maxHp));

      // Sync mana (and ki if applicable)
      if (hero.maxMana !== undefined && hero.maxMana > 0) {
        state.currentMana = Math.max(0, Math.min(hero.currentMana || 0, hero.maxMana));
      }
      if (hero.maxKi !== undefined && hero.maxKi > 0) {
        state.currentKi = Math.max(0, Math.min(hero.currentKi || 0, hero.maxKi));
      }
    }
  }

  /**
   * Exit exploration mode and go to the configured destination
   */
  private exitExploration(): void {
    // Sync hero stats from units before finalizing
    this.syncHeroStateFromUnits();

    // Finalize battle XP and check for level ups
    const xpSummaries = this.xpTracker.finalizeBattle();
    const updatedHeroState = this.xpTracker.getUpdatedHeroState();
    const levelUps = xpSummaries.filter((s) => s.leveledUp);

    const destination = this.battleConfig.exitTrigger?.destination || 'travel';

    if (destination === 'travel') {
      this.scene.start('TravelScene', {
        heroId: this.heroId,
        heroState: updatedHeroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        playerPosition: this.battleConfig.returnPosition,
        levelUps: levelUps.length > 0 ? levelUps : undefined,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    } else if (destination === 'post_battle_town') {
      this.scene.start('IshetarScene2', {
        heroId: this.heroId,
        heroState: updatedHeroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        devMode: this.devMode,
        levelUps: levelUps.length > 0 ? levelUps : undefined,
        inventory: this.inventory,
        chests: this.chestStates,
      });
    } else if (destination === 'town') {
      this.scene.start('IshetarScene1', {
        heroId: this.heroId,
        heroState: updatedHeroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        levelUps: levelUps.length > 0 ? levelUps : undefined,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    } else {
      // Generic scene destination - use the destination as scene name directly
      this.scene.start(destination, {
        heroId: this.heroId,
        heroState: updatedHeroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        levelUps: levelUps.length > 0 ? levelUps : undefined,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
        playerPosition: this.battleConfig.returnPosition,
      });
    }
  }

  /**
   * Show the special Meris encounter after the south gate battle
   */
  private showMerisEncounter(): void {
    // Clear all battle UI and enemy sprites
    this.clearBattleElements();

    // Position heroes in formation facing south (towards Meris)
    const heroFormation = [
      { x: 14, y: 12 },
      { x: 15, y: 12 },
      { x: 16, y: 12 },
      { x: 17, y: 12 },
      { x: 18, y: 12 },
    ];

    this.heroUnits.forEach((hero, index) => {
      if (index < heroFormation.length && hero.sprite) {
        const pos = heroFormation[index];
        hero.gridX = pos.x;
        hero.gridY = pos.y;
        hero.sprite.setPosition(
          pos.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          pos.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2
        );
        hero.sprite.setVisible(true);
        // Face south (towards Meris)
        hero.facing = 'south';
        const spriteKey = `sprite_${hero.dataId}_front`;
        if (this.textures.exists(spriteKey)) {
          hero.sprite.setTexture(spriteKey);
        }
        // Hide HP bars during cutscene
        if (hero.hpBarContainer) {
          hero.hpBarContainer.setVisible(false);
        }
      }
    });

    // Create Meris sprite south of the heroes (facing north toward them)
    const merisX = 16;
    const merisY = 13;
    const merisSprite = this.add.sprite(
      merisX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
      merisY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
      'sprite_meris_back'
    );
    // Scale sprite to fit tile (same as heroes/enemies)
    merisSprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);
    merisSprite.setDepth(100);
    // Make UI camera ignore this sprite (prevents double-rendering at wrong position)
    this.uiCamera.ignore(merisSprite);

    // Center camera on the scene
    this.cameras.main.centerOn(
      16 * GAME_CONFIG.TILE_SIZE,
      14 * GAME_CONFIG.TILE_SIZE
    );

    // Small delay then show Meris dialogue
    this.time.delayedCall(500, () => {
      // Load dialogues from cache
      const dialogues = this.cache.json.get('data_dialogues');
      const merisDialogue = dialogues?.meris_thanks || [
        { speaker: 'meris', text: 'Thank you so much for rescuing me and Ellie.' },
        { speaker: 'meris', text: 'Please, I desperately need to speak to Lady Rowena!' },
      ];

      // Show dialogue with Meris portrait
      const dialogueLines = merisDialogue.map((d: { text: string }) => d.text);
      this.dialogueRenderer.startDialogue(
        dialogueLines,
        'Meris',
        () => {
          // After dialogue, animate Meris walking north
          this.animateMerisWalkingNorth(merisSprite);
        },
        'portrait_meris'
      );
    });
  }

  /**
   * Animate Meris walking north off the map, then transition to post-battle town
   */
  private animateMerisWalkingNorth(merisSprite: Phaser.GameObjects.Sprite): void {
    // Change to north-facing sprite (back = facing away from camera = walking north)
    merisSprite.setTexture('sprite_meris_back');

    // Animate walking north
    this.tweens.add({
      targets: merisSprite,
      y: merisSprite.y - GAME_CONFIG.TILE_SIZE * 8,
      duration: 2000,
      ease: 'Linear',
      onComplete: () => {
        merisSprite.destroy();

        // Set flag so scenes know Meris is in town
        this.gameFlags['meris_in_town'] = true;

        // Enter exploration mode so player can collect loot before leaving
        this.time.delayedCall(500, () => {
          this.enterExplorationMode();
        });
      },
    });
  }

  /**
   * Clear battle UI elements for cutscene
   */
  private clearBattleElements(): void {
    // Keep grid overlay visible for cutscene positioning

    // Clear highlights
    if (this.highlightGraphics) {
      this.highlightGraphics.clear();
    }

    // Clear cursor
    if (this.cursorGraphics) {
      this.cursorGraphics.clear();
    }

    // Clear target highlights
    if (this.targetHighlightGraphics) {
      this.targetHighlightGraphics.clear();
    }

    // Hide UI elements
    if (this.uiContainer) {
      this.uiContainer.setVisible(false);
    }

    // Destroy enemy sprites
    this.enemyUnits.forEach((enemy) => {
      if (enemy.sprite) {
        enemy.sprite.destroy();
      }
      if (enemy.hpBarContainer) {
        enemy.hpBarContainer.destroy();
      }
      if (enemy.conditionMarkerContainer) {
        enemy.conditionMarkerContainer.destroy();
      }
    });

    // Destroy hero condition markers (combat is over, they shouldn't persist)
    this.heroUnits.forEach((hero) => {
      if (hero.conditionMarkerContainer) {
        hero.conditionMarkerContainer.destroy();
        hero.conditionMarkerContainer = undefined;
      }
    });

    // Destroy prop sprites (like the defeated Meris during south gate battle)
    this.propSprites.forEach((prop) => {
      if (prop) {
        prop.destroy();
      }
    });
    this.propSprites = [];

    // Hide combat log
    if (this.combatLogContainer) {
      this.combatLogContainer.setVisible(false);
    }

    // Destroy turn order panel (contains portraits that follow camera)
    if (this.turnOrderContainer) {
      this.turnOrderContainer.destroy();
    }

    // Hide result screen if still showing
    if (this.resultScreenContainer) {
      this.resultScreenContainer.destroy();
      this.resultScreenContainer = null;
    }
  }

  /**
   * Return to town scene
   */
  private returnToTown(): void {
    // Check if this battle heals the party on victory (story moment before shrines)
    if (this.battleConfig.healPartyOnVictory) {
      this.heroUnits.forEach((hero) => {
        hero.currentHp = hero.maxHp;
        if (hero.maxMana !== undefined) hero.currentMana = hero.maxMana;
        if (hero.maxKi !== undefined) hero.currentKi = hero.maxKi;
        hero.isUnconscious = false;
      });
    }

    // Sync hero stats from units before finalizing
    this.syncHeroStateFromUnits();

    // Finalize battle XP and check for level ups (Phase 5)
    const xpSummaries = this.xpTracker.finalizeBattle();
    const updatedHeroState = this.xpTracker.getUpdatedHeroState();

    // Check if any heroes leveled up
    const levelUps = xpSummaries.filter((s) => s.leveledUp);

    // Return to the scene specified when battle was started
    this.scene.start(this.returnScene, {
      heroId: this.heroId,
      heroState: updatedHeroState,
      gameFlags: this.gameFlags,
      playTime: this.playTime,
      playerPosition: this.returnPosition,
      levelUps: levelUps.length > 0 ? levelUps : undefined,
      inventory: this.inventory,
      chests: this.chestStates,
      devMode: this.devMode,
    });
  }

  /**
   * Wait/End Turn action - skips remaining actions for active unit
   */
  private waitAction(): void {
    if (!this.activeUnit || this.activeUnit.team !== 'hero') return;
    if (this.phase !== 'select_action' && this.phase !== 'select_move') return;

    // Mark as having used all actions
    this.activeUnit.hasMoved = true;
    this.activeUnit.hasActed = true;
    this.activeUnit.actionsRemaining = 0;

    this.showFloatingMessage(`${this.activeUnit.name} waits`);

    // Brief pause to let the message register before next turn starts
    this.time.delayedCall(800, () => {
      this.endCurrentTurn();
    });
  }

  /**
   * Show floating message in center of screen
   */
  private showFloatingMessage(
    text: string,
    color: number = 0xffffff,
    duration: number = 1000
  ): void {
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.8);
    bg.fillRoundedRect(screenWidth / 2 - 150, screenHeight / 2 - 30, 300, 60, 10);
    bg.setScrollFactor(0);
    bg.setDepth(1000);
    this.cameras.main.ignore(bg);

    // Text
    const message = this.add.text(screenWidth / 2, screenHeight / 2, text, {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      fontStyle: 'bold',
    });
    message.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    message.setOrigin(0.5);
    message.setScrollFactor(0);
    message.setDepth(1001);
    this.cameras.main.ignore(message);

    // Fade out and destroy
    this.tweens.add({
      targets: [bg, message],
      alpha: 0,
      delay: duration - 300,
      duration: 300,
      onComplete: () => {
        bg.destroy();
        message.destroy();
      },
    });
  }

  /**
   * Show enemy turn indicator with corner brackets around the unit
   */
  private showEnemyTurnIndicator(unit: Unit): void {
    this.hideEnemyTurnIndicator();

    if (!unit.sprite) return;

    const container = this.add.container(unit.sprite.x, unit.sprite.y);
    container.setDepth(45); // Below HP bars but above ground

    const size = GAME_CONFIG.TILE_SIZE;
    const halfSize = size / 2;
    const bracketLength = 8;
    const bracketWidth = 3;
    const color = 0xff4444; // Red to match enemy theme

    // Draw 4 corner brackets
    const graphics = this.add.graphics();
    graphics.lineStyle(bracketWidth, color, 1);

    // Top-left corner
    graphics.beginPath();
    graphics.moveTo(-halfSize, -halfSize + bracketLength);
    graphics.lineTo(-halfSize, -halfSize);
    graphics.lineTo(-halfSize + bracketLength, -halfSize);
    graphics.strokePath();

    // Top-right corner
    graphics.beginPath();
    graphics.moveTo(halfSize - bracketLength, -halfSize);
    graphics.lineTo(halfSize, -halfSize);
    graphics.lineTo(halfSize, -halfSize + bracketLength);
    graphics.strokePath();

    // Bottom-left corner
    graphics.beginPath();
    graphics.moveTo(-halfSize, halfSize - bracketLength);
    graphics.lineTo(-halfSize, halfSize);
    graphics.lineTo(-halfSize + bracketLength, halfSize);
    graphics.strokePath();

    // Bottom-right corner
    graphics.beginPath();
    graphics.moveTo(halfSize - bracketLength, halfSize);
    graphics.lineTo(halfSize, halfSize);
    graphics.lineTo(halfSize, halfSize - bracketLength);
    graphics.strokePath();

    container.add(graphics);

    // Pulsing animation
    this.tweens.add({
      targets: container,
      scaleX: 1.1,
      scaleY: 1.1,
      alpha: 0.7,
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.enemyTurnIndicator = container;

    // Make sure UI camera ignores this (it's a world object)
    this.uiCamera.ignore(container);
    this.uiCamera.ignore(graphics);
  }

  /**
   * Hide and destroy the enemy turn indicator
   */
  private hideEnemyTurnIndicator(): void {
    if (this.enemyTurnIndicator) {
      this.tweens.killTweensOf(this.enemyTurnIndicator);
      this.enemyTurnIndicator.destroy();
      this.enemyTurnIndicator = null;
    }
  }

  /**
   * Show action result panel with detailed combat info
   * Waits for user input before calling the callback
   */
  private showActionResultPanel(
    lines: string[],
    callback: () => void
  ): void {
    // Clear any existing panel
    if (this.actionResultPanel) {
      this.actionResultPanel.destroy();
      this.actionResultPanel = null;
    }

    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    const padding = 20;
    const panelWidth = 400;
    const lineSpacing = 4;

    // First pass: create text objects to measure actual heights
    const textObjects: Phaser.GameObjects.Text[] = [];
    let totalContentHeight = 0;

    for (const line of lines) {
      // Determine color based on content
      let color = '#ffffff';
      if (line.includes('MISS') || line.includes('misses')) {
        color = '#888888';
      } else if (line.includes('HIT') || line.includes('hits')) {
        color = '#44ff44';
      } else if (line.includes('DEFEATED') || line.includes('defeated')) {
        color = '#ff4444';
      } else if (line.includes('heals') || line.includes('HEAL')) {
        color = '#44ff44';
      }

      const text = this.add.text(0, 0, line, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color,
        align: 'center',
        wordWrap: { width: panelWidth - padding * 2 },
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      text.setOrigin(0.5, 0);
      textObjects.push(text);
      totalContentHeight += text.height + lineSpacing;
    }

    // Calculate actual panel height based on measured content
    const panelHeight = totalContentHeight + padding * 2 + 30; // +30 for "Press SPACE"

    // Create container with correct dimensions
    this.actionResultPanel = this.add.container(
      screenWidth / 2 - panelWidth / 2,
      screenHeight / 2 - panelHeight / 2
    );
    this.actionResultPanel.setScrollFactor(0);
    this.actionResultPanel.setDepth(1000);
    this.cameras.main.ignore(this.actionResultPanel);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95);
    bg.fillRoundedRect(0, 0, panelWidth, panelHeight, 8);
    bg.lineStyle(2, 0x4a4a6a, 1);
    bg.strokeRoundedRect(0, 0, panelWidth, panelHeight, 8);
    this.actionResultPanel.add(bg);

    // Position all text objects
    let y = padding;
    for (const text of textObjects) {
      text.setPosition(panelWidth / 2, y);
      this.actionResultPanel.add(text);
      y += text.height + lineSpacing;
    }

    // "Press ENTER to continue" prompt
    const promptText = this.add.text(panelWidth / 2, panelHeight - 25, '[ Press ENTER to continue ]', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
    });
    promptText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    promptText.setOrigin(0.5, 0.5);
    this.actionResultPanel.add(promptText);

    // Blink the prompt
    this.tweens.add({
      targets: promptText,
      alpha: 0.4,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    // Wait for user input
    this.waitForAdvance(() => {
      if (this.actionResultPanel) {
        this.actionResultPanel.destroy();
        this.actionResultPanel = null;
      }
      callback();
    });
  }

  /**
   * Show XP earned panel after an action
   */
  private showXPPanel(heroName: string, xpEarned: number, callback: () => void): void {
    // Skip if no XP earned
    if (xpEarned <= 0) {
      callback();
      return;
    }

    // Clear any existing panel
    if (this.actionResultPanel) {
      this.actionResultPanel.destroy();
      this.actionResultPanel = null;
    }

    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    const panelWidth = 300;
    const panelHeight = 80;

    this.actionResultPanel = this.add.container(
      screenWidth / 2 - panelWidth / 2,
      screenHeight / 2 - panelHeight / 2
    );
    this.actionResultPanel.setScrollFactor(0);
    this.actionResultPanel.setDepth(1000);
    this.cameras.main.ignore(this.actionResultPanel);

    // Background with golden tint for XP
    const bg = this.add.graphics();
    bg.fillStyle(0x2a2a1e, 0.95);
    bg.fillRoundedRect(0, 0, panelWidth, panelHeight, 8);
    bg.lineStyle(2, 0xffcc00, 1);
    bg.strokeRoundedRect(0, 0, panelWidth, panelHeight, 8);
    this.actionResultPanel.add(bg);

    // XP text
    const xpText = this.add.text(panelWidth / 2, 25, `${heroName} gained ${xpEarned} XP!`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffcc00',
      fontStyle: 'bold',
    });
    xpText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    xpText.setOrigin(0.5, 0.5);
    this.actionResultPanel.add(xpText);

    // "Press ENTER to continue" prompt
    const promptText = this.add.text(panelWidth / 2, panelHeight - 20, '[ ENTER ]', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
    });
    promptText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    promptText.setOrigin(0.5, 0.5);
    this.actionResultPanel.add(promptText);

    // Blink the prompt
    this.tweens.add({
      targets: promptText,
      alpha: 0.4,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    // Wait for user input
    this.waitForAdvance(() => {
      if (this.actionResultPanel) {
        this.actionResultPanel.destroy();
        this.actionResultPanel = null;
      }
      callback();
    });
  }

  /**
   * Update the turn order UI display
   */
  private updateTurnOrderUI(): void {
    // Clear existing turn order display
    if (this.turnOrderContainer) {
      this.turnOrderContainer.destroy();
    }

    const screenWidth = this.cameras.main.width;
    const panelWidth = 180;
    const rowHeight = 36;
    const portraitSize = 28;

    this.turnOrderContainer = this.add.container(screenWidth - panelWidth - 10, 60);
    this.turnOrderContainer.setScrollFactor(0);
    this.turnOrderContainer.setDepth(100);
    this.cameras.main.ignore(this.turnOrderContainer);

    // List units in turn order
    const maxDisplay = 8;
    const startIdx = Math.max(0, this.currentTurnIndex - 2);
    const endIdx = Math.min(this.turnOrder.length, startIdx + maxDisplay);

    // Background
    const bgHeight = (endIdx - startIdx) * rowHeight + 45;
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.8);
    bg.fillRoundedRect(0, 0, panelWidth, bgHeight, 5);
    this.turnOrderContainer.add(bg);

    // Title
    const title = this.add.text(panelWidth / 2, 10, 'Turn Order', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
    this.turnOrderContainer.add(title);

    let y = 35;

    for (let i = startIdx; i < endIdx; i++) {
      const entry = this.turnOrder[i];
      const isActive = i === this.currentTurnIndex;
      const isPast = i < this.currentTurnIndex;

      // Color based on team and status
      let color = entry.unit.team === 'hero' ? '#44ff44' : '#ff4444';
      if (isPast) color = '#666666';
      if (entry.unit.isUnconscious) color = '#333333';

      // Add portrait
      const heroData = this.heroesData[entry.unit.dataId];
      const enemyData = this.enemiesData[entry.unit.dataId];
      const portraitKey = heroData?.portrait || enemyData?.sprite || null;

      if (portraitKey) {
        try {
          // For heroes, use portrait; for enemies, use front sprite
          const textureKey = heroData ? portraitKey : `${portraitKey}_front`;
          const portrait = this.add.image(6 + portraitSize / 2, y + portraitSize / 2 - 2, textureKey);
          portrait.setDisplaySize(portraitSize, portraitSize);

          // Determine border color based on status effects (priority: active > status > team)
          let borderColor = isActive ? 0xffff00 : (entry.unit.team === 'hero' ? 0x44ff44 : 0xff4444);
          let borderWidth = isActive ? 2 : 1;

          // Check for status effects and use the first one's color
          const visibleEffects = entry.unit.statusEffects.filter(e =>
            e.type !== 'unconscious' && STATUS_COLORS[e.type as StatusEffectType]
          );

          if (visibleEffects.length > 0 && !isPast) {
            const primaryEffect = visibleEffects[0];
            borderColor = STATUS_COLORS[primaryEffect.type as StatusEffectType];
            borderWidth = 2;
          }

          const border = this.add.graphics();
          border.lineStyle(borderWidth, borderColor, isPast ? 0.4 : 1);
          border.strokeRect(6, y - 2, portraitSize, portraitSize);

          // Dim past portraits
          if (isPast || entry.unit.isUnconscious) {
            portrait.setAlpha(0.4);
          }

          this.turnOrderContainer.add(portrait);
          this.turnOrderContainer.add(border);

          // Add status effect duration number overlay (bottom-right corner of portrait)
          if (visibleEffects.length > 0 && !isPast && !entry.unit.isUnconscious) {
            const effect = visibleEffects[0];
            if (effect.duration > 0 && effect.duration !== -1) {
              // Duration background
              const durBg = this.add.graphics();
              durBg.fillStyle(STATUS_COLORS[effect.type as StatusEffectType], 0.9);
              durBg.fillCircle(6 + portraitSize - 4, y + portraitSize - 6, 7);
              this.turnOrderContainer.add(durBg);

              // Duration text
              const durText = this.add.text(6 + portraitSize - 4, y + portraitSize - 6, `${effect.duration}`, {
                fontFamily: 'monospace',
                fontSize: '8px',
                color: '#ffffff',
                fontStyle: 'bold',
              }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
              this.turnOrderContainer.add(durText);
            }

            // Show multiple effect indicator if more than one effect
            if (visibleEffects.length > 1) {
              const multiText = this.add.text(6 + 4, y + portraitSize - 6, `+${visibleEffects.length - 1}`, {
                fontFamily: 'monospace',
                fontSize: '7px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 2,
              }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
              this.turnOrderContainer.add(multiText);
            }
          }
        } catch {
          // Portrait not found, skip
        }
      }

      // Create name text (offset to make room for portrait)
      const nameText = this.add.text(40, y, entry.unit.name, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color,
      });
      nameText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

      // Get visible status effects for this unit
      const visibleEffects = entry.unit.statusEffects.filter(e =>
        e.type !== 'unconscious' && STATUS_COLORS[e.type as StatusEffectType]
      );

      // Show status text or active indicator below name
      if (isActive) {
        nameText.setStyle({ fontStyle: 'bold', color: '#ffff00' });
        // Add arrow indicator
        const arrow = this.add.text(40, y + 12, '► ACTIVE', {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#ffff00',
        });
        arrow.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.turnOrderContainer.add(arrow);
      } else if (visibleEffects.length > 0 && !isPast && !entry.unit.isUnconscious) {
        // Show status effect names in matching color
        const effectNames = visibleEffects.map(e => e.type).join(', ');
        const effectColor = STATUS_COLORS[visibleEffects[0].type as StatusEffectType];
        const statusText = this.add.text(40, y + 12, effectNames, {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: `#${effectColor.toString(16).padStart(6, '0')}`,
        });
        statusText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.turnOrderContainer.add(statusText);
      }

      // Show initiative total
      const initText = this.add.text(panelWidth - 10, y, `${entry.total}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#aaaaaa',
      }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);

      this.turnOrderContainer.add(nameText);
      this.turnOrderContainer.add(initText);

      y += rowHeight;
    }

    // Show "..." if there are more units
    if (endIdx < this.turnOrder.length) {
      const moreText = this.add.text(panelWidth / 2, y, `+${this.turnOrder.length - endIdx} more`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#666666',
      }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
      this.turnOrderContainer.add(moreText);
    }

    // Update combat log position (below turn order)
    this.updateCombatLog();

    // Update condition markers on all units
    this.updateAllConditionMarkers();
  }

  /**
   * Update condition markers for all units
   */
  private updateAllConditionMarkers(): void {
    for (const unit of this.units) {
      updateConditionMarkers(unit, this);
    }
  }

  // ============================================
  // Combat Log
  // ============================================

  /**
   * Add a message to the combat log
   */
  private addCombatLogMessage(message: string): void {
    this.combatLogMessages.push(message);

    // Keep only the last N messages
    if (this.combatLogMessages.length > this.MAX_LOG_MESSAGES) {
      this.combatLogMessages.shift();
    }

    this.updateCombatLog();
  }

  /**
   * Update the combat log display
   */
  private updateCombatLog(): void {
    // Clear existing combat log
    if (this.combatLogContainer) {
      this.combatLogContainer.destroy();
    }

    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;
    const panelWidth = 180; // Match the turn order panel width
    const lineSpacing = 2;
    const padding = 8;

    // First pass: create text objects to measure actual heights
    const textObjects: Phaser.GameObjects.Text[] = [];
    let totalContentHeight = 0;

    for (const msg of this.combatLogMessages) {
      const msgText = this.add.text(0, 0, msg, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#cccccc',
        wordWrap: { width: panelWidth - padding * 2 },
      });
      msgText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      textObjects.push(msgText);
      totalContentHeight += msgText.height + lineSpacing;
    }

    // Calculate actual panel height based on content
    const bgHeight = totalContentHeight + padding * 2 + 18; // +18 for title

    // Position below the turn order panel (same x position)
    this.combatLogContainer = this.add.container(screenWidth - panelWidth - 10, screenHeight - 160);
    this.combatLogContainer.setScrollFactor(0);
    this.combatLogContainer.setDepth(100);
    this.cameras.main.ignore(this.combatLogContainer);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.7);
    bg.fillRoundedRect(0, 0, panelWidth, bgHeight, 5);
    this.combatLogContainer.add(bg);

    // Title
    const title = this.add.text(padding, 6, 'Combat Log', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#888888',
      fontStyle: 'bold',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.combatLogContainer.add(title);

    // Position all text objects
    let y = 22;
    for (const msgText of textObjects) {
      msgText.setPosition(padding, y);
      this.combatLogContainer.add(msgText);
      y += msgText.height + lineSpacing;
    }
  }

  // ============================================
  // Active Unit Panel (bottom-left during combat)
  // ============================================

  /**
   * Update or create the active unit panel showing current hero's stats
   */
  private updateActiveUnitPanel(): void {
    // Destroy existing panel
    if (this.activeUnitPanel) {
      this.activeUnitPanel.destroy();
      this.activeUnitPanel = null;
    }

    // Only show for heroes during combat (not during cutscenes/victory/defeat)
    if (!this.activeUnit || this.activeUnit.team !== 'hero') {
      return;
    }

    if (this.phase === 'intro' || this.phase === 'victory' || this.phase === 'defeat') {
      return;
    }

    const unit = this.activeUnit;
    const screenHeight = this.cameras.main.height;
    const panelWidth = 160;
    const panelHeight = 130;
    const padding = 8;

    // Create container in bottom-left
    this.activeUnitPanel = this.add.container(10, screenHeight - panelHeight - 10);
    this.activeUnitPanel.setScrollFactor(0);
    this.activeUnitPanel.setDepth(100);
    this.cameras.main.ignore(this.activeUnitPanel);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.85);
    bg.fillRoundedRect(0, 0, panelWidth, panelHeight, 5);
    bg.lineStyle(1, 0xffffff, 0.3);
    bg.strokeRoundedRect(0, 0, panelWidth, panelHeight, 5);
    this.activeUnitPanel.add(bg);

    // Get hero data for XP info
    const heroData = this.heroesData[unit.dataId];
    const heroState = this.heroState[unit.dataId];

    // Name and level
    const heroLevel = heroState?.level ?? heroData?.level ?? 1;
    const nameText = this.add.text(padding, padding, `${unit.name} (Lv ${heroLevel})`, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    nameText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.activeUnitPanel.add(nameText);

    // HP Bar
    let barY = 24;
    const barWidth = panelWidth - padding * 2 - 24;
    const barHeight = 8;

    const hpLabel = this.add.text(padding, barY, 'HP', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#ff4444',
    });
    hpLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.activeUnitPanel.add(hpLabel);

    const hpBar = new ProgressBar(this, {
      x: padding + 22,
      y: barY,
      width: barWidth,
      height: barHeight,
      fillColor: 0xff4444,
      backgroundColor: 0x331111,
      borderColor: 0x662222,
      showText: true,
      textFormat: 'fraction',
    });
    hpBar.setValue(unit.currentHp, unit.maxHp);
    hpBar.addToContainer(this.activeUnitPanel);

    // MP or Ki Bar
    barY += 14;
    if (unit.maxMana !== undefined && unit.maxMana > 0) {
      const mpLabel = this.add.text(padding, barY, 'MP', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#4444ff',
      });
      mpLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.activeUnitPanel.add(mpLabel);

      const mpBar = new ProgressBar(this, {
        x: padding + 22,
        y: barY,
        width: barWidth,
        height: barHeight,
        fillColor: 0x4444ff,
        backgroundColor: 0x111133,
        borderColor: 0x222266,
        showText: true,
        textFormat: 'fraction',
      });
      mpBar.setValue(unit.currentMana ?? 0, unit.maxMana);
      mpBar.addToContainer(this.activeUnitPanel);
    } else if (unit.maxKi !== undefined && unit.maxKi > 0) {
      const kiLabel = this.add.text(padding, barY, 'Ki', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffaa00',
      });
      kiLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.activeUnitPanel.add(kiLabel);

      const kiBar = new ProgressBar(this, {
        x: padding + 22,
        y: barY,
        width: barWidth,
        height: barHeight,
        fillColor: 0xffaa00,
        backgroundColor: 0x332200,
        borderColor: 0x664400,
        showText: true,
        textFormat: 'fraction',
      });
      kiBar.setValue(unit.currentKi ?? 0, unit.maxKi);
      kiBar.addToContainer(this.activeUnitPanel);
    } else {
      // No secondary resource - skip this row
      barY -= 14;
    }

    // XP Bar
    barY += 14;
    if (heroData) {
      const xpLabel = this.add.text(padding, barY, 'XP', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#44ff44',
      });
      xpLabel.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.activeUnitPanel.add(xpLabel);

      // Combine base XP with battle-earned XP
      const baseXp = heroState?.xp ?? 0;
      const battleXp = this.xpTracker.getBattleXP(unit.dataId);
      const totalXp = baseXp + battleXp;
      const xpToNextLevel = heroData.xpToNextLevel || 50; // Default to 50 if not set

      const xpBar = new ProgressBar(this, {
        x: padding + 22,
        y: barY,
        width: barWidth,
        height: barHeight,
        fillColor: 0x44ff44,
        backgroundColor: 0x113311,
        borderColor: 0x226622,
        showText: true,
        textFormat: 'fraction',
      });
      xpBar.setValue(totalXp, xpToNextLevel);
      xpBar.addToContainer(this.activeUnitPanel);
    }

    // Stats section
    barY += 18;
    const statsY = barY;
    const statFontSize = '8px';
    const colWidth = 52;

    // Check for status effects that modify stats
    const hasBarkskin = hasStatusEffect(unit, 'barkskin');
    const hasExposed = hasStatusEffect(unit, 'exposed');
    const hasImmobilized = hasStatusEffect(unit, 'immobilized');

    // Helper to get stat color
    const getStatColor = (stat: string): string => {
      if (stat === 'DEF') {
        if (hasBarkskin) return '#44ff44'; // Buffed - green
        if (hasExposed) return '#ff4444'; // Debuffed - red
      }
      if (stat === 'MOV' && hasImmobilized) {
        return '#ff4444'; // Debuffed - red
      }
      return '#cccccc'; // Normal
    };

    // First column: ATK, MAG, SPD
    const stats1 = [
      { label: 'ATK', value: unit.attack },
      { label: 'MAG', value: unit.magic },
      { label: 'SPD', value: unit.speed },
    ];

    stats1.forEach((stat, i) => {
      const statText = this.add.text(padding, statsY + i * 12, `${stat.label}: ${stat.value}`, {
        fontFamily: 'monospace',
        fontSize: statFontSize,
        color: getStatColor(stat.label),
      });
      statText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.activeUnitPanel!.add(statText);
    });

    // Second column: DEF, RES, MOV
    const movValue = hasImmobilized ? 0 : 6; // MOVEMENT_RANGE is 6
    const stats2 = [
      { label: 'DEF', value: unit.defense },
      { label: 'RES', value: unit.resilience },
      { label: 'MOV', value: movValue },
    ];

    stats2.forEach((stat, i) => {
      const statText = this.add.text(padding + colWidth, statsY + i * 12, `${stat.label}: ${stat.value}`, {
        fontFamily: 'monospace',
        fontSize: statFontSize,
        color: getStatColor(stat.label),
      });
      statText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.activeUnitPanel!.add(statText);
    });

    // Third column: Status indicators (if any)
    const statusEffects = unit.statusEffects.filter(e => e.type !== 'unconscious');
    if (statusEffects.length > 0) {
      let statusY = statsY;
      statusEffects.forEach((effect, i) => {
        if (i >= 3) return; // Max 3 status icons
        const color = STATUS_COLORS[effect.type] || 0xffffff;
        const statusText = this.add.text(
          padding + colWidth * 2,
          statusY,
          effect.type.substring(0, 3).toUpperCase(),
          {
            fontFamily: 'monospace',
            fontSize: '7px',
            color: `#${color.toString(16).padStart(6, '0')}`,
          }
        );
        statusText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.activeUnitPanel!.add(statusText);
        statusY += 10;
      });
    }
  }

  /**
   * Hide the active unit panel (during cutscenes, victory, etc.)
   */
  private hideActiveUnitPanel(): void {
    if (this.activeUnitPanel) {
      this.activeUnitPanel.destroy();
      this.activeUnitPanel = null;
    }
  }

  // ============================================
  // Action Menu
  // ============================================

  /**
   * Show the action menu for the active unit
   */
  private showActionMenu(): void {
    if (!this.activeUnit || this.activeUnit.team !== 'hero') return;

    this.showingActionMenu = true;
    this.actionMenuIndex = 0;
    this.phase = 'select_action';

    // Build menu options
    const menuOptions = this.buildActionMenuOptions();

    // Create menu container positioned in bottom-left, above the character panel
    const screenHeight = this.cameras.main.height;

    // Menu dimensions
    const menuWidth = 260;
    const menuHeight = menuOptions.length * 30 + 20;

    // Position: left-aligned (x=10), above the character panel (which is at screenHeight - 140)
    const characterPanelTop = screenHeight - 140;
    const menuX = 10;
    const menuY = characterPanelTop - menuHeight - 10; // 10px gap above character panel

    this.actionMenuContainer = this.add.container(menuX, menuY);
    this.actionMenuContainer.setScrollFactor(0);
    this.actionMenuContainer.setDepth(500);
    this.cameras.main.ignore(this.actionMenuContainer);

    // Background (wider to fit long ability names + costs)
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.9);
    bg.fillRoundedRect(0, 0, menuWidth, menuHeight, 5);
    bg.lineStyle(2, 0xffffff, 0.8);
    bg.strokeRoundedRect(0, 0, menuWidth, menuHeight, 5);
    this.actionMenuContainer.add(bg);

    // Title
    const title = this.add.text(menuWidth / 2, 10, 'Actions', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
    this.actionMenuContainer.add(title);

    // Close hint in top-right corner
    const closeHint = this.add.text(menuWidth - 10, 8, 'Q: -', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#666666',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.actionMenuContainer.add(closeHint);

    // Menu items
    let y = 35;
    menuOptions.forEach((option, index) => {
      const isSelected = index === this.actionMenuIndex;
      const color = option.enabled ? (isSelected ? '#ffff00' : '#ffffff') : '#666666';

      const text = this.add.text(20, y, option.label, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      text.setData('index', index);
      this.actionMenuContainer!.add(text);

      // Show cost if applicable (right-aligned with padding)
      if (option.cost) {
        const costText = this.add.text(250, y, option.cost, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#aaaaaa',
        }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
        this.actionMenuContainer!.add(costText);
      }

      y += 28;
    });

    this.updateActionMenuHighlight();
  }

  /**
   * Build the list of action menu options
   */
  private buildActionMenuOptions(): { label: string; action: string; enabled: boolean; cost?: string; abilityId?: string }[] {
    const options: { label: string; action: string; enabled: boolean; cost?: string; abilityId?: string }[] = [];

    if (!this.activeUnit) return options;

    // First option: Move or Wait (Move if hasn't moved, Wait if already moved)
    if (!this.activeUnit.hasMoved) {
      // Check if immobilized
      const isImmobilized = hasStatusEffect(this.activeUnit, 'immobilized');
      options.push({
        label: isImmobilized ? 'Move (Immobilized!)' : 'Move (M)',
        action: 'move',
        enabled: !isImmobilized,
      });
    } else {
      // Already moved - show Wait first
      options.push({
        label: 'Wait',
        action: 'wait',
        enabled: true,
      });
    }

    // Get hero level for ability filtering from heroState (not static heroesData)
    const heroState = this.heroState[this.activeUnit.dataId];
    const heroLevel = heroState?.level ?? 1;

    // Add abilities with hotkey hints
    const abilityKeys = ['A', 'S', 'D'];
    let abilityIndex = 0;
    for (const abilityId of this.activeUnit.abilities) {
      const ability = this.abilitiesData[abilityId];
      if (!ability) continue;

      // Check level requirement
      const levelRequired = ability.levelRequired ?? 1;
      const meetsLevelRequirement = heroLevel >= levelRequired || this.devMode;

      const canUse = canUseAbility(this.activeUnit, ability);
      let costStr: string | undefined;

      if (ability.cost > 0 && ability.costType) {
        costStr = `${ability.cost} ${ability.costType}`;
      }

      // Skip locked abilities entirely (don't show in menu)
      if (!meetsLevelRequirement) {
        continue;
      }

      // Add hotkey hint to label
      const hotkeyHint = abilityIndex < abilityKeys.length ? ` (${abilityKeys[abilityIndex]})` : '';

      options.push({
        label: ability.name + hotkeyHint,
        action: 'ability',
        enabled: canUse.canUse,
        cost: costStr,
        abilityId: ability.id,
      });
      abilityIndex++;
    }

    // Add Item option (after abilities, before Wait)
    const hasItems = this.inventoryManager.hasAnyConsumables();
    options.push({
      label: 'Item (I)',
      action: 'item',
      enabled: hasItems,
    });

    // Add Wait at the end if Move was shown first (so user can still wait after moving)
    if (!this.activeUnit.hasMoved) {
      options.push({
        label: 'Wait',
        action: 'wait',
        enabled: true,
      });
    }

    return options;
  }

  /**
   * Navigate the action menu
   */
  private navigateActionMenu(direction: number): void {
    const options = this.buildActionMenuOptions();
    this.actionMenuIndex = (this.actionMenuIndex + direction + options.length) % options.length;
    this.updateActionMenuHighlight();
  }

  /**
   * Update the visual highlight in action menu
   */
  private updateActionMenuHighlight(): void {
    if (!this.actionMenuContainer) return;

    const options = this.buildActionMenuOptions();

    // Update all text colors
    this.actionMenuContainer.getAll().forEach((obj) => {
      if (obj instanceof Phaser.GameObjects.Text && obj.getData('index') !== undefined) {
        const index = obj.getData('index') as number;
        const option = options[index];
        if (option) {
          const isSelected = index === this.actionMenuIndex;
          obj.setColor(option.enabled ? (isSelected ? '#ffff00' : '#ffffff') : '#666666');
          if (isSelected) {
            obj.setText('► ' + option.label);
          } else {
            obj.setText(option.label);
          }
        }
      }
    });
  }

  /**
   * Confirm action menu selection
   */
  private confirmActionMenuSelection(): void {
    const options = this.buildActionMenuOptions();
    const selected = options[this.actionMenuIndex];

    if (!selected || !selected.enabled) return;

    if (selected.action === 'wait') {
      this.hideActionMenu();
      this.waitAction();
    } else if (selected.action === 'move') {
      this.hideActionMenu();
      // Enter movement mode for the active unit
      if (this.activeUnit) {
        this.selectUnit(this.activeUnit);
        this.enterMovementMode(this.activeUnit);
      }
    } else if (selected.action === 'ability' && selected.abilityId) {
      const ability = this.abilitiesData[selected.abilityId];
      if (ability) {
        this.hideActionMenu();
        this.startTargeting(ability);
      }
    } else if (selected.action === 'item') {
      this.hideActionMenu();
      this.showItemSubmenu();
    }
  }

  /**
   * Hide the action menu
   */
  private hideActionMenu(): void {
    if (this.actionMenuContainer) {
      this.actionMenuContainer.destroy();
      this.actionMenuContainer = null;
    }
    this.showingActionMenu = false;
  }

  /**
   * Select an action menu option by its action type (for hotkeys)
   */
  private selectActionMenuOption(actionType: string): void {
    const options = this.buildActionMenuOptions();
    const index = options.findIndex(opt => opt.action === actionType);
    if (index !== -1 && options[index].enabled) {
      this.actionMenuIndex = index;
      this.updateActionMenuHighlight();
      this.confirmActionMenuSelection();
    }
  }

  /**
   * Select an action menu option by index (for A/S/D hotkeys)
   * Index 0 = first ability, Index 1 = second ability, etc.
   */
  private selectActionMenuByIndex(abilityIndex: number): void {
    const options = this.buildActionMenuOptions();
    // Find the nth ability in the menu (skip Move/Wait options)
    let abilityCount = 0;
    for (let i = 0; i < options.length; i++) {
      if (options[i].action === 'ability') {
        if (abilityCount === abilityIndex) {
          if (options[i].enabled) {
            this.actionMenuIndex = i;
            this.updateActionMenuHighlight();
            this.confirmActionMenuSelection();
          }
          return;
        }
        abilityCount++;
      }
    }
  }

  // ============================================
  // Item Submenu
  // ============================================

  /**
   * Show the item submenu with available consumables
   */
  private showItemSubmenu(): void {
    if (!this.activeUnit || this.activeUnit.team !== 'hero') return;

    this.showingItemMenu = true;
    this.itemMenuIndex = 0;
    this.phase = 'select_action'; // Keep in select_action phase

    const availableItems = this.inventoryManager.getAvailableConsumables();

    // Create menu container
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    this.itemMenuContainer = this.add.container(screenWidth / 2 - 130, screenHeight / 2 - 80);
    this.itemMenuContainer.setScrollFactor(0);
    this.itemMenuContainer.setDepth(500);
    this.cameras.main.ignore(this.itemMenuContainer);

    // Background
    const menuWidth = 260;
    const menuHeight = (availableItems.length + 1) * 30 + 20; // +1 for Back option
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.9);
    bg.fillRoundedRect(0, 0, menuWidth, menuHeight, 5);
    bg.lineStyle(2, 0x44ff44, 0.8); // Green border for items
    bg.strokeRoundedRect(0, 0, menuWidth, menuHeight, 5);
    this.itemMenuContainer.add(bg);

    // Title
    const title = this.add.text(menuWidth / 2, 10, 'Items', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#44ff44',
      fontStyle: 'bold',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
    this.itemMenuContainer.add(title);

    // Close hint
    const closeHint = this.add.text(menuWidth - 10, 8, 'Q: Back', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#666666',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
    this.itemMenuContainer.add(closeHint);

    // Menu items
    let y = 35;
    availableItems.forEach((entry, index) => {
      const isSelected = index === this.itemMenuIndex;
      const color = isSelected ? '#ffff00' : '#ffffff';

      const text = this.add.text(20, y, entry.item.name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      text.setData('index', index);
      text.setData('itemId', entry.itemId);
      this.itemMenuContainer!.add(text);

      // Show count (right-aligned)
      const countText = this.add.text(250, y, `x${entry.count}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#aaaaaa',
      }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(1, 0);
      this.itemMenuContainer!.add(countText);

      y += 28;
    });

    // Back option
    const backText = this.add.text(20, y, '[Back]', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: availableItems.length === this.itemMenuIndex ? '#ffff00' : '#888888',
    });
    backText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    backText.setData('index', availableItems.length);
    backText.setData('itemId', null);
    this.itemMenuContainer.add(backText);

    this.updateItemMenuHighlight();
  }

  /**
   * Navigate the item submenu
   */
  private navigateItemMenu(direction: number): void {
    const availableItems = this.inventoryManager.getAvailableConsumables();
    const totalOptions = availableItems.length + 1; // +1 for Back
    this.itemMenuIndex = (this.itemMenuIndex + direction + totalOptions) % totalOptions;
    this.updateItemMenuHighlight();
  }

  /**
   * Update the visual highlight in item submenu
   */
  private updateItemMenuHighlight(): void {
    if (!this.itemMenuContainer) return;

    const availableItems = this.inventoryManager.getAvailableConsumables();

    this.itemMenuContainer.getAll().forEach((obj) => {
      if (obj instanceof Phaser.GameObjects.Text && obj.getData('index') !== undefined) {
        const index = obj.getData('index') as number;
        const isSelected = index === this.itemMenuIndex;
        const isBackOption = index === availableItems.length;

        if (isBackOption) {
          obj.setColor(isSelected ? '#ffff00' : '#888888');
          obj.setText(isSelected ? '► [Back]' : '[Back]');
        } else {
          const item = availableItems[index];
          if (item) {
            obj.setColor(isSelected ? '#ffff00' : '#ffffff');
            obj.setText(isSelected ? '► ' + item.item.name : item.item.name);
          }
        }
      }
    });
  }

  /**
   * Confirm item submenu selection
   */
  private confirmItemMenuSelection(): void {
    const availableItems = this.inventoryManager.getAvailableConsumables();

    // Back option
    if (this.itemMenuIndex === availableItems.length) {
      this.hideItemMenu();
      this.showActionMenu();
      return;
    }

    // Select an item
    const selected = availableItems[this.itemMenuIndex];
    if (selected) {
      this.selectedItemId = selected.itemId;
      this.hideItemMenu();
      this.startItemTargeting(selected.item);
    }
  }

  /**
   * Hide the item submenu
   */
  private hideItemMenu(): void {
    if (this.itemMenuContainer) {
      this.itemMenuContainer.destroy();
      this.itemMenuContainer = null;
    }
    this.showingItemMenu = false;
  }

  /**
   * Start targeting mode for an item (adjacent allies only)
   */
  private startItemTargeting(item: ItemData): void {
    if (!this.activeUnit) return;

    this.phase = 'select_target';

    // Get valid targets (adjacent allies, including self)
    this.validTargets = this.getValidItemTargets(item);

    if (this.validTargets.length === 0) {
      this.showFloatingMessage('No valid targets!', 0xff4444);
      this.selectedItemId = null;
      this.showActionMenu();
      return;
    }

    this.isTargeting = true;
    this.targetIndex = 0;

    // Highlight valid targets (green for allies)
    this.highlightItemTargets();

    // Select first target
    this.updateTargetSelection();
  }

  /**
   * Get valid targets for item usage (adjacent allies including self)
   */
  private getValidItemTargets(item: ItemData): Unit[] {
    if (!this.activeUnit) return [];

    const range = item.range ?? 1; // Default to adjacent
    const validTargets: Unit[] = [];

    // Find all allies within range
    for (const unit of this.units) {
      if (unit.team !== 'hero') continue;
      if (unit.isUnconscious) continue;

      const distance = getDistance(
        this.activeUnit.gridX,
        this.activeUnit.gridY,
        unit.gridX,
        unit.gridY
      );
      if (distance <= range) {
        validTargets.push(unit);
      }
    }

    return validTargets;
  }

  /**
   * Highlight valid item targets
   */
  private highlightItemTargets(): void {
    this.targetHighlightGraphics.clear();

    if (!this.activeUnit || !this.selectedItemId) return;

    const item = InventoryManager.getItem(this.selectedItemId);
    if (!item) return;

    const range = item.range ?? 1;

    // Highlight range tiles (green for ally targeting)
    this.targetHighlightGraphics.fillStyle(0x44ff44, 0.2);

    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= range) {
          const tx = this.activeUnit.gridX + dx;
          const ty = this.activeUnit.gridY + dy;

          if (tx >= 0 && tx < this.battleConfig.gridWidth &&
              ty >= 0 && ty < this.battleConfig.gridHeight) {
            const pixelX = tx * GAME_CONFIG.TILE_SIZE;
            const pixelY = ty * GAME_CONFIG.TILE_SIZE;
            this.targetHighlightGraphics.fillRect(pixelX, pixelY, GAME_CONFIG.TILE_SIZE, GAME_CONFIG.TILE_SIZE);
          }
        }
      }
    }
  }

  /**
   * Execute item usage on a target
   */
  private executeItemUse(target: Unit): void {
    if (!this.activeUnit || !this.selectedItemId) return;

    const item = InventoryManager.getItem(this.selectedItemId);
    if (!item) return;

    // Clear targeting state
    this.isTargeting = false;
    this.targetHighlightGraphics.clear();

    // Execute the item effect
    this.resolveItemEffect(item, target);
  }

  /**
   * Resolve item effect on target
   */
  private resolveItemEffect(item: ItemData, target: Unit): void {
    if (!this.activeUnit) return;

    const user = this.activeUnit;

    switch (item.effect.type) {
      case 'heal':
        this.resolveHealingItem(item, user, target);
        break;

      case 'restore_resource':
        this.resolveResourceItem(item, user, target);
        break;

      case 'remove_condition':
        this.resolveConditionRemovalItem(item, user, target);
        break;

      default:
        console.warn(`Unknown item effect type: ${item.effect.type}`);
        this.finishItemUse();
    }
  }

  /**
   * Resolve healing item (Healing Potion)
   */
  private resolveHealingItem(item: ItemData, user: Unit, target: Unit): void {
    const healDice = item.effect.amount as string;
    const healRoll = rollDice(healDice);
    const healAmount = Math.min(healRoll.total, target.maxHp - target.currentHp);

    target.currentHp = Math.min(target.maxHp, target.currentHp + healRoll.total);

    // Update HP bar
    updateHpBar(target);

    // Combat log
    this.addCombatLogMessage(`${user.name} uses ${item.name} on ${target.name}!`);
    this.addCombatLogMessage(`Healed ${healAmount} HP (${healDice}: ${healRoll.total})`);

    // Show result panel
    this.showItemResultPanel(item, user, target, `+${healAmount} HP`);
  }

  /**
   * Resolve resource restoration item (Distilled Dendritium)
   */
  private resolveResourceItem(item: ItemData, user: Unit, target: Unit): void {
    const restoreDice = item.effect.amount as string;
    const restoreRoll = rollDice(restoreDice);

    let resourceRestored = 0;
    let resourceName = '';

    // Restore mana or ki depending on the target
    if (target.currentMana !== undefined && target.maxMana !== undefined) {
      resourceRestored = Math.min(restoreRoll.total, target.maxMana - target.currentMana);
      target.currentMana = Math.min(target.maxMana, target.currentMana + restoreRoll.total);
      resourceName = 'MP';
    } else if (target.currentKi !== undefined && target.maxKi !== undefined) {
      resourceRestored = Math.min(restoreRoll.total, target.maxKi - target.currentKi);
      target.currentKi = Math.min(target.maxKi, target.currentKi + restoreRoll.total);
      resourceName = 'Ki';
    } else {
      // Target has no mana or ki (shouldn't happen for heroes)
      this.addCombatLogMessage(`${user.name} uses ${item.name} on ${target.name}!`);
      this.addCombatLogMessage(`${target.name} has no resource to restore!`);
      this.finishItemUse();
      return;
    }

    // Combat log
    this.addCombatLogMessage(`${user.name} uses ${item.name} on ${target.name}!`);
    this.addCombatLogMessage(`Restored ${resourceRestored} ${resourceName} (${restoreDice}: ${restoreRoll.total})`);

    // Show result panel
    this.showItemResultPanel(item, user, target, `+${resourceRestored} ${resourceName}`);
  }

  /**
   * Resolve condition removal item (Antidote, Celestial Tears)
   */
  private resolveConditionRemovalItem(item: ItemData, user: Unit, target: Unit): void {
    const conditionToRemove = item.effect.condition;

    if (conditionToRemove === 'any') {
      // Celestial Tears - remove any one condition
      if (target.statusEffects.length === 0) {
        this.addCombatLogMessage(`${user.name} uses ${item.name} on ${target.name}!`);
        this.addCombatLogMessage(`${target.name} has no conditions to remove!`);
        this.showItemResultPanel(item, user, target, 'No effect');
        return;
      }

      // Remove the first condition
      const removed = target.statusEffects.shift();
      if (removed) {
        this.addCombatLogMessage(`${user.name} uses ${item.name} on ${target.name}!`);
        this.addCombatLogMessage(`${removed.type} removed!`);
        updateConditionMarkers(target, this);
        this.showItemResultPanel(item, user, target, `${removed.type} removed`);
      }
    } else {
      // Specific condition removal (Antidote removes poison)
      const conditionIndex = target.statusEffects.findIndex(e => e.type === conditionToRemove);

      if (conditionIndex === -1) {
        this.addCombatLogMessage(`${user.name} uses ${item.name} on ${target.name}!`);
        this.addCombatLogMessage(`${target.name} is not affected by ${conditionToRemove}!`);
        this.showItemResultPanel(item, user, target, 'No effect');
        return;
      }

      target.statusEffects.splice(conditionIndex, 1);
      this.addCombatLogMessage(`${user.name} uses ${item.name} on ${target.name}!`);
      this.addCombatLogMessage(`${conditionToRemove} removed!`);
      updateConditionMarkers(target, this);
      this.showItemResultPanel(item, user, target, `${conditionToRemove} removed`);
    }
  }

  /**
   * Show item result panel and wait for click to continue
   */
  private showItemResultPanel(item: ItemData, user: Unit, target: Unit, result: string): void {
    // Remove the item from inventory
    this.inventoryManager.removeConsumable(this.selectedItemId as ConsumableId);

    // Award XP for using an item
    const xpEarned = this.xpTracker.awardItemXP(user.dataId, item.name);

    // Create result panel similar to action result panel
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    this.actionResultPanel = this.add.container(screenWidth / 2, screenHeight / 2 - 50);
    this.actionResultPanel.setScrollFactor(0);
    this.actionResultPanel.setDepth(600);
    this.cameras.main.ignore(this.actionResultPanel);

    // Background - taller to fit XP line
    const panelWidth = 280;
    const panelHeight = 120;
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.9);
    bg.fillRoundedRect(-panelWidth / 2, 0, panelWidth, panelHeight, 8);
    bg.lineStyle(2, 0x44ff44, 0.8);
    bg.strokeRoundedRect(-panelWidth / 2, 0, panelWidth, panelHeight, 8);
    this.actionResultPanel.add(bg);

    // Item name
    const itemText = this.add.text(0, 15, item.name, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#44ff44',
      fontStyle: 'bold',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
    this.actionResultPanel.add(itemText);

    // Usage text
    const usageText = this.add.text(0, 40, `${user.name} → ${target.name}`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ffffff',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
    this.actionResultPanel.add(usageText);

    // Result
    const resultText = this.add.text(0, 60, result, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffff00',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
    this.actionResultPanel.add(resultText);

    // XP earned (only show for heroes)
    if (xpEarned > 0) {
      const xpText = this.add.text(0, 82, `+${xpEarned} XP`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffcc00',
      }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 0);
      this.actionResultPanel.add(xpText);
    }

    // Click to continue
    const continueText = this.add.text(0, panelHeight - 10, 'Click to continue', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#888888',
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5, 1);
    this.actionResultPanel.add(continueText);

    // Wait for click to continue
    this.waitingForAdvance = true;
    this.pendingAdvanceCallback = () => {
      this.finishItemUse();
    };
  }

  /**
   * Cancel item targeting and return to action menu
   */
  private cancelItemTargeting(): void {
    this.isTargeting = false;
    this.selectedItemId = null;
    this.validTargets = [];
    this.targetHighlightGraphics.clear();
    this.showActionMenu();
  }

  /**
   * Finish item use (consume action, continue turn)
   */
  private finishItemUse(): void {
    // Clean up result panel
    if (this.actionResultPanel) {
      this.actionResultPanel.destroy();
      this.actionResultPanel = null;
    }

    // Clear item selection
    this.selectedItemId = null;

    // Consume the action
    if (this.activeUnit) {
      this.activeUnit.actionsRemaining--;
      if (this.activeUnit.actionsRemaining <= 0) {
        this.activeUnit.hasActed = true;
      }

      // Check if unit can still act (Azrael's double action)
      if (this.activeUnit.actionsRemaining > 0) {
        this.showActionMenu();
      } else {
        this.endCurrentTurn();
      }
    }
  }

  // ============================================
  // Targeting System
  // ============================================

  /**
   * Start targeting mode for an ability
   */
  private startTargeting(ability: Ability): void {
    if (!this.activeUnit) return;

    this.selectedAbility = ability;
    this.phase = 'select_target';

    // Handle self-targeting abilities immediately
    if (ability.targetType === 'self') {
      this.executeAbility(ability, this.activeUnit);
      return;
    }

    // Handle AOE abilities with area targeting
    if (ability.targetType === 'area' && ability.areaSize) {
      this.startAOETargeting(ability);
      return;
    }

    // Get valid targets
    this.validTargets = getValidTargets(this.activeUnit, ability, this.units);

    if (this.validTargets.length === 0) {
      this.showFloatingMessage('No valid targets!', 0xff4444);
      this.showActionMenu();
      return;
    }

    this.isTargeting = true;
    this.targetIndex = 0;

    // Highlight valid targets
    this.highlightValidTargets(ability);

    // Select first target
    this.updateTargetSelection();
  }

  /**
   * Highlight all valid targets for the ability
   */
  private highlightValidTargets(ability: Ability): void {
    this.targetHighlightGraphics.clear();

    // Determine highlight color based on target type
    const color = ability.targetType === 'ally' ? 0x44ff44 : 0xff4444;

    // Highlight range tiles
    if (this.activeUnit && ability.range > 0) {
      this.targetHighlightGraphics.fillStyle(color, 0.2);

      for (let dx = -ability.range; dx <= ability.range; dx++) {
        for (let dy = -ability.range; dy <= ability.range; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= ability.range) {
            const tx = this.activeUnit.gridX + dx;
            const ty = this.activeUnit.gridY + dy;

            if (tx >= 0 && tx < this.battleConfig.gridWidth &&
                ty >= 0 && ty < this.battleConfig.gridHeight) {
              const pixelX = tx * GAME_CONFIG.TILE_SIZE;
              const pixelY = ty * GAME_CONFIG.TILE_SIZE;
              this.targetHighlightGraphics.fillRect(pixelX, pixelY, GAME_CONFIG.TILE_SIZE, GAME_CONFIG.TILE_SIZE);
            }
          }
        }
      }
    }
  }

  /**
   * Cycle through valid targets
   */
  private cycleTarget(direction: number): void {
    if (this.validTargets.length === 0) return;

    // Clear previous target highlight
    const prevTarget = this.validTargets[this.targetIndex];
    if (prevTarget?.sprite) {
      prevTarget.sprite.clearTint();
    }

    this.targetIndex = (this.targetIndex + direction + this.validTargets.length) % this.validTargets.length;
    this.updateTargetSelection();
  }

  /**
   * Update target selection visual
   */
  private updateTargetSelection(): void {
    if (this.validTargets.length === 0) return;

    const target = this.validTargets[this.targetIndex];
    if (!target) return;

    // Highlight the selected target sprite
    if (target.sprite) {
      target.sprite.setTint(0xff0000);
    }

    // Draw yellow cursor around target tile
    this.drawTargetCursor(target.gridX, target.gridY);

    // Pan camera to target
    const pixelPos = this.gridManager.gridToPixel(target.gridX, target.gridY);
    this.cameras.main.pan(pixelPos.x, pixelPos.y, 200);
  }

  /**
   * Draw a yellow cursor around the target tile
   */
  private drawTargetCursor(gridX: number, gridY: number): void {
    // Clear previous cursor (but keep range highlight)
    this.cursorGraphics.clear();

    const pixelX = gridX * GAME_CONFIG.TILE_SIZE;
    const pixelY = gridY * GAME_CONFIG.TILE_SIZE;
    const size = GAME_CONFIG.TILE_SIZE;

    // Draw animated cursor (yellow pulsing border)
    this.cursorGraphics.lineStyle(3, 0xffff00, 1);
    this.cursorGraphics.strokeRect(pixelX + 2, pixelY + 2, size - 4, size - 4);

    // Inner white border for visibility
    this.cursorGraphics.lineStyle(1, 0xffffff, 0.8);
    this.cursorGraphics.strokeRect(pixelX + 4, pixelY + 4, size - 8, size - 8);
  }

  /**
   * Confirm target selection and execute ability
   */
  private confirmTarget(): void {
    if (!this.selectedAbility || this.validTargets.length === 0) return;

    const target = this.validTargets[this.targetIndex];
    if (!target) return;

    // Save ability reference before clearing targeting state
    const ability = this.selectedAbility;

    // Clear target highlight
    if (target.sprite) {
      target.sprite.clearTint();
    }

    this.cancelTargeting();
    this.executeAbility(ability, target);
  }

  /**
   * Cancel targeting mode
   */
  private cancelTargeting(): void {
    // Clear target highlights
    this.validTargets.forEach((t) => {
      if (t.sprite) t.sprite.clearTint();
    });
    this.targetHighlightGraphics.clear();
    this.cursorGraphics.clear();

    this.isTargeting = false;
    this.selectedAbility = null;
    this.validTargets = [];
    this.targetIndex = 0;
  }

  // ============================================
  // AOE Targeting System
  // ============================================

  /**
   * Start AOE targeting mode for an area ability
   */
  private startAOETargeting(ability: Ability): void {
    if (!this.activeUnit || !ability.areaSize) return;

    this.isAOETargeting = true;
    this.aoeSize = ability.areaSize;

    // Calculate valid tiles where the AOE can be placed
    // Per spec: at least one tile of the AOE must be within range
    this.validAOETiles = this.calculateValidAOETiles(ability);

    if (this.validAOETiles.length === 0) {
      this.showFloatingMessage('No valid targets in range!', 0xff4444);
      this.isAOETargeting = false;
      this.showActionMenu();
      return;
    }

    // Start AOE origin at caster position (or first valid tile)
    const firstValid = this.validAOETiles[0];
    this.aoeOrigin = { x: firstValid.x, y: firstValid.y };

    // Draw the AOE preview
    this.drawAOEPreview();
  }

  /**
   * Calculate valid tiles where AOE origin can be placed
   * AOE origin is top-left corner. At least one tile of the AOE must be in range.
   */
  private calculateValidAOETiles(ability: Ability): { x: number; y: number }[] {
    if (!this.activeUnit || !ability.areaSize) return [];

    const validTiles: { x: number; y: number }[] = [];
    const range = ability.range;
    const { width, height } = ability.areaSize;

    // Check all possible AOE origin positions
    // The origin is the top-left corner of the AOE area
    for (let ox = 0; ox < this.battleConfig.gridWidth - width + 1; ox++) {
      for (let oy = 0; oy < this.battleConfig.gridHeight - height + 1; oy++) {
        // Check if at least one tile of this AOE placement is within range
        let hasValidTile = false;
        for (let dx = 0; dx < width && !hasValidTile; dx++) {
          for (let dy = 0; dy < height && !hasValidTile; dy++) {
            const tx = ox + dx;
            const ty = oy + dy;
            const distance = getDistance(this.activeUnit.gridX, this.activeUnit.gridY, tx, ty);
            if (distance <= range) {
              hasValidTile = true;
            }
          }
        }
        if (hasValidTile) {
          validTiles.push({ x: ox, y: oy });
        }
      }
    }

    return validTiles;
  }

  /**
   * Move the AOE cursor
   */
  private moveAOECursor(dx: number, dy: number): void {
    const newX = this.aoeOrigin.x + dx;
    const newY = this.aoeOrigin.y + dy;

    // Check if new position is valid
    const isValid = this.validAOETiles.some(t => t.x === newX && t.y === newY);
    if (isValid) {
      this.aoeOrigin = { x: newX, y: newY };
      this.drawAOEPreview();

      // Pan camera to center of AOE
      const centerX = this.aoeOrigin.x + this.aoeSize.width / 2;
      const centerY = this.aoeOrigin.y + this.aoeSize.height / 2;
      const pixelPos = this.gridManager.gridToPixel(centerX, centerY);
      this.cameras.main.pan(pixelPos.x, pixelPos.y, 100);
    }
  }

  /**
   * Draw AOE area preview
   */
  private drawAOEPreview(): void {
    this.targetHighlightGraphics.clear();
    this.cursorGraphics.clear();

    if (!this.activeUnit || !this.selectedAbility) return;

    // Draw range indicator (semi-transparent)
    this.targetHighlightGraphics.fillStyle(0xff4444, 0.15);
    const range = this.selectedAbility.range;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= range) {
          const tx = this.activeUnit.gridX + dx;
          const ty = this.activeUnit.gridY + dy;
          if (tx >= 0 && tx < this.battleConfig.gridWidth &&
              ty >= 0 && ty < this.battleConfig.gridHeight) {
            const pixelX = tx * GAME_CONFIG.TILE_SIZE;
            const pixelY = ty * GAME_CONFIG.TILE_SIZE;
            this.targetHighlightGraphics.fillRect(pixelX, pixelY, GAME_CONFIG.TILE_SIZE, GAME_CONFIG.TILE_SIZE);
          }
        }
      }
    }

    // Draw AOE area (bright red for targeted area)
    this.cursorGraphics.fillStyle(0xff0000, 0.5);
    for (let dx = 0; dx < this.aoeSize.width; dx++) {
      for (let dy = 0; dy < this.aoeSize.height; dy++) {
        const tx = this.aoeOrigin.x + dx;
        const ty = this.aoeOrigin.y + dy;
        const pixelX = tx * GAME_CONFIG.TILE_SIZE;
        const pixelY = ty * GAME_CONFIG.TILE_SIZE;
        this.cursorGraphics.fillRect(pixelX, pixelY, GAME_CONFIG.TILE_SIZE, GAME_CONFIG.TILE_SIZE);
      }
    }

    // Draw border around AOE area
    this.cursorGraphics.lineStyle(3, 0xffff00, 1);
    const startX = this.aoeOrigin.x * GAME_CONFIG.TILE_SIZE;
    const startY = this.aoeOrigin.y * GAME_CONFIG.TILE_SIZE;
    const aoeWidth = this.aoeSize.width * GAME_CONFIG.TILE_SIZE;
    const aoeHeight = this.aoeSize.height * GAME_CONFIG.TILE_SIZE;
    this.cursorGraphics.strokeRect(startX, startY, aoeWidth, aoeHeight);

    // Highlight units in AOE area
    this.highlightUnitsInAOE();

    // Update instructions with target count
    const targetsInAOE = this.getUnitsInAOE();
    const enemyCount = targetsInAOE.filter(u => u.team === 'enemy').length;
    const allyCount = targetsInAOE.filter(u => u.team === 'hero').length;
    let targetInfo = '';
    if (enemyCount > 0) targetInfo += `${enemyCount} enem${enemyCount === 1 ? 'y' : 'ies'}`;
    if (allyCount > 0) {
      if (targetInfo) targetInfo += ', ';
      targetInfo += `${allyCount} all${allyCount === 1 ? 'y' : 'ies'} (!)`;
    }
  }

  /**
   * Highlight units within the AOE area
   */
  private highlightUnitsInAOE(): void {
    // Clear all unit tints first
    this.units.forEach(u => {
      if (u.sprite && !u.isUnconscious) {
        u.sprite.clearTint();
      }
    });

    // Tint units in AOE
    const unitsInAOE = this.getUnitsInAOE();
    unitsInAOE.forEach(u => {
      if (u.sprite) {
        // Red tint for enemies, orange for allies (warning)
        u.sprite.setTint(u.team === 'enemy' ? 0xff0000 : 0xffa500);
      }
    });
  }

  /**
   * Get all units within the current AOE area
   */
  private getUnitsInAOE(): Unit[] {
    return this.units.filter(u => {
      if (u.isUnconscious) return false;
      return u.gridX >= this.aoeOrigin.x &&
             u.gridX < this.aoeOrigin.x + this.aoeSize.width &&
             u.gridY >= this.aoeOrigin.y &&
             u.gridY < this.aoeOrigin.y + this.aoeSize.height;
    });
  }

  /**
   * Confirm AOE target and execute ability on all units in area
   */
  private confirmAOETarget(): void {
    if (!this.selectedAbility || !this.activeUnit) return;

    const ability = this.selectedAbility;
    const targets = this.getUnitsInAOE();
    const origin = { ...this.aoeOrigin }; // Save origin before clearing
    const size = { ...this.aoeSize };

    // Clear AOE state without showing menu (we're executing, not canceling)
    this.cancelAOETargeting(false);

    // Execute on all targets (pass origin for zone creation)
    this.executeAOEAbility(ability, targets, origin, size);
  }

  /**
   * Cancel AOE targeting mode
   * @param showMenu - Whether to show the action menu (true for ESC cancel, false for confirm)
   */
  private cancelAOETargeting(showMenu: boolean = true): void {
    // Clear highlights
    this.targetHighlightGraphics.clear();
    this.cursorGraphics.clear();

    // Clear unit tints
    this.units.forEach(u => {
      if (u.sprite) u.sprite.clearTint();
    });

    this.isAOETargeting = false;
    this.selectedAbility = null;
    this.validAOETiles = [];
    this.aoeOrigin = { x: 0, y: 0 };

    // Show action menu again only if canceling (not confirming)
    if (showMenu) {
      this.showActionMenu();
    }
  }

  /**
   * Execute an AOE ability on multiple targets
   */
  private executeAOEAbility(
    ability: Ability,
    targets: Unit[],
    origin: { x: number; y: number },
    size: { width: number; height: number }
  ): void {
    if (!this.activeUnit) return;

    this.phase = 'executing_action';

    // Pay the cost
    payAbilityCost(this.activeUnit, ability);

    // Update the active unit panel to reflect mana/ki cost
    this.updateActiveUnitPanel();

    this.addCombatLogMessage(`${this.activeUnit.name} → ${ability.name} (AOE)`);

    if (targets.length === 0) {
      this.addCombatLogMessage('  No targets hit!');
      this.showFloatingMessage(`${ability.name}: No targets!`, 0xaaaaaa);
    } else {
      // Resolve spell against each target
      let totalDefeated = 0;

      targets.forEach(target => {
        // Wardstone: +2 RES on first save of battle (for defender)
        let wardstoneBonus = 0;
        if (target.equipment === 'wardstone' &&
            target.equipmentBonusState &&
            !target.equipmentBonusState.firstSaveUsed) {
          wardstoneBonus = 2;
          target.resilience += 2;
          target.equipmentBonusState.firstSaveUsed = true;
          this.addCombatLogMessage(`${target.name}'s Wardstone grants +2 RES!`);
        }

        const result = resolveSpell(this.activeUnit!, target, ability);

        // Restore resilience if bonus was applied
        if (wardstoneBonus > 0) {
          target.resilience -= wardstoneBonus;
        }

        // Log result for each target
        const saveRoll = result.saveRoll;
        if (saveRoll.dice !== 'none') {
          const bonusText = wardstoneBonus > 0 ? `(+${wardstoneBonus})` : '';
          const rollStr = `${saveRoll.rolls[0]}+${target.resilience + wardstoneBonus}${bonusText}=${saveRoll.finalTotal || saveRoll.total}`;
          const saveResult = result.savePassed ? 'SAVED!' : 'FAILED!';
          this.addCombatLogMessage(`  ${target.name}: SAVE ${rollStr}`);
          this.addCombatLogMessage(`    ${saveResult}`);
        }

        if (result.totalDamage !== undefined && result.totalDamage > 0) {
          this.addCombatLogMessage(`    DMG: ${result.totalDamage}`);
          this.showDamageNumber(target, result.totalDamage, false);
          this.trackDamage(result.totalDamage, true); // Hero AOE dealing damage
        }

        if (result.targetDefeated) {
          totalDefeated++;

          // Bloodstone: heal 2 HP on first kill (AOE)
          if (this.activeUnit!.equipment === 'bloodstone' &&
              this.activeUnit!.equipmentBonusState &&
              !this.activeUnit!.equipmentBonusState.firstKillUsed) {
            this.activeUnit!.equipmentBonusState.firstKillUsed = true;
            applyHealing(this.activeUnit!, 2);
            this.showDamageNumber(this.activeUnit!, 2, true);
            this.addCombatLogMessage(`${this.activeUnit!.name}'s Bloodstone heals 2 HP!`);
          }

          this.handleUnitDefeated(target);
        }
      });

      const msg = `${ability.name}: ${targets.length} hit!`;
      this.showFloatingMessage(msg, 0xff4444);

      if (totalDefeated > 0) {
        this.addCombatLogMessage(`  ${totalDefeated} defeated!`);
      }
    }

    // Create persistent zone if ability has entangle_zone effect
    if (ability.effect?.type === 'entangle_zone') {
      this.createZone(ability, origin, size);
    }

    // Mark as having acted
    this.activeUnit.actionsRemaining--;
    if (this.activeUnit.actionsRemaining <= 0) {
      this.activeUnit.hasActed = true;
    }

    // Check if unit still has actions (Azrael's double action)
    const hasMoreActions = this.activeUnit && this.activeUnit.actionsRemaining > 0;

    this.time.delayedCall(500, () => {
      this.checkBattleEnd();

      if (this.phase !== 'victory' && this.phase !== 'defeat') {
        if (hasMoreActions) {
          // Unit has more actions - no pause, show menu immediately
          this.showActionMenu();
        } else {
          // Turn is ending - wait for user input before advancing (Shining Force style)
          this.waitForAdvance(() => {
            this.endCurrentTurn();
          });
        }
      }
    });
  }

  // ============================================
  // Persistent Zones (e.g. Entangle)
  // ============================================

  /**
   * Create a persistent zone on the battlefield
   */
  private createZone(
    ability: Ability,
    origin: { x: number; y: number },
    size: { width: number; height: number }
  ): void {
    if (!this.activeUnit || !ability.effect) return;

    // Roll duration
    const durationNotation = ability.effect.duration;
    let duration = 1;
    if (typeof durationNotation === 'string') {
      const durationRoll = rollDice(durationNotation);
      duration = durationRoll.total;
    } else if (typeof durationNotation === 'number') {
      duration = durationNotation;
    }

    const zone: Zone = {
      id: `zone_${Date.now()}`,
      type: 'entangle',
      originX: origin.x,
      originY: origin.y,
      width: size.width,
      height: size.height,
      duration,
      damage: ability.damage || '1d6',
      damageOnSave: ability.damageOnSave || 'half',
      casterId: this.activeUnit.dataId,
    };

    this.zones.push(zone);
    this.addCombatLogMessage(`  Zone created for ${duration} rounds!`);

    // Draw the zone
    this.drawZones();
  }

  /**
   * Draw all active zones on the battlefield
   */
  private drawZones(): void {
    this.zoneGraphics.clear();

    for (const zone of this.zones) {
      const color = STATUS_COLORS.entangle_zone; // Forest green
      const startX = zone.originX * GAME_CONFIG.TILE_SIZE;
      const startY = zone.originY * GAME_CONFIG.TILE_SIZE;
      const zoneWidth = zone.width * GAME_CONFIG.TILE_SIZE;
      const zoneHeight = zone.height * GAME_CONFIG.TILE_SIZE;

      // Fill with semi-transparent color
      this.zoneGraphics.fillStyle(color, 0.2);
      this.zoneGraphics.fillRect(startX, startY, zoneWidth, zoneHeight);

      // Draw border
      this.zoneGraphics.lineStyle(3, color, 0.8);
      this.zoneGraphics.strokeRect(startX, startY, zoneWidth, zoneHeight);
    }
  }

  /**
   * Check if a position is inside any zone
   */
  private getZonesAtPosition(x: number, y: number): Zone[] {
    return this.zones.filter(zone =>
      x >= zone.originX &&
      x < zone.originX + zone.width &&
      y >= zone.originY &&
      y < zone.originY + zone.height
    );
  }

  /**
   * Apply zone damage to a unit (on entry or turn start)
   */
  private applyZoneDamage(unit: Unit, zone: Zone, reason: string): void {
    if (unit.isUnconscious) return;

    // Roll save
    const saveRoll = rollDice('1d20');
    const saveTotal = saveRoll.total + unit.resilience;
    const targetNumber = 13; // Use standard magic target
    const savePassed = saveTotal >= targetNumber;

    // Roll damage
    const damageRoll = rollDice(zone.damage);
    let totalDamage = damageRoll.total;

    if (savePassed && zone.damageOnSave === 'half') {
      totalDamage = Math.floor(totalDamage / 2);
    } else if (savePassed && zone.damageOnSave === 'none') {
      totalDamage = 0;
    }

    if (totalDamage > 0) {
      unit.currentHp -= totalDamage;
      this.showDamageNumber(unit, totalDamage, false);
      this.addCombatLogMessage(`  ${unit.name} takes ${totalDamage} damage from Entangle (${reason})!`);

      if (unit.currentHp <= 0) {
        unit.currentHp = 0;
        this.handleUnitDefeated(unit);
      }
    } else {
      this.addCombatLogMessage(`  ${unit.name} avoids Entangle damage!`);
    }
  }

  /**
   * Process zone effects at the start of a unit's turn
   */
  private processZoneTurnStart(unit: Unit): void {
    const zones = this.getZonesAtPosition(unit.gridX, unit.gridY);
    for (const zone of zones) {
      this.applyZoneDamage(unit, zone, 'turn start');
    }
  }

  /**
   * Decrement zone durations at round end and remove expired zones
   */
  private processZoneRoundEnd(): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      this.zones[i].duration--;
      if (this.zones[i].duration <= 0) {
        this.addCombatLogMessage(`Entangle zone fades away.`);
        this.zones.splice(i, 1);
      }
    }
    this.drawZones();
  }

  // ============================================
  // Combat Execution
  // ============================================

  /**
   * Execute an ability on a target
   */
  private executeAbility(ability: Ability, target: Unit): void {
    if (!this.activeUnit) return;

    this.phase = 'executing_action';

    // Pay the cost
    payAbilityCost(this.activeUnit, ability);

    // Update the active unit panel to reflect mana/ki cost
    this.updateActiveUnitPanel();

    // Face the target
    this.faceTarget(this.activeUnit, target);

    // Only award XP on first action per turn (prevents Azrael Hide+Attack abuse)
    const shouldTrackXP = this.activeUnit.team === 'hero' && !this.hasEarnedXPThisTurn;

    // Track XP before action (to calculate earned XP)
    const xpBefore = shouldTrackXP
      ? this.xpTracker.getBattleXP(this.activeUnit.dataId)
      : 0;

    // Build result lines for the action panel
    const resultLines: string[] = [];

    if (ability.type === 'attack') {
      // Ambusher's Ring: +2 ATK on first attack of battle
      let ambusherBonus = 0;
      if (this.activeUnit.equipment === 'ambushers_ring' &&
          this.activeUnit.equipmentBonusState &&
          !this.activeUnit.equipmentBonusState.firstAttackUsed) {
        ambusherBonus = 2;
        this.activeUnit.attack += 2;
        this.activeUnit.equipmentBonusState.firstAttackUsed = true;
        this.addCombatLogMessage(`${this.activeUnit.name}'s Ambusher's Ring grants +2 ATK!`);
      }

      const result = resolveAttack(this.activeUnit, target, ability);

      // Restore attack stat if bonus was applied
      if (ambusherBonus > 0) {
        this.activeUnit.attack -= ambusherBonus;
      }

      // Build descriptive result lines
      const attackRoll = result.attackRoll;
      const rollTotal = attackRoll.finalTotal || attackRoll.total;
      const bonusText = ambusherBonus > 0 ? ` (+${ambusherBonus})` : '';
      resultLines.push(`${this.activeUnit.name} uses ${ability.name}!`);
      resultLines.push(`Rolls ${attackRoll.rolls[0]} + ${this.activeUnit.attack + ambusherBonus}${bonusText} = ${rollTotal} vs DEF ${result.targetNumber}`);

      // Award XP for resource spent (paid attacks) - regardless of hit/miss
      if (shouldTrackXP && ability.cost > 0) {
        this.xpTracker.awardResourceXP(this.activeUnit.dataId, ability.cost, ability.name);
      }

      if (result.hit && result.damageRoll) {
        resultLines.push(`HIT! ${result.totalDamage} damage to ${target.name}!`);
        this.showDamageNumber(target, result.totalDamage!, false);
        this.trackDamage(result.totalDamage!, true);

        // Award XP for damage (only for 0-cost attacks)
        if (shouldTrackXP && ability.cost === 0) {
          this.xpTracker.awardDamageXP(this.activeUnit.dataId, result.totalDamage!);
        }

        if (result.defenderDefeated) {
          resultLines.push(`${target.name} is DEFEATED!`);
          if (shouldTrackXP) {
            this.xpTracker.awardKillXP(this.activeUnit.dataId, target.name);
          }

          // Bloodstone: heal 2 HP on first kill
          if (this.activeUnit.equipment === 'bloodstone' &&
              this.activeUnit.equipmentBonusState &&
              !this.activeUnit.equipmentBonusState.firstKillUsed) {
            this.activeUnit.equipmentBonusState.firstKillUsed = true;
            applyHealing(this.activeUnit, 2);
            this.showDamageNumber(this.activeUnit, 2, true);
            this.addCombatLogMessage(`${this.activeUnit.name}'s Bloodstone heals 2 HP!`);
            resultLines.push(`${this.activeUnit.name}'s Bloodstone heals 2 HP!`);
          }

          this.handleUnitDefeated(target);
        }
      } else {
        resultLines.push(`MISS!`);
        this.showMissIndicator(target);

        // Award attempt XP for free attacks even on miss
        if (shouldTrackXP && ability.cost === 0) {
          this.xpTracker.awardDamageXP(this.activeUnit.dataId, 0);
        }
      }

      // Combat log
      this.addCombatLogMessage(`${this.activeUnit.name} → ${ability.name} → ${target.name}`);
      this.addCombatLogMessage(`  ATK: ${rollTotal} vs DEF ${result.targetNumber} - ${result.hit ? 'HIT' : 'MISS'}`);

    } else if (ability.type === 'spell' && ability.targetType === 'enemy') {
      // Wardstone: +2 RES on first save of battle (for defender)
      let wardstoneBonus = 0;
      if (target.equipment === 'wardstone' &&
          target.equipmentBonusState &&
          !target.equipmentBonusState.firstSaveUsed) {
        wardstoneBonus = 2;
        target.resilience += 2;
        target.equipmentBonusState.firstSaveUsed = true;
        this.addCombatLogMessage(`${target.name}'s Wardstone grants +2 RES!`);
      }

      const result = resolveSpell(this.activeUnit, target, ability);

      // Restore resilience if bonus was applied
      if (wardstoneBonus > 0) {
        target.resilience -= wardstoneBonus;
      }

      resultLines.push(`${this.activeUnit.name} casts ${ability.name}!`);

      // Award XP for resource spent (paid abilities) - regardless of outcome
      if (shouldTrackXP && ability.cost > 0) {
        this.xpTracker.awardResourceXP(this.activeUnit.dataId, ability.cost, ability.name);
      }

      if (result.saveRoll.dice !== 'none') {
        const saveTotal = result.saveRoll.finalTotal || result.saveRoll.total;
        const bonusText = wardstoneBonus > 0 ? ` (+${wardstoneBonus})` : '';
        resultLines.push(`${target.name} rolls ${result.saveRoll.rolls[0]} + ${target.resilience + wardstoneBonus}${bonusText} = ${saveTotal} vs MAG ${result.targetNumber}`);
        resultLines.push(result.savePassed ? 'Save PASSED!' : 'Save FAILED!');
      }

      if (result.damageRoll && result.totalDamage !== undefined && result.totalDamage > 0) {
        // Indicate if damage was halved by a successful save
        const fullDamage = result.damageRoll.finalTotal || result.damageRoll.total;
        if (result.savePassed && ability.damageOnSave === 'half' && result.totalDamage < fullDamage) {
          resultLines.push(`${result.totalDamage} damage (halved) to ${target.name}!`);
        } else {
          resultLines.push(`${result.totalDamage} damage to ${target.name}!`);
        }
        this.showDamageNumber(target, result.totalDamage, false);
        this.trackDamage(result.totalDamage, true);

        // Award damage XP only for free spells (0 cost)
        if (shouldTrackXP && ability.cost === 0) {
          this.xpTracker.awardDamageXP(this.activeUnit.dataId, result.totalDamage);
        }
      } else if (result.damageRoll && shouldTrackXP && ability.cost === 0) {
        // Award attempt XP for free spells even when damage is 0 (enemy saved)
        this.xpTracker.awardDamageXP(this.activeUnit.dataId, 0);
      }

      if (result.effectApplied) {
        resultLines.push(`${target.name} is ${result.effectApplied.type}!`);
        // No separate debuff XP - already covered by resource XP if ability costs mana
        // Update condition markers to show new effect
        updateConditionMarkers(target, this);
      }

      if (result.targetDefeated) {
        resultLines.push(`${target.name} is DEFEATED!`);
        if (shouldTrackXP) {
          this.xpTracker.awardKillXP(this.activeUnit.dataId, target.name);
        }

        // Bloodstone: heal 2 HP on first kill
        if (this.activeUnit.equipment === 'bloodstone' &&
            this.activeUnit.equipmentBonusState &&
            !this.activeUnit.equipmentBonusState.firstKillUsed) {
          this.activeUnit.equipmentBonusState.firstKillUsed = true;
          applyHealing(this.activeUnit, 2);
          this.showDamageNumber(this.activeUnit, 2, true);
          this.addCombatLogMessage(`${this.activeUnit.name}'s Bloodstone heals 2 HP!`);
          resultLines.push(`${this.activeUnit.name}'s Bloodstone heals 2 HP!`);
        }

        this.handleUnitDefeated(target);
      }

      // Combat log
      this.addCombatLogMessage(`${this.activeUnit.name} → ${ability.name} → ${target.name}`);

    } else if (ability.type === 'buff' || ability.targetType === 'ally') {
      const result = resolveHeal(this.activeUnit, target, ability);

      // Healer's Pendant: +1 to first heal of battle
      let healerBonus = 0;
      if (ability.healing &&
          this.activeUnit.equipment === 'healers_pendant' &&
          this.activeUnit.equipmentBonusState &&
          !this.activeUnit.equipmentBonusState.firstHealUsed) {
        healerBonus = 1;
        this.activeUnit.equipmentBonusState.firstHealUsed = true;
        // Apply the extra healing
        applyHealing(target, healerBonus);
        if (result.totalHealing) {
          result.totalHealing += healerBonus;
        }
        this.addCombatLogMessage(`${this.activeUnit.name}'s Healer's Pendant grants +1 healing!`);
      }

      resultLines.push(`${this.activeUnit.name} uses ${ability.name} on ${target.name}!`);

      // Award XP for resource spent (paid abilities) - regardless of outcome
      if (shouldTrackXP && ability.cost > 0) {
        this.xpTracker.awardResourceXP(this.activeUnit.dataId, ability.cost, ability.name);
      }

      if (result.healingRoll && result.totalHealing) {
        const bonusText = healerBonus > 0 ? ` (+${healerBonus})` : '';
        resultLines.push(`Heals ${result.totalHealing}${bonusText} HP!`);
        this.showDamageNumber(target, result.totalHealing, true);
        // No separate healing XP - already covered by resource XP
      }

      if (result.effectApplied) {
        // Check if this was a status removal ability (like Restoration)
        if (ability.effect && (ability.effect as { type: string }).type === 'remove_status') {
          resultLines.push(`Removed ${result.effectApplied.type} from ${target.name}!`);
        } else {
          resultLines.push(`${target.name} gains ${result.effectApplied.type}!`);
        }
        // No separate buff XP - already covered by resource XP
        // Update condition markers to show new buff
        updateConditionMarkers(target, this);
      }

      // Combat log
      this.addCombatLogMessage(`${this.activeUnit.name} → ${ability.name} → ${target.name}`);

    } else if (ability.type === 'toggle' || ability.targetType === 'self') {
      const result = resolveSelfAbility(this.activeUnit, ability);

      resultLines.push(`${this.activeUnit.name} uses ${ability.name}!`);

      // Award XP for resource spent (paid abilities only)
      if (shouldTrackXP && ability.cost > 0) {
        this.xpTracker.awardResourceXP(this.activeUnit.dataId, ability.cost, ability.name);
      }

      if (result.effectApplied) {
        resultLines.push(`${this.activeUnit.name} is now ${result.effectApplied.type}!`);
        // No separate buff XP - already covered by resource XP if paid
        // Update condition markers to show new buff (Rage, Dodge, etc.)
        updateConditionMarkers(this.activeUnit, this);
      }

      // Combat log
      this.addCombatLogMessage(`${this.activeUnit.name} → ${ability.name}`);

    } else if (ability.type === 'debuff') {
      // Wardstone: +2 RES on first save of battle (for defender)
      let wardstoneBonus = 0;
      if (target.equipment === 'wardstone' &&
          target.equipmentBonusState &&
          !target.equipmentBonusState.firstSaveUsed) {
        wardstoneBonus = 2;
        target.resilience += 2;
        target.equipmentBonusState.firstSaveUsed = true;
        this.addCombatLogMessage(`${target.name}'s Wardstone grants +2 RES!`);
      }

      const result = resolveSpell(this.activeUnit, target, ability);

      // Restore resilience if bonus was applied
      if (wardstoneBonus > 0) {
        target.resilience -= wardstoneBonus;
      }

      resultLines.push(`${this.activeUnit.name} uses ${ability.name} on ${target.name}!`);

      // Award XP for resource spent (paid abilities only)
      if (shouldTrackXP && ability.cost > 0) {
        this.xpTracker.awardResourceXP(this.activeUnit.dataId, ability.cost, ability.name);
      }

      if (result.effectApplied) {
        resultLines.push(`${target.name} is ${result.effectApplied.type}!`);
        // No separate debuff XP - already covered by resource XP if paid
        // Update condition markers to show new debuff
        updateConditionMarkers(target, this);
      }

      // Combat log
      this.addCombatLogMessage(`${this.activeUnit.name} → ${ability.name} → ${target.name}`);
    }

    // Calculate XP earned this action
    const xpAfter = shouldTrackXP
      ? this.xpTracker.getBattleXP(this.activeUnit.dataId)
      : 0;
    this.currentActionXP = xpAfter - xpBefore;

    // Mark that this hero has earned XP this turn (prevents double XP from Hide+Attack)
    if (shouldTrackXP && this.currentActionXP > 0) {
      this.hasEarnedXPThisTurn = true;
    }

    // Mark as having acted
    this.activeUnit.actionsRemaining--;
    if (this.activeUnit.actionsRemaining <= 0) {
      this.activeUnit.hasActed = true;
    }

    // Store values for the callback chain
    const heroName = this.activeUnit.name;
    const isHero = this.activeUnit.team === 'hero';
    const hasMoreActions = this.activeUnit && this.activeUnit.actionsRemaining > 0;
    const xpEarned = this.currentActionXP;

    // Show action result panel, then XP panel, then continue
    this.showActionResultPanel(resultLines, () => {
      // Show XP panel if hero earned XP
      if (isHero && xpEarned > 0) {
        this.showXPPanel(heroName, xpEarned, () => {
          this.finishAbilityExecution(hasMoreActions);
        });
      } else {
        this.finishAbilityExecution(hasMoreActions);
      }
    });
  }

  /**
   * Complete ability execution after panels are dismissed
   */
  private finishAbilityExecution(hasMoreActions: boolean): void {
    this.checkBattleEnd();

    if (this.phase !== 'victory' && this.phase !== 'defeat') {
      if (hasMoreActions) {
        // Unit has more actions - show menu immediately
        this.showActionMenu();
      } else {
        // Turn is ending - advance to next turn
        this.endCurrentTurn();
      }
    }
  }

  /**
   * Face the target before attacking
   */
  private faceTarget(unit: Unit, target: Unit): void {
    const dx = target.gridX - unit.gridX;
    const dy = target.gridY - unit.gridY;

    let spriteDir = 'front';

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) {
        unit.facing = 'east';
        spriteDir = 'right';
      } else {
        unit.facing = 'west';
        spriteDir = 'left';
      }
    } else {
      if (dy > 0) {
        unit.facing = 'south';
        spriteDir = 'front';
      } else {
        unit.facing = 'north';
        spriteDir = 'back';
      }
    }

    if (unit.sprite) {
      const heroData = this.heroesData[unit.dataId];
      const enemyData = this.enemiesData[unit.dataId];
      const baseSprite = heroData?.sprite || enemyData?.sprite || `sprite_${unit.dataId}`;
      unit.sprite.setTexture(`${baseSprite}_${spriteDir}`);
    }
  }

  /**
   * Show damage number floating up from unit
   */
  private showDamageNumber(target: Unit, amount: number, isHealing: boolean): void {
    const pixelPos = this.gridManager.gridToPixel(target.gridX, target.gridY);
    const color = isHealing ? '#44ff44' : '#ff4444';
    const prefix = isHealing ? '+' : '-';

    const damageText = this.add.text(pixelPos.x, pixelPos.y - 20, `${prefix}${amount}`, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
    damageText.setDepth(900);

    // Animate floating up and fading
    this.tweens.add({
      targets: damageText,
      y: pixelPos.y - 60,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => damageText.destroy(),
    });
  }

  /**
   * Show miss indicator
   */
  private showMissIndicator(target: Unit): void {
    const pixelPos = this.gridManager.gridToPixel(target.gridX, target.gridY);

    const missText = this.add.text(pixelPos.x, pixelPos.y - 20, 'MISS', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#888888',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setResolution(GAME_CONFIG.TEXT_RESOLUTION).setOrigin(0.5);
    missText.setDepth(900);

    this.tweens.add({
      targets: missText,
      y: pixelPos.y - 50,
      alpha: 0,
      duration: 800,
      onComplete: () => missText.destroy(),
    });
  }

  /**
   * Handle unit being defeated
   */
  private handleUnitDefeated(unit: Unit): void {
    if (unit.sprite) {
      // Rotate sprite to show defeat
      unit.sprite.setAngle(90);
      unit.sprite.setAlpha(0.5);
    }

    // Track enemy defeats for battle summary
    if (unit.team === 'enemy') {
      this.battleStats.enemiesDefeated++;
    }
  }

  /**
   * Track damage for battle summary
   */
  private trackDamage(damage: number, isDealtByHero: boolean): void {
    if (isDealtByHero) {
      this.battleStats.totalDamageDealt += damage;
    } else {
      this.battleStats.totalDamageTaken += damage;
    }
  }

  /**
   * Check for battle end conditions
   */
  private checkBattleEnd(): void {
    const allEnemiesDefeated = this.enemyUnits.every((u) => u.isUnconscious);
    const allHeroesDefeated = this.heroUnits.every((u) => u.isUnconscious);

    if (allEnemiesDefeated) {
      this.handleVictory();
    } else if (allHeroesDefeated) {
      this.handleDefeat();
    }
  }

  // ============================================
  // Click-to-Advance System
  // ============================================

  /**
   * Wait for user input before continuing (Shining Force style)
   */
  private waitForAdvance(callback: () => void): void {
    this.waitingForAdvance = true;
    this.pendingAdvanceCallback = callback;
  }

  /**
   * Handle the advance input when waiting
   */
  private handleAdvance(): void {
    if (!this.waitingForAdvance || !this.pendingAdvanceCallback) return;

    const callback = this.pendingAdvanceCallback;
    this.waitingForAdvance = false;
    this.pendingAdvanceCallback = null;

    callback();
  }

  // Clean up when scene is shut down
  shutdown(): void {
    // Clear unit references
    this.units.forEach((unit) => {
      if (unit.sprite) {
        unit.sprite.destroy();
      }
      if (unit.hpBarContainer) {
        unit.hpBarContainer.destroy();
      }
      if (unit.conditionMarkerContainer) {
        unit.conditionMarkerContainer.destroy();
      }
    });
    this.units = [];
    this.heroUnits = [];
    this.enemyUnits = [];
    this.selectedUnit = null;
    this.movementTiles = [];
    this.isInMovementMode = false;

    // Clear action menu
    if (this.actionMenuContainer) {
      this.actionMenuContainer.destroy();
      this.actionMenuContainer = null;
    }
    this.showingActionMenu = false;

    // Clear targeting
    this.isTargeting = false;
    this.validTargets = [];

    // Clear AOE targeting
    this.isAOETargeting = false;
    this.validAOETiles = [];

    // Clear graphics
    if (this.cursorGraphics) this.cursorGraphics.clear();
    if (this.pathPreviewGraphics) this.pathPreviewGraphics.clear();
    if (this.targetHighlightGraphics) this.targetHighlightGraphics.clear();
  }

  // ==========================================================================
  // Treasure Chest System (Phase 10 - Loot)
  // ==========================================================================

  /**
   * Spawn treasure chests for this battle map
   */
  private spawnExplorationChests(): void {
    // Don't double-spawn if already created
    if (this.explorationChests.length > 0) return;

    const chests = this.battleConfig.chests;
    if (!chests || chests.length === 0) return;

    for (const chest of chests) {
      // Check if chest was already opened
      const chestState = this.chestStates[chest.id];
      const isOpened = chestState?.opened ?? false;

      // Convert grid position to pixel position
      const pixelX = chest.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const pixelY = chest.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

      // Determine sprite based on facing direction (default: south/front)
      const facingToSprite: Record<string, string> = {
        north: 'sprite_chest_closed_back',
        south: 'sprite_chest_closed_front',
        east: 'sprite_chest_closed_right',
        west: 'sprite_chest_closed_left',
      };
      const facing = chest.facing || 'south';
      const spriteKey = facingToSprite[facing] || 'sprite_chest_closed_front';

      // Create chest sprite
      const chestSprite = this.add.sprite(pixelX, pixelY, spriteKey);
      chestSprite.setOrigin(0.5, 0.5);

      // Scale to fit grid (chest sprite is 256x256, tile is 32x32)
      const scale = GAME_CONFIG.TILE_SIZE / 256;
      chestSprite.setScale(scale);

      // Set depth for chests (hero sprite will be set higher in exploration mode)
      chestSprite.setDepth(5);

      // If already opened, make it semi-transparent
      if (isOpened) {
        chestSprite.setAlpha(0.4);
      }

      // Make UI camera ignore this sprite
      this.uiCamera.ignore(chestSprite);

      this.explorationChests.push({
        sprite: chestSprite,
        id: chest.id,
        gridX: chest.x,
        gridY: chest.y,
        opened: isOpened,
      });
    }
  }

  /**
   * Check if player is adjacent to any unopened chest
   */
  private getAdjacentChest(): { sprite: Phaser.GameObjects.Sprite; id: string; gridX: number; gridY: number; opened: boolean } | null {
    if (!this.explorationLeader) return null;

    for (const chest of this.explorationChests) {
      if (chest.opened) continue;

      const dx = Math.abs(this.explorationLeader.gridX - chest.gridX);
      const dy = Math.abs(this.explorationLeader.gridY - chest.gridY);

      // Adjacent means within 1 tile (including diagonals)
      if (dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0)) {
        return chest;
      }
    }

    return null;
  }

  /**
   * Handle chest interaction
   */
  private handleChestInteraction(): void {
    if (this.lootPopupActive) return;

    const chest = this.getAdjacentChest();
    if (!chest) return;

    // Open the chest via LootManager
    const loot = this.lootManager.openChest(chest.id);
    if (!loot) {
      console.warn('Failed to generate loot for chest:', chest.id);
      return;
    }

    // Mark chest as opened
    chest.opened = true;
    chest.sprite.setAlpha(0.4);

    // Update chest states for saving
    this.chestStates = this.lootManager.getChestStates();

    // Update inventory from manager
    this.inventory = this.inventoryManager.getInventory();

    // Show loot popup
    this.showLootPopup(loot.item.name, loot.item.description, loot.item.rarity);
  }

  /**
   * Show loot popup UI
   */
  private showLootPopup(itemName: string, itemDescription: string, rarity: string): void {
    this.lootPopupActive = true;

    // Create popup container
    const centerX = GAME_CONFIG.WIDTH / 2;
    const centerY = GAME_CONFIG.HEIGHT / 2;

    this.lootPopupContainer = this.add.container(centerX, centerY);

    // Background
    const bg = this.add.rectangle(0, 0, 320, 180, 0x1a1a2e, 0.95);
    bg.setStrokeStyle(3, LootManager.getRarityColor(rarity));

    // Title
    const title = this.add.text(0, -60, 'TREASURE FOUND!', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffd700',
    });
    title.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    title.setOrigin(0.5, 0.5);

    // Item name with rarity color
    const rarityHex = '#' + LootManager.getRarityColor(rarity).toString(16).padStart(6, '0');
    const nameText = this.add.text(0, -20, itemName, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: rarityHex,
    });
    nameText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    nameText.setOrigin(0.5, 0.5);

    // Item description
    const descText = this.add.text(0, 20, itemDescription, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#cccccc',
      wordWrap: { width: 280 },
      align: 'center',
    });
    descText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    descText.setOrigin(0.5, 0.5);

    // Continue prompt
    const continueText = this.add.text(0, 65, '[Press ENTER]', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
    });
    continueText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    continueText.setOrigin(0.5, 0.5);

    this.lootPopupContainer.add([bg, title, nameText, descText, continueText]);

    // Make sure popup is on UI layer only (not duplicated on main camera)
    this.lootPopupContainer.setScrollFactor(0);
    this.lootPopupContainer.setDepth(1000);
    this.cameras.main.ignore(this.lootPopupContainer);
  }

  /**
   * Hide loot popup
   */
  private hideLootPopup(): void {
    if (this.lootPopupContainer) {
      this.lootPopupContainer.destroy();
      this.lootPopupContainer = null;
    }
    this.lootPopupActive = false;
  }

  /**
   * Show "To Be Continued" screen after victory
   */
  private showToBeContinued(): void {
    // Clear all battle UI
    this.clearBattleElements();

    // Create a dark overlay
    const overlay = this.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      GAME_CONFIG.WIDTH,
      GAME_CONFIG.HEIGHT,
      0x000000,
      0.7
    );
    overlay.setScrollFactor(0);
    overlay.setDepth(100);
    this.cameras.main.ignore(overlay);

    // Add "TO BE CONTINUED" text
    const toBeContinuedText = this.add.text(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      'TO BE CONTINUED',
      {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#ffffff',
        align: 'center',
      }
    );
    toBeContinuedText.setOrigin(0.5, 0.5);
    toBeContinuedText.setScrollFactor(0);
    toBeContinuedText.setDepth(101);
    toBeContinuedText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.cameras.main.ignore(toBeContinuedText);

    // Fade in effect
    toBeContinuedText.setAlpha(0);
    this.tweens.add({
      targets: toBeContinuedText,
      alpha: 1,
      duration: 2000,
      ease: 'Power2',
    });

    // Add instruction text after a delay
    this.time.delayedCall(2500, () => {
      const instructionText = this.add.text(
        GAME_CONFIG.WIDTH / 2,
        GAME_CONFIG.HEIGHT / 2 + 80,
        'Press ENTER to return to title',
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#aaaaaa',
          align: 'center',
        }
      );
      instructionText.setOrigin(0.5, 0.5);
      instructionText.setScrollFactor(0);
      instructionText.setDepth(101);
      instructionText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.cameras.main.ignore(instructionText);

      // Wait for ENTER to return to title
      this.waitForAdvance(() => {
        this.scene.start('TitleScene');
      });
    });
  }
}
