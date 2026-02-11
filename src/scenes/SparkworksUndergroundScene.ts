import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { DialogueRenderer } from '../systems/DialogueRenderer';
import { HeroState } from '../systems/SaveManager';
import { BattleXPSummary } from '../systems/XPTracker';
import { LevelUpOverlay } from '../components/LevelUpOverlay';
import { InventoryState, ChestState, createDefaultInventory } from '../data/ItemTypes';

interface LocationBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface LocationMarker {
  id: string;
  name: string;
  bounds: LocationBounds;
  markerPosition: { x: number; y: number };
  sprite: Phaser.GameObjects.Container;
  description: string[];
  type: 'battle' | 'blocked' | 'explore' | 'surface';
  battleMap?: string;
  exploreMap?: string;
  targetScene?: string;
}

interface TravelMapData {
  id: string;
  displayName: string;
  gridWidth: number;
  gridHeight: number;
  terrain: number[][];
  playerStart: { x: number; y: number };
  locations: Array<{
    id: string;
    name: string;
    bounds: LocationBounds;
    markerPosition: { x: number; y: number };
    type: 'battle' | 'blocked' | 'explore' | 'surface';
    description: string[];
    battleMap?: string;
    exploreMap?: string;
    targetScene?: string;
  }>;
}

/**
 * Sparkworks Underground - The underground tunnels beneath Sparkworks
 * A secondary point crawl map with 4-6 locations
 */
export class SparkworksUndergroundScene extends Phaser.Scene {
  private mapImage!: Phaser.GameObjects.Image;
  private player!: Phaser.GameObjects.Sprite;
  private playerGridX: number = 10;
  private playerGridY: number = 10;
  private playerFacing: 'front' | 'back' | 'left' | 'right' = 'front';
  private heroId: string = 'arden';

  private locations: LocationMarker[] = [];
  private dialogueRenderer!: DialogueRenderer;
  private isInDialogue: boolean = false;

  // Track which blocked locations have shown their dialogue this session
  private shownBlockedDialogue: Set<string> = new Set();

  // Choice menu state
  private choiceMenuContainer!: Phaser.GameObjects.Container;
  private choiceMenuVisible: boolean = false;
  private choiceMenuOptions: string[] = [];
  private choiceMenuSelectedIndex: number = 0;
  private choiceMenuTexts: Phaser.GameObjects.Text[] = [];
  private choiceMenuCallback?: (choice: string) => void;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private isMoving: boolean = false;

  // Map data
  private mapData!: TravelMapData;
  private terrain: number[][] = [];
  private mapGridWidth: number = 20;
  private mapGridHeight: number = 20;

  // Game state
  private heroState: Record<string, HeroState> = {};
  private gameFlags: Record<string, boolean> = {};
  private playTime: number = 0;
  private inventory: InventoryState = createDefaultInventory();
  private chestStates: Record<string, ChestState> = {};
  private devMode: boolean = false;
  private returnPosition?: { x: number; y: number };

  // Menu scene (ESC key)
  private escKey!: Phaser.Input.Keyboard.Key;

  // Level up overlay
  private levelUpOverlay: LevelUpOverlay | null = null;

  // Congratulations message
  private hasShownCongrats: boolean = false;

  private readonly GRID_SIZE = 24;

  // Calculate tile dimensions based on scaled map size
  private get tileWidth(): number {
    return this.mapImage?.displayWidth / this.GRID_SIZE || 32;
  }
  private get tileHeight(): number {
    return this.mapImage?.displayHeight / this.GRID_SIZE || 32;
  }

  constructor() {
    super({ key: 'SparkworksUndergroundScene' });
  }

  shutdown(): void {
    this.cameras.main.stopFollow();
  }

