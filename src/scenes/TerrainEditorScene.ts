import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';

interface MapOption {
  id: string;
  name: string;
  file: string;
  isBattle?: boolean;
  scale?: number; // Default 0.5, overland maps use 0.75 for 24x24 grid
}

interface HeroPosition {
  x: number;
  y: number;
}

interface EnemyPlacement {
  type: string;
  x: number;
  y: number;
}

type EditorMode = 'terrain' | 'hero' | 'enemy';

export class TerrainEditorScene extends Phaser.Scene {
  private maps: MapOption[] = [
    { id: 'abandoned_distillery', name: 'Abandoned Distillery', file: 'map_abandoned_distillery', isBattle: true },
    { id: 'street', name: 'Sparkworks Streets', file: 'map_street', isBattle: true },
    { id: 'allfather_chapel', name: 'All Father Chapel', file: 'map_allfather_chapel', isBattle: true },
    { id: 'sparkworks', name: 'Sparkworks Overland', file: 'map_sparkworks', scale: 0.75 },
    { id: 'sparkworks_underground', name: 'Sparkworks Underground', file: 'map_sparkworks_underground', scale: 0.75 },
  ];

  private enemyTypes: string[] = ['cultist_mook', 'cultist_enforcer', 'cultist_caster', 'ledgerman_mook', 'ledgerman_enforcer', 'ledgerman_hexer'];
  private currentEnemyTypeIndex: number = 0;

  private currentMapIndex: number = 0;
  private mapImage!: Phaser.GameObjects.Image;
  private terrainData: number[][] = [];
  private terrainOverlay!: Phaser.GameObjects.Graphics;
  private gridOverlay!: Phaser.GameObjects.Graphics;
  private unitOverlay!: Phaser.GameObjects.Graphics;
  private coordinateLabels: Phaser.GameObjects.Text[] = [];
  private coordsText!: Phaser.GameObjects.Text;
  private instructionsText!: Phaser.GameObjects.Text;
  private mapNameText!: Phaser.GameObjects.Text;

  private mapGridWidth: number = 0;
  private mapGridHeight: number = 0;

  private isDragging: boolean = false;
  private currentPaintValue: number = 2;
  private editorMode: EditorMode = 'terrain';

  // Unit placement data
  private heroPositions: HeroPosition[] = [];
  private enemyPlacements: EnemyPlacement[] = [];

  constructor() {
    super({ key: 'TerrainEditorScene' });
  }

  preload(): void {
    // Load all Rifthaven maps
    this.load.image('map_abandoned_distillery', 'assets/maps/abandoned_distillery.png');
    this.load.image('map_street', 'assets/maps/street.png');
    this.load.image('map_allfather_chapel', 'assets/maps/allfather_chapel.png');
    this.load.image('map_sparkworks', 'assets/maps/sparkworks.png');
    this.load.image('map_sparkworks_underground', 'assets/maps/sparkworks_underground.png');
  }

