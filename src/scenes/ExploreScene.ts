import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { HeroState } from '../systems/SaveManager';
import { DialogueRenderer } from '../systems/DialogueRenderer';
import { InventoryState, ChestState, createDefaultInventory } from '../data/ItemTypes';

interface ExploreMapData {
  id: string;
  displayName: string;
  mapImage: string;
  gridWidth: number;
  gridHeight: number;
  mapScale?: number;
  terrain: number[][];
  playerStart: { x: number; y: number };
  exitTrigger: {
    bounds: { x1: number; y1: number; x2: number; y2: number };
    destination: string;
  };
  returnPosition: { x: number; y: number };
}

export class ExploreScene extends Phaser.Scene {
  private mapImage!: Phaser.GameObjects.Image;
  private player!: Phaser.GameObjects.Sprite;
  private playerGridX: number = 0;
  private playerGridY: number = 0;
  private playerFacing: 'front' | 'back' | 'left' | 'right' = 'front';
  private heroId: string = 'vicas';

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private isMoving: boolean = false;

  private mapData!: ExploreMapData;
  private terrain: number[][] = [];
  private mapScale: number = 0.5;

  // Game state passed through
  private heroState: Record<string, HeroState> = {};
  private gameFlags: Record<string, boolean> = {};
  private playTime: number = 0;
  private returnPosition: { x: number; y: number } = { x: 0, y: 0 };
  private inventory: InventoryState = createDefaultInventory();
  private chestStates: Record<string, ChestState> = {};
  private devMode: boolean = false;

  // Post-credits mode
  private isPostCreditsMode: boolean = false;
  private exploreMapId: string = '';

  // Post-credits cutscene
  private dialogueRenderer!: DialogueRenderer;
  private isInDialogue: boolean = false;
  private cutsceneComplete: boolean = false;
  private enterKey!: Phaser.Input.Keyboard.Key;

  private get tileWidth(): number {
    return this.mapImage.displayWidth / this.mapData.gridWidth;
  }
  private get tileHeight(): number {
    return this.mapImage.displayHeight / this.mapData.gridHeight;
  }

  constructor() {
    super({ key: 'ExploreScene' });
  }