  create(data: {
    heroId?: string;
    heroState?: Record<string, HeroState>;
    gameFlags?: Record<string, boolean>;
    playTime?: number;
    playerPosition?: { x: number; y: number };
    levelUps?: BattleXPSummary[];
    inventory?: InventoryState;
    chests?: Record<string, ChestState>;
    devMode?: boolean;
    returnPosition?: { x: number; y: number };
  }): void {
    // Get passed data
    this.heroId = data.heroId || 'arden';
    this.heroState = data.heroState || {};
    this.gameFlags = data.gameFlags || {};
    this.playTime = data.playTime || 0;
    this.inventory = data.inventory || createDefaultInventory();
    this.chestStates = data.chests || {};
    this.devMode = data.devMode || false;
    this.returnPosition = data.returnPosition;

    // Reset state
    this.shownBlockedDialogue.clear();
    this.locations = [];
    this.isInDialogue = false;
    this.isMoving = false;
    this.choiceMenuVisible = false;

    // Start travel/exploration music (stop any previous music first)
    this.sound.stopAll();
    this.sound.play('music_travel', { loop: true, volume: 0.5 });

    // Load map data from cache
    this.mapData = this.cache.json.get('data_map_sparkworks_underground');
    this.terrain = this.mapData.terrain;
    this.mapGridWidth = this.mapData.gridWidth;
    this.mapGridHeight = this.mapData.gridHeight;

    // Set player start position
    if (data.playerPosition) {
      this.playerGridX = data.playerPosition.x;
      this.playerGridY = data.playerPosition.y;
    } else {
      this.playerGridX = this.mapData.playerStart.x;
      this.playerGridY = this.mapData.playerStart.y;
    }

    // Load the underground map as background at 50% scale
    this.mapImage = this.add.image(0, 0, 'map_sparkworks_underground');
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(0.5);

    // Draw 24x24 grid overlay
    this.drawGridOverlay();

    // Place location markers (pulsing dots)
    this.placeLocationMarkers();

    // Create player sprite
    this.createPlayer();

    // Setup camera to follow player
    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    console.log(`Underground map dimensions (scaled): ${mapWidth} x ${mapHeight}`);

    // Setup input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // Create dialogue renderer
    this.dialogueRenderer = new DialogueRenderer(this);
    this.dialogueRenderer.setScrollFactor(0);

    // Create choice menu (hidden initially)
    this.createChoiceMenu();

    // Setup ESC key for menu
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // Show level-up screen if returning from battle with level ups
    if (data.levelUps && data.levelUps.length > 0) {
      this.time.delayedCall(100, () => {
        this.showLevelUpScreen(data.levelUps!);
      });
    }

    // Show congratulations message on first visit
    if (!this.gameFlags['sparkworks_tutorial_complete']) {
      this.time.delayedCall(500, () => {
        this.showCongratulations();
      });
    }
  }

  private showLevelUpScreen(levelUps: BattleXPSummary[]): void {
    this.isInDialogue = true;
    this.levelUpOverlay = new LevelUpOverlay({
      scene: this,
      levelUps,
      onComplete: () => {
        this.levelUpOverlay = null;
        this.isInDialogue = false;
      },
    });
    this.levelUpOverlay.show();
  }

  private showCongratulations(): void {
    if (this.hasShownCongrats) return;
    this.hasShownCongrats = true;
    this.isInDialogue = true;

    this.gameFlags['sparkworks_tutorial_complete'] = true;

    this.dialogueRenderer.startDialogue(
      [
        'Congratulations on completing the Rifthaven Tutorial!',
        'Thank you for playing!',
        'The tunnels beneath Sparkworks stretch far and wide. Explore the underground to discover what lies ahead.',
        'More content is coming soon. Stay tuned!'
      ],
      'THE END',
      () => {
        this.isInDialogue = false;
      }
    );
  }

  private drawGridOverlay(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, GAME_CONFIG.GRID_COLOR, GAME_CONFIG.GRID_ALPHA * 0.5);

    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;

    for (let x = 0; x <= this.GRID_SIZE; x++) {
      const pixelX = x * this.tileWidth;
      graphics.moveTo(pixelX, 0);
      graphics.lineTo(pixelX, mapHeight);
    }

    for (let y = 0; y <= this.GRID_SIZE; y++) {
      const pixelY = y * this.tileHeight;
      graphics.moveTo(0, pixelY);
      graphics.lineTo(mapWidth, pixelY);
    }

