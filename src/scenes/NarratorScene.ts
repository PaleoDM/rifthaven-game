import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { DialogueRenderer } from '../systems/DialogueRenderer';
import { SaveManager, SaveSlotPreview } from '../systems/SaveManager';

interface HeroOption {
  id: string;
  name: string;
  class: string;
  portrait: string;
}

export class NarratorScene extends Phaser.Scene {
  private dialogueRenderer!: DialogueRenderer;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private currentPhase: 'mode_select' | 'intro' | 'menu' | 'hero_select' | 'opening' | 'save_select' | 'delete_confirm' | 'dev_scene_select' = 'mode_select';
  private menuSelection: number = 0;
  private menuOptions: string[] = ['New Game', 'Continue'];

  // Mode selection (Player vs Dev)
  private modeSelection: number = 0;
  private modeOptions: string[] = ['Player Mode', 'Dev Mode'];
  private modeTexts: Phaser.GameObjects.Text[] = [];
  private modeCursorText!: Phaser.GameObjects.Text;
  private modeTitleText!: Phaser.GameObjects.Text;

  // Dev scene selection
  private devSceneSelection: number = 0;
  private devSceneOptions: { name: string; scene: string; description: string }[] = [
    { name: 'NarratorScene', scene: 'NarratorScene', description: 'Title screen & intro' },
    { name: 'Opening Cutscene', scene: 'OpeningCutsceneScene', description: 'Dark room intro' },
    { name: 'SparkworksScene', scene: 'SparkworksScene', description: 'Overland map' },
    { name: 'SparkworksUnderground', scene: 'SparkworksUndergroundScene', description: 'Underground tunnels' },
    { name: 'Battle: Distillery', scene: 'BattleScene:abandoned_distillery', description: 'Lv1 - Opening battle' },
    { name: 'Battle: Street Ambush', scene: 'BattleScene:sparkworks_street', description: 'Lv1 - Ledgermen ambush' },
    { name: 'Explore: Ashen Chapel', scene: 'BattleScene:ashen_chapel', description: 'Lv2 - Chapel exploration' },
    { name: 'MenuScene', scene: 'MenuScene', description: 'Party stats overlay' },
  ];
  private devSceneTexts: Phaser.GameObjects.Text[] = [];
  private devSceneCursorText!: Phaser.GameObjects.Text;
  private devSceneContainer!: Phaser.GameObjects.Container;
  private menuTexts: Phaser.GameObjects.Text[] = [];
  private cursorText!: Phaser.GameObjects.Text;
  private upKey!: Phaser.Input.Keyboard.Key;
  private downKey!: Phaser.Input.Keyboard.Key;
  private leftKey!: Phaser.Input.Keyboard.Key;
  private rightKey!: Phaser.Input.Keyboard.Key;
  private deleteKey!: Phaser.Input.Keyboard.Key;
  private backspaceKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;

  // Save slot selection
  private saveSlotPreviews: SaveSlotPreview[] = [];
  private saveSlotSelection: number = 0;
  private saveSlotTexts: Phaser.GameObjects.Text[] = [];
  private saveSlotContainer!: Phaser.GameObjects.Container;
  private deleteConfirmTexts: Phaser.GameObjects.Text[] = [];
  private deleteConfirmSelection: number = 0;
  private slotToDelete: number = 0;

  // Hero selection - Rifthaven heroes
  private heroes: HeroOption[] = [
    { id: 'arden', name: 'Arden', class: 'Bard', portrait: 'portrait_arden' },
    { id: 'quin', name: 'Quin', class: 'Wizard', portrait: 'portrait_quin' },
    { id: 'veil', name: 'Veil', class: 'Monk', portrait: 'portrait_veil' },
    { id: 'ty', name: 'Ty', class: 'Warlock', portrait: 'portrait_ty' },
    { id: 'thorn', name: 'Thorn', class: 'Barbarian', portrait: 'portrait_thorn' },
  ];
  private heroSelection: number = 0;
  private heroPortraits: Phaser.GameObjects.Image[] = [];
  private heroLabels: Phaser.GameObjects.Text[] = [];
  private heroSelectionBorder!: Phaser.GameObjects.Graphics;
  private selectedHeroId: string = 'arden';