  create(data: {
    exploreMap: string;
    heroId?: string;
    heroState?: Record<string, HeroState>;
    gameFlags?: Record<string, boolean>;
    playTime?: number;
    inventory?: InventoryState;
    chests?: Record<string, ChestState>;
    devMode?: boolean;
  }): void {
    this.heroId = data.heroId || 'vicas';
    this.heroState = data.heroState || {};
    this.gameFlags = data.gameFlags || {};
    this.playTime = data.playTime || 0;
    this.inventory = data.inventory || createDefaultInventory();
    this.chestStates = data.chests || {};
    this.devMode = data.devMode || false;
    this.exploreMapId = data.exploreMap;

    // Check if tutorial is complete (player has seen IshetarScene3 congratulations)
    this.isPostCreditsMode = this.gameFlags['tutorial_complete'] === true;

    // Load map data
    this.mapData = this.cache.json.get(`data_battle_${data.exploreMap}`);
    this.terrain = this.mapData.terrain;
    this.mapScale = this.mapData.mapScale || 0.5;
    this.returnPosition = this.mapData.returnPosition;

    // Play travel music for exploration
    this.sound.stopAll();
    this.sound.play('music_travel', { loop: true, volume: 0.5 });

    // Load map image
    this.mapImage = this.add.image(0, 0, this.mapData.mapImage);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(this.mapScale);

    // If in post-credits mode for maple_tree, show placeholder scene
    if (this.isPostCreditsMode && this.exploreMapId === 'maple_tree') {
      this.createPostCreditsScene();
      return;
    }

    // Draw grid overlay
    this.drawGridOverlay();

    // Draw exit trigger markers
    this.drawExitTriggers();

    // Set player start position
    this.playerGridX = this.mapData.playerStart.x;
    this.playerGridY = this.mapData.playerStart.y;

    // Create player sprite
    this.createPlayer();

    // Setup camera
    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // Setup input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  private createPostCreditsScene(): void {
    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;

    // Setup camera
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.setZoom(1.5);

    // Calculate tile size for this map
    const tileW = mapWidth / this.mapData.gridWidth;
    const tileH = mapHeight / this.mapData.gridHeight;
    const spriteScale = tileW / GAME_CONFIG.SPRITE_SIZE;

    // Place character sprites at specified positions
    // Quetzi (defeated/sideways) at 11, 9
    const quetziX = 11 * tileW + tileW / 2;
    const quetziY = 9 * tileH + tileH / 2;
    const quetziSprite = this.add.sprite(quetziX, quetziY, 'sprite_quetzi_left');
    quetziSprite.setScale(spriteScale);
    quetziSprite.setAngle(90); // Rotate to look defeated/laying down

    // Azrael at 12, 9
    const azraelX = 12 * tileW + tileW / 2;
    const azraelY = 9 * tileH + tileH / 2;
    const azraelSprite = this.add.sprite(azraelX, azraelY, 'sprite_azrael_left');
    azraelSprite.setScale(spriteScale);

    // Vicas at 13, 10
    const vicasX = 13 * tileW + tileW / 2;
    const vicasY = 10 * tileH + tileH / 2;
    const vicasSprite = this.add.sprite(vicasX, vicasY, 'sprite_vicas_back');
    vicasSprite.setScale(spriteScale);

    // Lyra at 13, 8
    const lyraX = 13 * tileW + tileW / 2;
    const lyraY = 8 * tileH + tileH / 2;
    const lyraSprite = this.add.sprite(lyraX, lyraY, 'sprite_lyra_front');
    lyraSprite.setScale(spriteScale);

    // Rooker at 10, 8
    const rookerX = 10 * tileW + tileW / 2;
    const rookerY = 8 * tileH + tileH / 2;
    const rookerSprite = this.add.sprite(rookerX, rookerY, 'sprite_rooker_left');
    rookerSprite.setScale(spriteScale);

    // Thump at 10, 10
    const thumpX = 10 * tileW + tileW / 2;
    const thumpY = 10 * tileH + tileH / 2;
    const thumpSprite = this.add.sprite(thumpX, thumpY, 'sprite_thump_right');
    thumpSprite.setScale(spriteScale);

    // Center camera on Quetzi and Azrael
    this.cameras.main.centerOn((quetziX + azraelX) / 2, quetziY);

    // Setup input
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // Create dialogue renderer
    this.dialogueRenderer = new DialogueRenderer(this);

    // Position dialogue at center of screen
    const camCenterX = this.cameras.main.scrollX + GAME_CONFIG.WIDTH / 2;
    const camCenterY = this.cameras.main.scrollY + GAME_CONFIG.HEIGHT / 2;
    this.dialogueRenderer.positionRelativeTo(camCenterX, camCenterY, -180, 80);

    // Start the narrator dialogue after a brief pause
    this.cutsceneComplete = false;
    this.time.delayedCall(1000, () => {
      this.startPostCreditsDialogue();
    });
  }

  private startPostCreditsDialogue(): void {
    this.isInDialogue = true;

    const narratorLines = [
      'Our heroes place Quetzi amidst the roots of the ancient Maple Tree...',
      "Rooker attunes the leylines and opens the world's Arcana...",
      'Thump calms the restless spirits and borrows their power...',
      "Lyra channels Quetzi's natural divinity...",
      "Vicas uses his knowledge of anatomy to guide Azrael's hand...",
      "Azrael uses his psychic blades to cut to Quetzi's soul...",
      'As the ritual comes to a close, our heroes wait with bated breath...',
      '...and the shadows that cling to Quetzi rise up!',
    ];

    this.dialogueRenderer.startDialogue(
      narratorLines,
      'Narrator',
      () => {
        this.isInDialogue = false;
        // Launch the bonus battle instead of showing "To Be Continued"
        this.scene.start('BattleScene', {
          battleMap: 'maple_tree',
          heroId: this.heroId,
          heroState: this.heroState,
          gameFlags: this.gameFlags,
          playTime: this.playTime,
          inventory: this.inventory,
          chests: this.chestStates,
          devMode: this.devMode,
        });
      }
    );
  }

  private drawGridOverlay(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, GAME_CONFIG.GRID_COLOR, GAME_CONFIG.GRID_ALPHA * 0.5);

    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;

    for (let x = 0; x <= this.mapData.gridWidth; x++) {
      const pixelX = x * this.tileWidth;
      graphics.moveTo(pixelX, 0);
      graphics.lineTo(pixelX, mapHeight);
    }

    for (let y = 0; y <= this.mapData.gridHeight; y++) {
      const pixelY = y * this.tileHeight;
      graphics.moveTo(0, pixelY);
      graphics.lineTo(mapWidth, pixelY);
    }

