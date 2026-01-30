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
  type: 'battle' | 'blocked' | 'explore' | 'underground' | 'proximity_battle';
  battleMap?: string;
  exploreMap?: string;
  targetScene?: string;
  proximityDistance?: number;
  battleIntro?: string[];
  postBattleExploreMap?: string;
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
    type: 'battle' | 'blocked' | 'explore' | 'underground' | 'proximity_battle';
    description: string[];
    battleMap?: string;
    exploreMap?: string;
    targetScene?: string;
    proximityDistance?: number;
    battleIntro?: string[];
    postBattleExploreMap?: string;
  }>;
}

/**
 * Sparkworks District - The main overworld/point crawl map
 * Players can freely move between locations in the Sparkworks district
 */
export class SparkworksScene extends Phaser.Scene {
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

  // Menu scene (ESC key)
  private escKey!: Phaser.Input.Keyboard.Key;

  // Level up overlay
  private levelUpOverlay: LevelUpOverlay | null = null;

  private readonly GRID_SIZE = 24;

  // Calculate tile dimensions based on scaled map size
  private get tileWidth(): number {
    return this.mapImage?.displayWidth / this.GRID_SIZE || 32;
  }
  private get tileHeight(): number {
    return this.mapImage?.displayHeight / this.GRID_SIZE || 32;
  }

  constructor() {
    super({ key: 'SparkworksScene' });
  }