  constructor() {
    super({ key: 'NarratorScene' });
  }

  create(): void {
    // Start title screen music only if not already playing (continues from PreloadScene/TitleScene)
    const music = this.sound.get('music_title');
    if (!music || !music.isPlaying) {
      this.sound.stopAll();
      this.sound.play('music_title', { loop: true, volume: 0.5 });
    }

    // Add Miss Tibbets portrait on the left side with margin
    const portrait = this.add.image(110, GAME_CONFIG.HEIGHT / 2, 'portrait_miss_tibbets');
    const targetHeight = GAME_CONFIG.HEIGHT - 80;
    const scale = targetHeight / portrait.height;
    portrait.setScale(scale);

    // Setup keyboard input
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.upKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.downKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.leftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.rightKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.deleteKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DELETE);
    this.backspaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.BACKSPACE);
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // Create save slot container (hidden initially)
    this.saveSlotContainer = this.add.container(0, 0);
    this.saveSlotContainer.setVisible(false);

    // Create dev scene container (hidden initially)
    this.devSceneContainer = this.add.container(0, 0);
    this.devSceneContainer.setVisible(false);

    // Create dialogue renderer - position on right side to avoid covering Miss Tibbets
    this.dialogueRenderer = new DialogueRenderer(this);
    this.dialogueRenderer.setPosition(400, 450);

    // Start with mode selection
    this.showModeSelect();
  }

  // ============================================
  // Mode Selection (Player vs Dev)
  // ============================================

  private showModeSelect(): void {
    this.currentPhase = 'mode_select';
    this.modeSelection = 0;

    // Title
    this.modeTitleText = this.add.text(GAME_CONFIG.WIDTH / 2, 80, 'Select Mode', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffff00',
    }).setOrigin(0.5);
    this.modeTitleText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Mode options
    const menuStartY = 360;
    const menuX = 450;

    this.modeOptions.forEach((option, index) => {
      const desc = index === 0 ? '- Normal gameplay' : '- Jump to any scene';
      const text = this.add.text(menuX, menuStartY + index * 32, `${option}  ${desc}`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.modeTexts.push(text);
    });

    this.modeCursorText = this.add.text(menuX - 20, menuStartY, '>', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffff00',
    });
    this.modeCursorText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    this.updateModeCursor();
  }

  private clearModeSelect(): void {
    this.modeTexts.forEach(t => t.destroy());
    this.modeTexts = [];
    if (this.modeCursorText) {
      this.modeCursorText.destroy();
    }
    if (this.modeTitleText) {
      this.modeTitleText.destroy();
    }
  }

  private updateModeCursor(): void {
    if (this.modeCursorText) {
      const menuStartY = 360;
      const menuX = 450;
      this.modeCursorText.setY(menuStartY + this.modeSelection * 32);
      this.modeCursorText.setX(menuX - 20);
    }
  }

  private selectMode(): void {
    const selected = this.modeOptions[this.modeSelection];
    this.clearModeSelect();

    if (selected === 'Player Mode') {
      this.startIntroDialogue();
    } else if (selected === 'Dev Mode') {
      this.showDevSceneSelect();
    }
  }

  // ============================================
  // Dev Scene Selection
  // ============================================

  private showDevSceneSelect(): void {
    this.currentPhase = 'dev_scene_select';
    this.devSceneSelection = 0;

    this.dialogueRenderer.showStatic('Dev Mode: Select a scene (ESC to return)', 'Miss Tibbets');

    // Clear previous
    this.devSceneContainer.removeAll(true);
    this.devSceneTexts = [];

    const startX = 350;
    const startY = 100;
    const lineHeight = 32;

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.9);
    bg.fillRoundedRect(startX - 20, startY - 12, 450, lineHeight * this.devSceneOptions.length + 24, 8);
    bg.lineStyle(2, 0xffff00, 1);
    bg.strokeRoundedRect(startX - 20, startY - 12, 450, lineHeight * this.devSceneOptions.length + 24, 8);
    this.devSceneContainer.add(bg);

    // Scene options
    this.devSceneOptions.forEach((option, index) => {
      const y = startY + index * lineHeight;
      const text = this.add.text(startX, y, `${option.name}`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.devSceneTexts.push(text);
      this.devSceneContainer.add(text);

      // Description (dimmer)
      const descText = this.add.text(startX + 220, y, option.description, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      });
      descText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.devSceneContainer.add(descText);
    });

    // Cursor
    this.devSceneCursorText = this.add.text(startX - 18, startY, '>', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffff00',
    });
    this.devSceneCursorText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.devSceneContainer.add(this.devSceneCursorText);

    this.devSceneContainer.setVisible(true);
    this.updateDevSceneSelection();
  }

  private updateDevSceneSelection(): void {
    const startY = 100;
    const lineHeight = 32;

    this.devSceneTexts.forEach((text, index) => {
      if (index === this.devSceneSelection) {
        text.setColor('#ffff00');
      } else {
        text.setColor('#ffffff');
      }
    });

    if (this.devSceneCursorText) {
      this.devSceneCursorText.setY(startY + this.devSceneSelection * lineHeight);
    }
  }

  private selectDevScene(): void {
    const selected = this.devSceneOptions[this.devSceneSelection];
    this.devSceneContainer.setVisible(false);
    this.dialogueRenderer.hide();

    // Generate mock data for the scene
    const mockData = this.generateMockData(selected.scene);

    // Parse scene name (variants/battles are after the colon)
    const [sceneName] = selected.scene.split(':');

    if (sceneName === 'NarratorScene') {
      // Restart this scene in player mode
      this.clearModeSelect();
      this.startIntroDialogue();
    } else {
      // Start the scene with mock data
      this.scene.start(sceneName, mockData);
    }
  }

  private generateMockData(sceneKey: string): Record<string, unknown> {
    const [sceneName, variantId] = sceneKey.split(':');

    // Determine appropriate level based on battle/scene
    const getLevelForBattle = (battleId: string): number => {
      switch (battleId) {
        case 'abandoned_distillery': return 1;
        case 'sparkworks_street': return 1;
        case 'ashen_chapel': return 2;
        default: return 1;
      }
    };

    // Create hero state at appropriate level using SaveManager
    const createHeroState = (level: number) => SaveManager.createHeroStateAtLevel(level);

    switch (sceneName) {
      case 'SparkworksScene':
        return {
          heroId: 'arden',
          heroState: createHeroState(1),
          gameFlags: {},
          playTime: 0,
          devMode: true,
        };

      case 'SparkworksUndergroundScene':
        return {
          heroId: 'arden',
          heroState: createHeroState(2),
          gameFlags: { 'abandoned_distillery_complete': true },
          playTime: 600000,
          devMode: true,
        };

      case 'BattleScene': {
        const battleLevel = getLevelForBattle(variantId);
        return {
          heroState: createHeroState(battleLevel),
          battleMap: variantId,
          returnScene: 'SparkworksScene',
          gameFlags: {},
          devMode: true,
        };
      }

      case 'MenuScene':
        return {
          heroState: createHeroState(2),
          devMode: true,
          returnScene: 'NarratorScene',
        };

      case 'OpeningCutsceneScene':
        return {
          heroId: 'arden',
          devMode: true,
        };

      default:
        return {
          heroId: 'arden',
          heroState: createHeroState(1),
          gameFlags: {},
          devMode: true,
        };
    }
  }

  private cancelDevSceneSelect(): void {
    this.devSceneContainer.setVisible(false);
    this.dialogueRenderer.hide();
    this.showModeSelect();
  }

  private startIntroDialogue(): void {
    this.currentPhase = 'intro';

    const introLines = [
      "Oh good; you're finally here!",
      "My name is Miss Tibbets, and I've been looking for an adventurer just like you...",
      "Now now, you can't expect an old woman to remember every adventurer..."
    ];

    this.dialogueRenderer.startDialogue(introLines, 'Miss Tibbets', () => {
      this.showMainMenu();
    });
  }

  private showMainMenu(): void {
    this.currentPhase = 'menu';
    this.menuSelection = 0;

    this.clearMenu();
    this.clearHeroSelect();

    this.dialogueRenderer.showStatic('Tell me, have I sent you on a quest already?', 'Miss Tibbets');

    const menuStartY = 360;
    const menuX = 550;

    this.menuOptions.forEach((option, index) => {
      const text = this.add.text(menuX, menuStartY + index * 28, option, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.menuTexts.push(text);
    });

    this.cursorText = this.add.text(menuX - 20, menuStartY, '>', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffff00',
    });
    this.cursorText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    this.updateMenuCursor();
  }

  private clearMenu(): void {
    this.menuTexts.forEach(t => t.destroy());
    this.menuTexts = [];
    if (this.cursorText) {
      this.cursorText.destroy();
    }
  }

  private updateMenuCursor(): void {
    if (this.cursorText) {
      const menuStartY = 360;
      this.cursorText.setY(menuStartY + this.menuSelection * 28);
    }
  }

  private selectMenuItem(): void {
    const selected = this.menuOptions[this.menuSelection];
    this.clearMenu();

    if (selected === 'New Game') {
      this.showHeroSelect();
    } else if (selected === 'Continue') {
      this.continueGame();
    }
  }

  private showHeroSelect(): void {
    this.currentPhase = 'hero_select';
    this.heroSelection = 0;

    this.dialogueRenderer.showStatic('Oh, a new adventurer! Which of our heroes are you?', 'Miss Tibbets');

    // Two-row layout: 3 on top, 2 on bottom
    // Larger portraits to reduce downscaling artifacts (512 -> 140 = ~3.6x instead of 512 -> 120 = ~4.3x)
    const portraitDisplaySize = 140;
    const centerX = 570;
    const spacingX = 160;
    const row1Y = 140;
    const row2Y = 320;
    const labelOffset = 78;

    const positions = [
      { x: centerX - spacingX, y: row1Y },      // 0: Arden (left)
      { x: centerX, y: row1Y },                  // 1: Quin (center)
      { x: centerX + spacingX, y: row1Y },       // 2: Veil (right)
      { x: centerX - spacingX / 2, y: row2Y },   // 3: Ty (left-center)
      { x: centerX + spacingX / 2, y: row2Y },   // 4: Thorn (right-center)
    ];

    // Create selection border (yellow rectangle)
    this.heroSelectionBorder = this.add.graphics();

    this.heroes.forEach((hero, index) => {
      const pos = positions[index];

      const img = this.add.image(pos.x, pos.y, hero.portrait);
      img.setDisplaySize(portraitDisplaySize, portraitDisplaySize);
      // Force LINEAR filtering by setting scale mode directly on texture source
      // This overrides pixelArt: true more reliably
      const textureSource = img.texture.source[0];
      if (textureSource) {
        textureSource.scaleMode = Phaser.ScaleModes.LINEAR;
        // Force WebGL to re-upload texture with new filter mode
        if (textureSource.glTexture && this.game.renderer.type === Phaser.WEBGL) {
          (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).setTextureFilter(
            textureSource.glTexture,
            Phaser.Textures.FilterMode.LINEAR
          );
        }
      }
      this.heroPortraits.push(img);

      // Name and class label below
      const label = this.add.text(pos.x, pos.y + labelOffset, `${hero.name}\n${hero.class}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        align: 'center',
      });
      label.setOrigin(0.5, 0);
      label.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.heroLabels.push(label);
    });

    this.updateHeroSelectionBorder();
  }

  private clearHeroSelect(): void {
    this.heroPortraits.forEach(p => p.destroy());
    this.heroPortraits = [];
    this.heroLabels.forEach(l => l.destroy());
    this.heroLabels = [];
    if (this.heroSelectionBorder) {
      this.heroSelectionBorder.destroy();
    }
  }

  private updateHeroSelectionBorder(): void {
    if (!this.heroSelectionBorder || this.heroPortraits.length === 0) return;

    this.heroSelectionBorder.clear();
    this.heroSelectionBorder.lineStyle(3, 0xffff00, 1);

    const selectedPortrait = this.heroPortraits[this.heroSelection];
    const size = 140; // Match the portrait display size
    this.heroSelectionBorder.strokeRect(
      selectedPortrait.x - size / 2 - 4,
      selectedPortrait.y - size / 2 - 4,
      size + 8,
      size + 8
    );
  }

  private selectHero(): void {
    this.selectedHeroId = this.heroes[this.heroSelection].id;
    this.clearHeroSelect();
    this.startNewGame();
  }

  private startNewGame(): void {
    this.currentPhase = 'opening';

    const heroName = this.heroes.find(h => h.id === this.selectedHeroId)?.name || 'hero';

    const openingLines = [
      `A new tale begins, and ${heroName} shall be our protagonist!`,
      "Welcome to Rifthaven, a city built on the edge of reality itself.",
      "The Sparkworks district hums with arcane machinery and desperate souls.",
      "Something sinister stirs in the shadows, and five unlikely heroes answer a mysterious call for revolutionaries...",
    ];

    this.dialogueRenderer.startDialogue(openingLines, 'Miss Tibbets', () => {
      // Transition to opening cutscene (dark room dialogue before first battle)
      this.scene.start('OpeningCutsceneScene', { heroId: this.selectedHeroId });
    });
  }

  private continueGame(): void {
    // Get all save slot previews
    this.saveSlotPreviews = SaveManager.getAllSlotPreviews();

    // Check if any saves exist
    const hasSaves = this.saveSlotPreviews.some(s => !s.isEmpty);

    if (!hasSaves) {
      this.currentPhase = 'intro';
      const noSaveLines = [
        "Sorry hero, but the bards haven't sung of your exploits yet...",
        "Perhaps you tell your own tale, then?"
      ];
      this.dialogueRenderer.startDialogue(noSaveLines, 'Miss Tibbets', () => {
        this.showMainMenu();
      });
      return;
    }

    // Show save slot selection
    this.showSaveSlotSelection();
  }

  private showSaveSlotSelection(): void {
    this.currentPhase = 'save_select';
    this.saveSlotSelection = 0;

    this.dialogueRenderer.showStatic('Which tale shall we continue? (Backspace to delete, ESC to go back)', 'Miss Tibbets');

    // Clear previous slot UI
    this.saveSlotContainer.removeAll(true);
    this.saveSlotTexts = [];

    const startX = 350;
    const startY = 280;
    const slotHeight = 50;

    // Create slot text displays first to measure width
    const tempTexts: Phaser.GameObjects.Text[] = [];
    this.saveSlotPreviews.forEach((preview, index) => {
      const y = startY + index * slotHeight;

      let slotText: string;
      if (preview.isEmpty) {
        slotText = `Slot ${preview.slot}: — Empty —`;
      } else {
        const heroName = this.heroes.find(h => h.id === preview.mainHero)?.name || preview.mainHero;
        const levels = preview.heroLevels?.join('/') || '1/1/1/1/1';
        const playTime = SaveManager.formatPlayTime(preview.playTime || 0);
        const location = SaveManager.getMapDisplayName(preview.location || 'unknown');
        slotText = `Slot ${preview.slot}: ${heroName} | Lv ${levels} | ${playTime} | ${location}`;
      }

      const text = this.add.text(startX, y, slotText, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      tempTexts.push(text);
    });

    // Calculate background width based on longest text
    const maxTextWidth = Math.max(...tempTexts.map(t => t.width));
    const bgWidth = Math.max(450, maxTextWidth + 60);

    // Draw background for slots
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.8);
    bg.fillRoundedRect(startX - 20, startY - 15, bgWidth, slotHeight * 3 + 30, 8);
    bg.lineStyle(2, 0xffffff, 1);
    bg.strokeRoundedRect(startX - 20, startY - 15, bgWidth, slotHeight * 3 + 30, 8);
    this.saveSlotContainer.add(bg);

    // Add text objects to container
    tempTexts.forEach((text) => {
      this.saveSlotTexts.push(text);
      this.saveSlotContainer.add(text);
    });

    this.saveSlotContainer.setVisible(true);
    this.updateSaveSlotSelection();
  }

  private updateSaveSlotSelection(): void {
    this.saveSlotTexts.forEach((text, index) => {
      if (index === this.saveSlotSelection) {
        text.setColor('#ffff00');
        text.setText('> ' + text.text.replace(/^> /, ''));
      } else {
        text.setColor('#ffffff');
        text.setText(text.text.replace(/^> /, ''));
      }
    });
  }

  private selectSaveSlot(): void {
    const selectedPreview = this.saveSlotPreviews[this.saveSlotSelection];

    if (selectedPreview.isEmpty) {
      return;
    }

    // Load the save and start the game
    const saveData = SaveManager.load(selectedPreview.slot);
    if (saveData) {
      this.saveSlotContainer.setVisible(false);
      this.dialogueRenderer.hide();

      // Start SparkworksScene with save data
      this.scene.start('SparkworksScene', {
        heroId: saveData.mainHero,
        heroState: saveData.heroState,
        gameFlags: saveData.flags,
        playTime: saveData.playTime,
        inventory: saveData.inventory,
        chests: saveData.chests,
      });
    }
  }

  private showDeleteConfirmation(): void {
    const selectedPreview = this.saveSlotPreviews[this.saveSlotSelection];

    if (selectedPreview.isEmpty) {
      return;
    }

    this.slotToDelete = selectedPreview.slot;
    this.currentPhase = 'delete_confirm';
    this.deleteConfirmSelection = 1; // Default to "No"

    this.dialogueRenderer.showStatic(`Delete Slot ${this.slotToDelete}? This cannot be undone.`, 'Miss Tibbets');

    // Clear and show delete confirmation
    this.deleteConfirmTexts.forEach(t => t.destroy());
    this.deleteConfirmTexts = [];

    const confirmY = 420;
    const noText = this.add.text(450, confirmY, 'No', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffff00',
    });
    noText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    const yesText = this.add.text(530, confirmY, 'Yes', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    yesText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    this.deleteConfirmTexts.push(noText, yesText);
    this.updateDeleteConfirmSelection();
  }

  private updateDeleteConfirmSelection(): void {
    this.deleteConfirmTexts.forEach((text, index) => {
      if (index === this.deleteConfirmSelection) {
        text.setColor('#ffff00');
      } else {
        text.setColor('#ffffff');
      }
    });
  }

  private confirmDelete(): void {
    if (this.deleteConfirmSelection === 1) {
      // Yes - delete the save
      SaveManager.delete(this.slotToDelete);
    }

    // Clear delete UI
    this.deleteConfirmTexts.forEach(t => t.destroy());
    this.deleteConfirmTexts = [];

    // Refresh save slots
    this.saveSlotPreviews = SaveManager.getAllSlotPreviews();
    const hasSaves = this.saveSlotPreviews.some(s => !s.isEmpty);

    if (!hasSaves) {
      this.saveSlotContainer.setVisible(false);
      this.showMainMenu();
    } else {
      this.showSaveSlotSelection();
    }
  }

  private cancelSaveSelection(): void {
    this.saveSlotContainer.setVisible(false);
    this.showMainMenu();
  }

  update(): void {
    if (this.currentPhase === 'mode_select') {
      if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
        this.modeSelection = Math.max(0, this.modeSelection - 1);
        this.updateModeCursor();
      }
      if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
        this.modeSelection = Math.min(this.modeOptions.length - 1, this.modeSelection + 1);
        this.updateModeCursor();
      }
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectMode();
      }
    } else if (this.currentPhase === 'dev_scene_select') {
      if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
        this.devSceneSelection = Math.max(0, this.devSceneSelection - 1);
        this.updateDevSceneSelection();
      }
      if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
        this.devSceneSelection = Math.min(this.devSceneOptions.length - 1, this.devSceneSelection + 1);
        this.updateDevSceneSelection();
      }
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectDevScene();
      }
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.cancelDevSceneSelect();
      }
    } else if (this.currentPhase === 'menu') {
      if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
        this.menuSelection = Math.max(0, this.menuSelection - 1);
        this.updateMenuCursor();
      }
      if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
        this.menuSelection = Math.min(this.menuOptions.length - 1, this.menuSelection + 1);
        this.updateMenuCursor();
      }
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectMenuItem();
      }
    } else if (this.currentPhase === 'hero_select') {
      // Two-row layout: Row 1 = indices 0,1,2 | Row 2 = indices 3,4
      if (Phaser.Input.Keyboard.JustDown(this.leftKey)) {
        if (this.heroSelection <= 2) {
          this.heroSelection = Math.max(0, this.heroSelection - 1);
        } else {
          this.heroSelection = Math.max(3, this.heroSelection - 1);
        }
        this.updateHeroSelectionBorder();
      }
      if (Phaser.Input.Keyboard.JustDown(this.rightKey)) {
        if (this.heroSelection <= 2) {
          this.heroSelection = Math.min(2, this.heroSelection + 1);
        } else {
          this.heroSelection = Math.min(4, this.heroSelection + 1);
        }
        this.updateHeroSelectionBorder();
      }
      if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
        if (this.heroSelection <= 2) {
          this.heroSelection = this.heroSelection <= 1 ? 3 : 4;
          this.updateHeroSelectionBorder();
        }
      }
      if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
        if (this.heroSelection >= 3) {
          this.heroSelection = 1;
          this.updateHeroSelectionBorder();
        }
      }
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectHero();
      }
    } else if (this.currentPhase === 'save_select') {
      if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
        this.saveSlotSelection = Math.max(0, this.saveSlotSelection - 1);
        this.updateSaveSlotSelection();
      }
      if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
        this.saveSlotSelection = Math.min(this.saveSlotPreviews.length - 1, this.saveSlotSelection + 1);
        this.updateSaveSlotSelection();
      }
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectSaveSlot();
      }
      if (Phaser.Input.Keyboard.JustDown(this.deleteKey) || Phaser.Input.Keyboard.JustDown(this.backspaceKey)) {
        this.showDeleteConfirmation();
      }
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.cancelSaveSelection();
      }
    } else if (this.currentPhase === 'delete_confirm') {
      if (Phaser.Input.Keyboard.JustDown(this.leftKey)) {
        this.deleteConfirmSelection = 0;
        this.updateDeleteConfirmSelection();
      }
      if (Phaser.Input.Keyboard.JustDown(this.rightKey)) {
        this.deleteConfirmSelection = 1;
        this.updateDeleteConfirmSelection();
      }
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.confirmDelete();
      }
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.deleteConfirmTexts.forEach(t => t.destroy());
        this.deleteConfirmTexts = [];
        this.showSaveSlotSelection();
      }
    } else {
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.dialogueRenderer.advance();
      }
    }
  }
}