    graphics.strokePath();
  }

  private drawExitTriggers(): void {
    const exit = this.mapData.exitTrigger;
    const halfTile = this.tileWidth / 2;
    const cornerSize = 6;
    const color = 0xb0b0b0;
    const alpha = 0.85;

    for (let x = exit.bounds.x1; x <= exit.bounds.x2; x++) {
      for (let y = exit.bounds.y1; y <= exit.bounds.y2; y++) {
        const centerX = x * this.tileWidth + halfTile;
        const centerY = y * this.tileHeight + halfTile;

        const graphics = this.add.graphics();
        graphics.setPosition(centerX, centerY);
        graphics.lineStyle(2, color, alpha);

        // Draw corner brackets
        // Top-left
        graphics.moveTo(-halfTile, -halfTile + cornerSize);
        graphics.lineTo(-halfTile, -halfTile);
        graphics.lineTo(-halfTile + cornerSize, -halfTile);
        // Top-right
        graphics.moveTo(halfTile - cornerSize, -halfTile);
        graphics.lineTo(halfTile, -halfTile);
        graphics.lineTo(halfTile, -halfTile + cornerSize);
        // Bottom-left
        graphics.moveTo(-halfTile, halfTile - cornerSize);
        graphics.lineTo(-halfTile, halfTile);
        graphics.lineTo(-halfTile + cornerSize, halfTile);
        // Bottom-right
        graphics.moveTo(halfTile - cornerSize, halfTile);
        graphics.lineTo(halfTile, halfTile);
        graphics.lineTo(halfTile, halfTile - cornerSize);

        graphics.strokePath();

        // Add grow/shrink animation
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

  private createPlayer(): void {
    const pixelX = this.playerGridX * this.tileWidth + this.tileWidth / 2;
    const pixelY = this.playerGridY * this.tileHeight + this.tileHeight / 2;

    this.player = this.add.sprite(pixelX, pixelY, `sprite_${this.heroId}_front`);
    this.player.setScale(this.tileWidth / GAME_CONFIG.SPRITE_SIZE);
  }

  private updatePlayerSprite(): void {
    this.player.setTexture(`sprite_${this.heroId}_${this.playerFacing}`);
  }

  private isPassable(gridX: number, gridY: number): boolean {
    if (gridX < 0 || gridX >= this.mapData.gridWidth) return false;
    if (gridY < 0 || gridY >= this.mapData.gridHeight) return false;

    const terrainValue = this.terrain[gridY]?.[gridX];
    if (terrainValue === 2) return false;

    return true;
  }

  private isInExitTrigger(gridX: number, gridY: number): boolean {
    const exit = this.mapData.exitTrigger;
    return (
      gridX >= exit.bounds.x1 &&
      gridX <= exit.bounds.x2 &&
      gridY >= exit.bounds.y1 &&
      gridY <= exit.bounds.y2
    );
  }

  private movePlayer(dx: number, dy: number): void {
    if (this.isMoving) return;

    const newGridX = this.playerGridX + dx;
    const newGridY = this.playerGridY + dy;

    // Update facing
    if (dx > 0) this.playerFacing = 'right';
    else if (dx < 0) this.playerFacing = 'left';
    else if (dy > 0) this.playerFacing = 'front';
    else if (dy < 0) this.playerFacing = 'back';

    this.updatePlayerSprite();

    if (!this.isPassable(newGridX, newGridY)) return;

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
        this.checkExitTrigger();
      },
    });
  }

  private checkExitTrigger(): void {
    if (this.isInExitTrigger(this.playerGridX, this.playerGridY)) {
      this.exitToTravel();
    }
  }

  private exitToTravel(): void {
    this.cameras.main.stopFollow();
    this.scene.start('TravelScene', {
      heroId: this.heroId,
      heroState: this.heroState,
      gameFlags: this.gameFlags,
      playTime: this.playTime,
      playerPosition: this.returnPosition,
      inventory: this.inventory,
      chests: this.chestStates,
      devMode: this.devMode,
    });
  }

  update(): void {
    // In post-credits mode, handle dialogue and ESC
    if (this.isPostCreditsMode && this.exploreMapId === 'maple_tree') {
      // Advance dialogue with Enter key
      if (this.isInDialogue && Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.dialogueRenderer.advance();
        return;
      }

      // Only allow ESC to exit after cutscene is complete - return to title screen
      if (this.cutsceneComplete && Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.scene.start('TitleScene');
      }
      return;
    }

    // Handle ESC key to open menu
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.pause();
      this.scene.launch('MenuScene', {
        heroState: this.heroState,
        returnScene: 'ExploreScene',
        inventory: this.inventory,
      });
      return;
    }

    if (!this.isMoving) {
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