    graphics.strokePath();
  }

  private placeLocationMarkers(): void {
    this.mapData.locations.forEach(locationInfo => {
      const pixelX = locationInfo.markerPosition.x * this.tileWidth + this.tileWidth / 2;
      const pixelY = locationInfo.markerPosition.y * this.tileHeight + this.tileHeight / 2;

      const container = this.add.container(pixelX, pixelY);

      let markerColor = 0x00ff00;
      if (locationInfo.type === 'blocked') {
        markerColor = 0xff0000;
      } else if (locationInfo.type === 'battle') {
        markerColor = 0xffaa00;
      } else if (locationInfo.type === 'explore') {
        markerColor = 0x00ff00;
      } else if (locationInfo.type === 'surface') {
        markerColor = 0x00aaff; // Blue for surface exit
      }

      const marker = this.add.circle(0, 0, 6, markerColor, 0.7);
      const markerOuter = this.add.circle(0, 0, 8, markerColor, 0.3);

      this.tweens.add({
        targets: markerOuter,
        scaleX: 1.3,
        scaleY: 1.3,
        alpha: 0,
        duration: 1000,
        repeat: -1,
        yoyo: false,
        onRepeat: () => {
          markerOuter.setScale(1);
          markerOuter.setAlpha(0.3);
        }
      });

      container.add([markerOuter, marker]);

      const label = this.add.text(0, 28, locationInfo.name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 4, y: 2 },
      });
      label.setOrigin(0.5, 0.5);
      label.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      container.add(label);

      this.locations.push({
        id: locationInfo.id,
        name: locationInfo.name,
        bounds: locationInfo.bounds,
        markerPosition: locationInfo.markerPosition,
        sprite: container,
        description: locationInfo.description,
        type: locationInfo.type,
        battleMap: locationInfo.battleMap,
        exploreMap: locationInfo.exploreMap,
        targetScene: locationInfo.targetScene,
      });
    });
  }

  private createPlayer(): void {
    const pixelX = this.playerGridX * this.tileWidth + this.tileWidth / 2;
    const pixelY = this.playerGridY * this.tileHeight + this.tileHeight / 2;

    this.player = this.add.sprite(pixelX, pixelY, `sprite_${this.heroId}_front`);
    this.player.setScale(this.tileWidth / GAME_CONFIG.SPRITE_SIZE);
  }

  private updatePlayerSprite(): void {
    this.player.setTexture(`sprite_${this.heroId}_${this.playerFacing}`);
  }

  private isWithinBounds(gridX: number, gridY: number, bounds: LocationBounds): boolean {
    return gridX >= bounds.x1 && gridX <= bounds.x2 &&
           gridY >= bounds.y1 && gridY <= bounds.y2;
  }

  private getLocationAtPosition(gridX: number, gridY: number): LocationMarker | undefined {
    return this.locations.find(loc => this.isWithinBounds(gridX, gridY, loc.bounds));
  }

  private isPassable(gridX: number, gridY: number): boolean {
    if (gridX < 0 || gridX >= this.mapGridWidth) return false;
    if (gridY < 0 || gridY >= this.mapGridHeight) return false;

    const terrainValue = this.terrain[gridY]?.[gridX];
    if (terrainValue === 2) return false;

    return true;
  }

  private movePlayer(dx: number, dy: number): void {
    if (this.isMoving || this.isInDialogue) return;

    const newGridX = this.playerGridX + dx;
    const newGridY = this.playerGridY + dy;

    if (dx > 0) this.playerFacing = 'right';
    else if (dx < 0) this.playerFacing = 'left';
    else if (dy > 0) this.playerFacing = 'front';
    else if (dy < 0) this.playerFacing = 'back';

    this.updatePlayerSprite();

    if (!this.isPassable(newGridX, newGridY)) return;

    const targetLocation = this.getLocationAtPosition(newGridX, newGridY);
    if (targetLocation && targetLocation.type === 'blocked') {
      if (!this.shownBlockedDialogue.has(targetLocation.id)) {
        this.shownBlockedDialogue.add(targetLocation.id);
        this.isInDialogue = true;
        this.dialogueRenderer.startDialogue(
          targetLocation.description,
          targetLocation.name,
          () => {
            this.isInDialogue = false;
          }
        );
      }
      return;
    }

    this.isMoving = true;
    this.playerGridX = newGridX;
    this.playerGridY = newGridY;

    const targetX = newGridX * this.tileWidth + this.tileWidth / 2;
    const targetY = newGridY * this.tileHeight + this.tileHeight / 2;

    this.tweens.add({
      targets: this.player,
      x: targetX,
      y: targetY,
      duration: 150,
      ease: 'Linear',
      onComplete: () => {
        this.isMoving = false;
      },
    });
  }

  private promptLocationInteraction(location: LocationMarker): void {
    this.isInDialogue = true;

    // Check if this location has an actual destination
    const hasDestination = location.targetScene || location.battleMap || location.exploreMap;

    this.dialogueRenderer.startDialogue(
      location.description,
      location.name,
      () => {
        if (hasDestination) {
          this.travelToLocation(location);
        } else {
          this.isInDialogue = false;
        }
      }
    );
  }

  private travelToLocation(location: LocationMarker): void {
    if (location.type === 'surface' && location.targetScene) {
      // Use the configured target scene
      const sceneData = {
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
        playerPosition: this.returnPosition,
      };

      if (location.targetScene.startsWith('BattleScene:')) {
        const battleMap = location.targetScene.split(':')[1];
        this.scene.start('BattleScene', {
          ...sceneData,
          battleMap,
        });
      } else {
        this.scene.start(location.targetScene, sceneData);
      }
    } else if (location.type === 'battle' && location.battleMap) {
      this.scene.start('BattleScene', {
        battleMap: location.battleMap,
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        returnScene: 'SparkworksUndergroundScene',
        returnPosition: { x: this.playerGridX, y: this.playerGridY },
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    } else if (location.type === 'explore' && location.exploreMap) {
      this.scene.start('ExploreScene', {
        exploreMap: location.exploreMap,
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    }
  }

  private tryInteract(): void {
    if (this.isInDialogue) {
      this.dialogueRenderer.advance();
      return;
    }

    const location = this.getLocationAtPosition(this.playerGridX, this.playerGridY);

    if (location && location.type !== 'blocked') {
      this.promptLocationInteraction(location);
    }
  }

  private createChoiceMenu(): void {
    this.choiceMenuContainer = this.add.container(0, 0);
    this.choiceMenuContainer.setScrollFactor(0);
    this.choiceMenuContainer.setVisible(false);
    this.choiceMenuContainer.setDepth(1000);
  }

  private updateChoiceMenuSelection(): void {
    this.choiceMenuTexts.forEach((text, index) => {
      if (index === this.choiceMenuSelectedIndex) {
        text.setColor('#ffff00');
        text.setText('> ' + this.choiceMenuOptions[index]);
      } else {
        text.setColor('#ffffff');
        text.setText('  ' + this.choiceMenuOptions[index]);
      }
    });
  }

  private hideChoiceMenu(): void {
    this.choiceMenuContainer.setVisible(false);
    this.choiceMenuVisible = false;
    this.isInDialogue = false;
  }

  private selectChoiceMenuOption(): void {
    const selectedOption = this.choiceMenuOptions[this.choiceMenuSelectedIndex];
    this.hideChoiceMenu();
    if (this.choiceMenuCallback) {
      this.choiceMenuCallback(selectedOption);
    }
  }

  update(): void {
    if (this.levelUpOverlay && this.levelUpOverlay.isWaitingForInput()) {
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.levelUpOverlay.handleInput();
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.pause();
      this.scene.launch('MenuScene', {
        heroState: this.heroState,
        returnScene: 'SparkworksUndergroundScene',
        inventory: this.inventory,
      });
      return;
    }

    if (this.choiceMenuVisible) {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
        this.choiceMenuSelectedIndex = Math.max(0, this.choiceMenuSelectedIndex - 1);
        this.updateChoiceMenuSelection();
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
        this.choiceMenuSelectedIndex = Math.min(
          this.choiceMenuOptions.length - 1,
          this.choiceMenuSelectedIndex + 1
        );
        this.updateChoiceMenuSelection();
      } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectChoiceMenuOption();
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.tryInteract();
    }

    if (!this.isInDialogue && !this.isMoving) {
      if (this.cursors.left.isDown) {
        this.movePlayer(-1, 0);
      } else if (this.cursors.right.isDown) {
        this.movePlayer(1, 0);
      } else if (this.cursors.up.isDown) {
        this.movePlayer(0, -1);
      } else if (this.cursors.down.isDown) {
        this.movePlayer(0, 1);
      }
    }
  }
}