  create(): void {
    // Instructions (fixed to camera)
    this.instructionsText = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 10, y: 10 },
    });
    this.instructionsText.setScrollFactor(0);
    this.instructionsText.setDepth(1000);

    // Current map name
    this.mapNameText = this.add.text(10, 220, '', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffff00',
      backgroundColor: '#000000aa',
      padding: { x: 10, y: 5 },
    });
    this.mapNameText.setScrollFactor(0);
    this.mapNameText.setDepth(1000);

    // Coordinates display
    this.coordsText = this.add.text(10, 260, 'Tile: --, --', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#00ff00',
      backgroundColor: '#000000aa',
      padding: { x: 10, y: 5 },
    });
    this.coordsText.setScrollFactor(0);
    this.coordsText.setDepth(1000);

    this.updateInstructions();

    // Check if a specific map was requested via URL parameter
    const requestedMap = this.registry.get('editorMap');
    if (requestedMap) {
      const mapIndex = this.maps.findIndex(m => m.id === requestedMap);
      if (mapIndex !== -1) {
        this.currentMapIndex = mapIndex;
      }
    }

    this.loadMap(this.currentMapIndex);

    // Setup input
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointerup', this.onPointerUp, this);

    // Keyboard controls
    this.input.keyboard!.on('keydown-LEFT', () => this.switchMap(-1));
    this.input.keyboard!.on('keydown-RIGHT', () => this.switchMap(1));
    this.input.keyboard!.on('keydown-E', () => this.exportData());
    this.input.keyboard!.on('keydown-C', () => this.clearAll());

    // Terrain modes
    this.input.keyboard!.on('keydown-ONE', () => { this.editorMode = 'terrain'; this.currentPaintValue = 0; this.updateInstructions(); });
    this.input.keyboard!.on('keydown-TWO', () => { this.editorMode = 'terrain'; this.currentPaintValue = 1; this.updateInstructions(); });
    this.input.keyboard!.on('keydown-THREE', () => { this.editorMode = 'terrain'; this.currentPaintValue = 2; this.updateInstructions(); });

    // Unit placement modes
    this.input.keyboard!.on('keydown-H', () => { this.editorMode = 'hero'; this.updateInstructions(); });
    this.input.keyboard!.on('keydown-N', () => { this.editorMode = 'enemy'; this.updateInstructions(); });

    // Enemy type cycling (when in enemy mode)
    this.input.keyboard!.on('keydown-OPEN_BRACKET', () => this.cycleEnemyType(-1));
    this.input.keyboard!.on('keydown-CLOSED_BRACKET', () => this.cycleEnemyType(1));

    // Camera drag with middle mouse or right click
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.middleButtonDown() || pointer.rightButtonDown()) {
        this.cameras.main.scrollX -= pointer.velocity.x / 10;
        this.cameras.main.scrollY -= pointer.velocity.y / 10;
      }
    });

    // Mouse wheel zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
      const zoom = this.cameras.main.zoom;
      if (deltaY > 0) {
        this.cameras.main.setZoom(Math.max(0.25, zoom - 0.1));
      } else {
        this.cameras.main.setZoom(Math.min(2, zoom + 0.1));
      }
    });
  }

  private cycleEnemyType(direction: number): void {
    if (this.editorMode !== 'enemy') return;
    this.currentEnemyTypeIndex = (this.currentEnemyTypeIndex + direction + this.enemyTypes.length) % this.enemyTypes.length;
    this.updateInstructions();
  }

  private updateInstructions(): void {
    const map = this.maps[this.currentMapIndex];
    const isBattle = map.isBattle;

    const modeIndicator = this.editorMode === 'terrain'
      ? `Terrain: ${['0: Walkable', '1: Difficult', '2: Impassable'][this.currentPaintValue]}`
      : this.editorMode === 'hero'
      ? 'Hero Placement (click to add/remove)'
      : `Enemy: ${this.enemyTypes[this.currentEnemyTypeIndex]} ([ ] to cycle)`;

    const lines = [
      'MAP EDITOR',
      '─────────────────',
      'Left/Right: Switch map',
      '',
      'TERRAIN MODE:',
      '1: Walkable  2: Difficult  3: Impassable',
      '',
    ];

    if (isBattle) {
      lines.push(
        'UNIT PLACEMENT:',
        'H: Hero positions',
        'N: Enemy positions',
        '[ / ]: Cycle enemy type',
        ''
      );
    }

    lines.push(
      'OTHER:',
      'E: Export to console',
      'C: Clear all',
      'Scroll: Zoom | Right-drag: Pan',
      '',
      `MODE: ${modeIndicator}`
    );

    this.instructionsText.setText(lines.join('\n'));
  }

  private loadMap(index: number): void {
    const map = this.maps[index];

    // Clear existing
    if (this.mapImage) this.mapImage.destroy();
    if (this.terrainOverlay) this.terrainOverlay.destroy();
    if (this.gridOverlay) this.gridOverlay.destroy();
    if (this.unitOverlay) this.unitOverlay.destroy();

    // Reset unit placements
    this.heroPositions = [];
    this.enemyPlacements = [];

    // Load map image (scaled to match game rendering - default 0.5, overland maps 0.75)
    const mapScale = map.scale ?? 0.5;
    this.mapImage = this.add.image(0, 0, map.file);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(mapScale);

    // Calculate grid dimensions using displayed (scaled) size
    this.mapGridWidth = Math.floor(this.mapImage.displayWidth / GAME_CONFIG.TILE_SIZE);
    this.mapGridHeight = Math.floor(this.mapImage.displayHeight / GAME_CONFIG.TILE_SIZE);

    // Initialize terrain data (all walkable by default)
    this.terrainData = [];
    for (let y = 0; y < this.mapGridHeight; y++) {
      this.terrainData[y] = [];
      for (let x = 0; x < this.mapGridWidth; x++) {
        this.terrainData[y][x] = 0;
      }
    }

    // Create overlays
    this.terrainOverlay = this.add.graphics();
    this.gridOverlay = this.add.graphics();
    this.unitOverlay = this.add.graphics();
    this.unitOverlay.setDepth(100);

    this.drawGrid();
    this.updateMapName();
    this.updateInstructions();

    // Set camera bounds (with extra space for coordinate labels) - use displayed (scaled) size
    this.cameras.main.setBounds(-40, -40, this.mapImage.displayWidth + 80, this.mapImage.displayHeight + 80);
    this.cameras.main.setZoom(1);
    this.cameras.main.scrollX = -40;
    this.cameras.main.scrollY = -40;
  }

  private drawGrid(): void {
    this.gridOverlay.clear();
    this.gridOverlay.lineStyle(1, 0xffffff, 0.3);

    // Clear old coordinate labels
    this.coordinateLabels.forEach(label => label.destroy());
    this.coordinateLabels = [];

    // Vertical lines (use displayWidth/displayHeight for scaled maps)
    for (let x = 0; x <= this.mapImage.displayWidth; x += GAME_CONFIG.TILE_SIZE) {
      this.gridOverlay.moveTo(x, 0);
      this.gridOverlay.lineTo(x, this.mapImage.displayHeight);
    }

    // Horizontal lines
    for (let y = 0; y <= this.mapImage.displayHeight; y += GAME_CONFIG.TILE_SIZE) {
      this.gridOverlay.moveTo(0, y);
      this.gridOverlay.lineTo(this.mapImage.displayWidth, y);
    }

    this.gridOverlay.strokePath();

    // Add coordinate labels on each tile
    for (let row = 0; row < this.mapGridHeight; row++) {
      for (let col = 0; col < this.mapGridWidth; col++) {
        const label = this.add.text(
          col * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          row * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          `${col},${row}`,
          { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }
        );
        label.setOrigin(0.5, 0.5);
        label.setDepth(50);
        label.setAlpha(0.7);
        this.coordinateLabels.push(label);
      }
    }
  }

  private updateMapName(): void {
    const map = this.maps[this.currentMapIndex];
    const typeLabel = map.isBattle ? ' [BATTLE]' : '';
    this.mapNameText.setText(`Map: ${map.name}${typeLabel} (${this.mapGridWidth}x${this.mapGridHeight})`);
  }

  private switchMap(direction: number): void {
    this.currentMapIndex = (this.currentMapIndex + direction + this.maps.length) % this.maps.length;
    this.loadMap(this.currentMapIndex);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;
    const gridX = Math.floor(worldX / GAME_CONFIG.TILE_SIZE);
    const gridY = Math.floor(worldY / GAME_CONFIG.TILE_SIZE);

    if (gridX >= 0 && gridX < this.mapGridWidth && gridY >= 0 && gridY < this.mapGridHeight) {
      const currentValue = this.terrainData[gridY]?.[gridX] ?? 0;
      const terrainNames = ['Walkable', 'Difficult', 'Impassable'];

      // Check for units at this position
      const heroIndex = this.heroPositions.findIndex(h => h.x === gridX && h.y === gridY);
      const enemy = this.enemyPlacements.find(e => e.x === gridX && e.y === gridY);

      let unitInfo = '';
      if (heroIndex !== -1) unitInfo = ` | Hero #${heroIndex + 1}`;
      if (enemy) unitInfo = ` | Enemy: ${enemy.type}`;

      this.coordsText.setText(`Tile: ${gridX}, ${gridY} [${terrainNames[currentValue]}]${unitInfo}`);

      // Paint while dragging (terrain mode only)
      if (this.isDragging && pointer.leftButtonDown() && this.editorMode === 'terrain') {
        this.paintTile(gridX, gridY);
      }
    } else {
      this.coordsText.setText('Tile: --, --');
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.leftButtonDown()) {
      const gridX = Math.floor(pointer.worldX / GAME_CONFIG.TILE_SIZE);
      const gridY = Math.floor(pointer.worldY / GAME_CONFIG.TILE_SIZE);

      if (gridX < 0 || gridX >= this.mapGridWidth || gridY < 0 || gridY >= this.mapGridHeight) {
        return;
      }

      if (this.editorMode === 'terrain') {
        this.isDragging = true;
        this.paintTile(gridX, gridY);
      } else if (this.editorMode === 'hero') {
        this.toggleHeroPosition(gridX, gridY);
      } else if (this.editorMode === 'enemy') {
        this.toggleEnemyPosition(gridX, gridY);
      }
    }
  }

  private onPointerUp(): void {
    this.isDragging = false;
  }

  private toggleHeroPosition(gridX: number, gridY: number): void {
    const existingIndex = this.heroPositions.findIndex(h => h.x === gridX && h.y === gridY);

    if (existingIndex !== -1) {
      // Remove existing hero position
      this.heroPositions.splice(existingIndex, 1);
    } else {
      // Add new hero position (max 5)
      if (this.heroPositions.length < 5) {
        this.heroPositions.push({ x: gridX, y: gridY });
      }
    }

    this.redrawUnitOverlay();
  }

  private toggleEnemyPosition(gridX: number, gridY: number): void {
    const existingIndex = this.enemyPlacements.findIndex(e => e.x === gridX && e.y === gridY);

    if (existingIndex !== -1) {
      // Remove existing enemy
      this.enemyPlacements.splice(existingIndex, 1);
    } else {
      // Add new enemy
      this.enemyPlacements.push({
        type: this.enemyTypes[this.currentEnemyTypeIndex],
        x: gridX,
        y: gridY
      });
    }

    this.redrawUnitOverlay();
  }

  private paintTile(gridX: number, gridY: number): void {
    if (gridX < 0 || gridX >= this.mapGridWidth || gridY < 0 || gridY >= this.mapGridHeight) {
      return;
    }

    this.terrainData[gridY][gridX] = this.currentPaintValue;
    this.redrawTerrainOverlay();
  }

  private redrawTerrainOverlay(): void {
    this.terrainOverlay.clear();

    for (let y = 0; y < this.mapGridHeight; y++) {
      for (let x = 0; x < this.mapGridWidth; x++) {
        const value = this.terrainData[y][x];
        if (value === 1) {
          // Difficult terrain - yellow
          this.terrainOverlay.fillStyle(0xffff00, 0.4);
          this.terrainOverlay.fillRect(
            x * GAME_CONFIG.TILE_SIZE,
            y * GAME_CONFIG.TILE_SIZE,
            GAME_CONFIG.TILE_SIZE,
            GAME_CONFIG.TILE_SIZE
          );
        } else if (value === 2) {
          // Impassable - red
          this.terrainOverlay.fillStyle(0xff0000, 0.4);
          this.terrainOverlay.fillRect(
            x * GAME_CONFIG.TILE_SIZE,
            y * GAME_CONFIG.TILE_SIZE,
            GAME_CONFIG.TILE_SIZE,
            GAME_CONFIG.TILE_SIZE
          );
        }
      }
    }
  }

  private redrawUnitOverlay(): void {
    this.unitOverlay.clear();

    const tileSize = GAME_CONFIG.TILE_SIZE;
    const halfTile = tileSize / 2;

    // Draw hero positions (cyan circles with numbers)
    this.heroPositions.forEach((hero) => {
      const centerX = hero.x * tileSize + halfTile;
      const centerY = hero.y * tileSize + halfTile;

      // Cyan fill
      this.unitOverlay.fillStyle(0x00ffff, 0.7);
      this.unitOverlay.fillCircle(centerX, centerY, halfTile - 4);

      // White border
      this.unitOverlay.lineStyle(2, 0xffffff, 1);
      this.unitOverlay.strokeCircle(centerX, centerY, halfTile - 4);
    });

    // Draw enemy positions (red circles)
    this.enemyPlacements.forEach(enemy => {
      const centerX = enemy.x * tileSize + halfTile;
      const centerY = enemy.y * tileSize + halfTile;

      // Color based on enemy type
      let color = 0xff0000;
      if (enemy.type === 'lemure') color = 0xff6600;
      if (enemy.type === 'spined_devil') color = 0xff00ff;
      if (enemy.type === 'ogre') color = 0x00ff00;
      if (enemy.type === 'hellhound') color = 0xff3300;

      // Fill
      this.unitOverlay.fillStyle(color, 0.7);
      this.unitOverlay.fillCircle(centerX, centerY, halfTile - 4);

      // White border
      this.unitOverlay.lineStyle(2, 0xffffff, 1);
      this.unitOverlay.strokeCircle(centerX, centerY, halfTile - 4);
    });

    // Add text labels for heroes and enemies
    // Clear any existing labels first
    this.children.list
      .filter(child => child.getData && child.getData('unitLabel'))
      .forEach(label => label.destroy());

    // Hero numbers
    this.heroPositions.forEach((hero, index) => {
      const text = this.add.text(
        hero.x * tileSize + halfTile,
        hero.y * tileSize + halfTile,
        `H${index + 1}`,
        { fontFamily: 'monospace', fontSize: '12px', color: '#000000' }
      );
      text.setOrigin(0.5, 0.5);
      text.setDepth(101);
      text.setData('unitLabel', true);
    });

    // Enemy type initials
    this.enemyPlacements.forEach(enemy => {
      const initial = enemy.type.charAt(0).toUpperCase();
      const text = this.add.text(
        enemy.x * tileSize + halfTile,
        enemy.y * tileSize + halfTile,
        initial,
        { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold' }
      );
      text.setOrigin(0.5, 0.5);
      text.setDepth(101);
      text.setData('unitLabel', true);
    });
  }

  private clearAll(): void {
    // Clear terrain
    for (let y = 0; y < this.mapGridHeight; y++) {
      for (let x = 0; x < this.mapGridWidth; x++) {
        this.terrainData[y][x] = 0;
      }
    }

    // Clear units
    this.heroPositions = [];
    this.enemyPlacements = [];

    this.redrawTerrainOverlay();
    this.redrawUnitOverlay();
  }

  private exportData(): void {
    const map = this.maps[this.currentMapIndex];

    if (map.isBattle) {
      // Export as battle map
      const output = {
        id: map.id,
        displayName: map.name,
        mapImage: map.file,
        gridWidth: this.mapGridWidth,
        gridHeight: this.mapGridHeight,
        terrain: this.terrainData,
        heroStartPositions: this.heroPositions,
        enemies: this.enemyPlacements,
        victoryCondition: 'defeat_all',
        defeatCondition: 'all_heroes_down',
        introCutscene: ['Battle begins!'],
        victoryCutscene: ['Victory!'],
      };

      console.log('='.repeat(50));
      console.log(`BATTLE MAP DATA FOR: ${map.name}`);
      console.log('='.repeat(50));
      console.log(JSON.stringify(output, null, 2));
      console.log('='.repeat(50));
    } else {
      // Export as regular map
      const output = {
        id: map.id,
        displayName: map.name,
        gridWidth: this.mapGridWidth,
        gridHeight: this.mapGridHeight,
        terrain: this.terrainData,
        npcs: [],
        playerStart: { x: Math.floor(this.mapGridWidth / 2), y: Math.floor(this.mapGridHeight / 2) },
      };

      console.log('='.repeat(50));
      console.log(`TERRAIN DATA FOR: ${map.name}`);
      console.log('='.repeat(50));
      console.log(JSON.stringify(output, null, 2));
      console.log('='.repeat(50));
    }

    // Also copy just the terrain array for easy pasting
    console.log('\nTERRAIN ARRAY ONLY:');
    console.log(JSON.stringify(this.terrainData));

    if (map.isBattle) {
      console.log('\nHERO POSITIONS:');
      console.log(JSON.stringify(this.heroPositions));
      console.log('\nENEMY PLACEMENTS:');
      console.log(JSON.stringify(this.enemyPlacements));
    }

    alert(`Data exported to browser console!\nOpen DevTools (F12) → Console tab to copy it.`);
  }
}