  shutdown(): void {
    // Stop camera follow before scene transitions to prevent drift bug in BattleScene
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
  }): void {
    // Get passed data
    this.heroId = data.heroId || 'arden';
    this.heroState = data.heroState || {};
    this.gameFlags = data.gameFlags || {};
    this.playTime = data.playTime || 0;
    this.inventory = data.inventory || createDefaultInventory();
    this.chestStates = data.chests || {};
    this.devMode = data.devMode || false;

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
    this.mapData = this.cache.json.get('data_map_sparkworks');
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

    // Load the travel map as background at 75% scale (gives 24x24 grid at 32px tiles)
    this.mapImage = this.add.image(0, 0, 'map_sparkworks');
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(0.75);

    // Draw 24x24 grid overlay
    this.drawGridOverlay();

    // Place location markers (pulsing dots)
    this.placeLocationMarkers();

    // Create player sprite
    this.createPlayer();

    // Setup camera to follow player (use displayWidth for scaled size)
    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    console.log(`Sparkworks map dimensions (scaled): ${mapWidth} x ${mapHeight}`);

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
  }

  /**
   * Show level-up screen for heroes who leveled up after battle
   */
  private showLevelUpScreen(levelUps: BattleXPSummary[]): void {
    this.isInDialogue = true;

    // Create and show the level up overlay
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

  private drawGridOverlay(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, GAME_CONFIG.GRID_COLOR, GAME_CONFIG.GRID_ALPHA * 0.5);

    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;

    // Draw vertical lines
    for (let x = 0; x <= this.GRID_SIZE; x++) {
      const pixelX = x * this.tileWidth;
      graphics.moveTo(pixelX, 0);
      graphics.lineTo(pixelX, mapHeight);
    }

    // Draw horizontal lines
    for (let y = 0; y <= this.GRID_SIZE; y++) {
      const pixelY = y * this.tileHeight;
      graphics.moveTo(0, pixelY);
      graphics.lineTo(mapWidth, pixelY);
    }

    graphics.strokePath();
  }

  private placeLocationMarkers(): void {
    const cornerLength = 8;
    const halfTileW = this.tileWidth / 2;
    const halfTileH = this.tileHeight / 2;

    // Dev mode: bright yellow for visibility
    // Player mode: light gray with grow/shrink animation
    const color = this.devMode ? 0xffff00 : 0xb0b0b0;
    const alpha = this.devMode ? 0.9 : 0.85;

    this.mapData.locations.forEach(locationInfo => {
      const pixelX = locationInfo.markerPosition.x * this.tileWidth + this.tileWidth / 2;
      const pixelY = locationInfo.markerPosition.y * this.tileHeight + this.tileHeight / 2;

      // Create a container for the marker
      const container = this.add.container(pixelX, pixelY);

      // Create corner bracket graphics (like Ishetar triggers)
      const graphics = this.add.graphics();
      graphics.lineStyle(2, color, alpha);

      // Draw corner brackets relative to center (-halfTile to +halfTile)
      // Top-left corner
      graphics.moveTo(-halfTileW, -halfTileH + cornerLength);
      graphics.lineTo(-halfTileW, -halfTileH);
      graphics.lineTo(-halfTileW + cornerLength, -halfTileH);
      // Top-right corner
      graphics.moveTo(halfTileW - cornerLength, -halfTileH);
      graphics.lineTo(halfTileW, -halfTileH);
      graphics.lineTo(halfTileW, -halfTileH + cornerLength);
      // Bottom-right corner
      graphics.moveTo(halfTileW, halfTileH - cornerLength);
      graphics.lineTo(halfTileW, halfTileH);
      graphics.lineTo(halfTileW - cornerLength, halfTileH);
      // Bottom-left corner
      graphics.moveTo(-halfTileW + cornerLength, halfTileH);
      graphics.lineTo(-halfTileW, halfTileH);
      graphics.lineTo(-halfTileW, halfTileH - cornerLength);

      graphics.strokePath();
      container.add(graphics);

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

      // Name label below marker (avoids edge cutoff)
      const label = this.add.text(0, halfTileH + 12, locationInfo.name, {
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
        proximityDistance: locationInfo.proximityDistance,
        battleIntro: locationInfo.battleIntro,
        postBattleExploreMap: locationInfo.postBattleExploreMap,
      });
    });
  }

  private createPlayer(): void {
    const pixelX = this.playerGridX * this.tileWidth + this.tileWidth / 2;
    const pixelY = this.playerGridY * this.tileHeight + this.tileHeight / 2;

    this.player = this.add.sprite(pixelX, pixelY, `sprite_${this.heroId}_front`);
    // Scale sprite to match tile size
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
    // Out of bounds check
    if (gridX < 0 || gridX >= this.mapGridWidth) return false;
    if (gridY < 0 || gridY >= this.mapGridHeight) return false;

    // Check terrain (0 = walkable, 1 = difficult but passable, 2 = impassable)
    const terrainValue = this.terrain[gridY]?.[gridX];
    if (terrainValue === 2) return false;

    return true;
  }

  private movePlayer(dx: number, dy: number): void {
    if (this.isMoving || this.isInDialogue) return;

    const newGridX = this.playerGridX + dx;
    const newGridY = this.playerGridY + dy;

    // Update facing direction
    if (dx > 0) this.playerFacing = 'right';
    else if (dx < 0) this.playerFacing = 'left';
    else if (dy > 0) this.playerFacing = 'front';
    else if (dy < 0) this.playerFacing = 'back';

    this.updatePlayerSprite();

    // Check if destination is passable
    if (!this.isPassable(newGridX, newGridY)) return;

    // Check if trying to step on a blocked location's marker position
    const blockedLocation = this.locations.find(
      loc => loc.type === 'blocked' &&
             loc.markerPosition.x === newGridX &&
             loc.markerPosition.y === newGridY
    );
    if (blockedLocation) {
      // Show warning dialogue and don't move
      if (!this.shownBlockedDialogue.has(blockedLocation.id)) {
        this.shownBlockedDialogue.add(blockedLocation.id);
        this.isInDialogue = true;
        this.dialogueRenderer.startDialogue(
          blockedLocation.description,
          blockedLocation.name,
          () => {
            this.isInDialogue = false;
          }
        );
      }
      return;
    }

    // Move the player
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
        this.checkLocationProximity();
      },
    });
  }

  private checkLocationProximity(): void {
    // Check if player is within any location's bounds
    const location = this.getLocationAtPosition(this.playerGridX, this.playerGridY);

    if (location && location.type !== 'blocked' && location.type !== 'proximity_battle') {
      this.promptLocationInteraction(location);
      return;
    }

    // Check for proximity battle triggers
    this.checkProximityBattleTriggers();
  }

  private getDistanceToLocation(location: LocationMarker): number {
    const dx = this.playerGridX - location.markerPosition.x;
    const dy = this.playerGridY - location.markerPosition.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private checkProximityBattleTriggers(): void {
    for (const location of this.locations) {
      if (location.type === 'proximity_battle' && location.proximityDistance) {
        const battleCompleteFlag = `${location.battleMap}_battle_complete`;
        const isBattleComplete = this.gameFlags[battleCompleteFlag];

        if (isBattleComplete && location.postBattleExploreMap) {
          // Battle is done - only trigger exploration when on the exact marker position
          if (this.playerGridX === location.markerPosition.x &&
              this.playerGridY === location.markerPosition.y) {
            this.enterPostBattleExplore(location);
            return;
          }
        } else if (!isBattleComplete) {
          // Battle not complete - trigger from proximity distance (for ambush)
          const distance = this.getDistanceToLocation(location);
          if (distance <= location.proximityDistance) {
            this.triggerProximityBattle(location);
            return;
          }
        }
        // If battle is complete but no postBattleExploreMap, do nothing
      }
    }
  }

  private triggerProximityBattle(location: LocationMarker): void {
    this.isInDialogue = true;

    // Show battle intro dialogue if available
    const introLines = location.battleIntro || location.description;

    this.dialogueRenderer.startDialogue(
      introLines,
      'Narrator',
      () => {
        // Start the battle
        if (location.battleMap) {
          this.scene.start('BattleScene', {
            battleMap: location.battleMap,
            heroId: this.heroId,
            heroState: this.heroState,
            gameFlags: this.gameFlags,
            playTime: this.playTime,
            returnScene: 'SparkworksScene',
            returnPosition: { x: this.playerGridX, y: this.playerGridY },
            inventory: this.inventory,
            chests: this.chestStates,
            devMode: this.devMode,
          });
        }
      }
    );
  }

  private enterPostBattleExplore(location: LocationMarker): void {
    // Load the post-battle exploration scene
    this.scene.start('BattleScene', {
      battleMap: location.postBattleExploreMap,
      heroId: this.heroId,
      heroState: this.heroState,
      gameFlags: this.gameFlags,
      playTime: this.playTime,
      returnScene: 'SparkworksScene',
      returnPosition: { x: this.playerGridX, y: this.playerGridY },
      inventory: this.inventory,
      chests: this.chestStates,
      devMode: this.devMode,
    });
  }

  private promptLocationInteraction(location: LocationMarker): void {
    this.isInDialogue = true;

    // Show location description first
    this.dialogueRenderer.startDialogue(
      location.description,
      location.name,
      () => {
        // Go straight to the location after dialogue (no choice menu)
        this.travelToLocation(location);
      }
    );
  }

  private travelToLocation(location: LocationMarker): void {
    if (location.type === 'underground' && location.targetScene) {
      // Transition to underground scene
      this.scene.start(location.targetScene, {
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
        returnPosition: { x: this.playerGridX, y: this.playerGridY },
      });
    } else if (location.type === 'battle' && location.battleMap) {
      // Transition to battle
      this.scene.start('BattleScene', {
        battleMap: location.battleMap,
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        returnScene: 'SparkworksScene',
        returnPosition: { x: this.playerGridX, y: this.playerGridY },
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    } else if (location.type === 'explore' && location.exploreMap) {
      // Transition to explore scene (no combat)
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

    // Check if standing within a location
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
    // Handle level up overlay input
    if (this.levelUpOverlay && this.levelUpOverlay.isWaitingForInput()) {
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.levelUpOverlay.handleInput();
      }
      return; // Block other input while overlay is active
    }

    // Handle ESC key to open menu
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.pause();
      this.scene.launch('MenuScene', {
        heroState: this.heroState,
        returnScene: 'SparkworksScene',
        inventory: this.inventory,
      });
      return;
    }

    // Handle choice menu input
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
