import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { HeroState } from '../systems/SaveManager';
import { PartyStatsPanel } from './PartyStatsPanel';

type MenuView = 'main' | 'party' | 'inventory' | 'tactics';

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

/**
 * Main game menu accessible via ESC key in town scenes
 */
export class GameMenu {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private isOpen: boolean = false;
  private currentView: MenuView = 'main';
  private cameraZoom: number;

  // Data
  private heroState: Record<string, HeroState>;
  private heroesData: Record<string, HeroData>;
  private abilitiesData: Record<string, AbilityData>;

  // Input
  private escKey!: Phaser.Input.Keyboard.Key;
  private upKey!: Phaser.Input.Keyboard.Key;
  private downKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;

  // Main menu UI
  private menuSelection: number = 0;
  private menuOptions: string[] = ['Party', 'Inventory', "Hrothgar's Battle Tactics", 'Close'];
  private menuTexts: Phaser.GameObjects.Text[] = [];
  private cursorText!: Phaser.GameObjects.Text;
  private menuBackground!: Phaser.GameObjects.Rectangle;
  private menuBorder!: Phaser.GameObjects.Rectangle;
  private titleText!: Phaser.GameObjects.Text;

  // Sub-panels
  private partyPanel: PartyStatsPanel | null = null;

  // Placeholder panels
  private placeholderContainer: Phaser.GameObjects.Container | null = null;

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
    this.cameraZoom = cameraZoom;

    // Create main container
    // Scale inversely to camera zoom so UI appears at correct size
    const uiScale = 1 / this.cameraZoom;
    this.container = scene.add.container(0, 0);
    this.container.setScale(uiScale);
    this.container.setDepth(1000);
    this.container.setScrollFactor(0);
    this.container.setVisible(false);

    // Setup input
    this.setupInput();

    // Create main menu UI
    this.createMainMenu();
  }

  private setupInput(): void {
    this.escKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.upKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.downKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.enterKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  }

  private createMainMenu(): void {
    const menuWidth = 280;
    const menuHeight = 180;
    const menuX = (GAME_CONFIG.WIDTH - menuWidth) / 2;
    const menuY = (GAME_CONFIG.HEIGHT - menuHeight) / 2;

    // Background
    this.menuBackground = this.scene.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      menuWidth,
      menuHeight,
      0x000000,
      0.95
    );
    this.container.add(this.menuBackground);

    // Border
    this.menuBorder = this.scene.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      menuWidth,
      menuHeight
    );
    this.menuBorder.setStrokeStyle(2, 0xffffff);
    this.menuBorder.setFillStyle(0x000000, 0);
    this.container.add(this.menuBorder);

    // Title
    this.titleText = this.scene.add.text(
      GAME_CONFIG.WIDTH / 2,
      menuY + 20,
      'MENU',
      {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffff00',
      }
    );
    this.titleText.setOrigin(0.5, 0.5);
    this.titleText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(this.titleText);

    // Menu options
    const optionStartY = menuY + 55;
    const optionX = menuX + 40;

    this.menuOptions.forEach((option, index) => {
      const text = this.scene.add.text(optionX, optionStartY + index * 28, option, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.menuTexts.push(text);
      this.container.add(text);
    });

    // Cursor
    this.cursorText = this.scene.add.text(optionX - 20, optionStartY, '>', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffff00',
    });
    this.cursorText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(this.cursorText);
  }

  private updateMenuCursor(): void {
    const menuHeight = 180;
    const menuY = (GAME_CONFIG.HEIGHT - menuHeight) / 2;
    const optionStartY = menuY + 55;

    this.cursorText.setY(optionStartY + this.menuSelection * 28);
  }

  private selectMenuItem(): void {
    const selected = this.menuOptions[this.menuSelection];

    switch (selected) {
      case 'Party':
        this.showPartyPanel();
        break;
      case 'Inventory':
        this.showPlaceholder('Inventory', 'Coming Soon!');
        break;
      case "Hrothgar's Battle Tactics":
        this.showPlaceholder("Hrothgar's Battle Tactics", 'Coming Soon!');
        break;
      case 'Close':
        this.close();
        break;
    }
  }

  private showPartyPanel(): void {
    this.currentView = 'party';
    this.hideMainMenu();

    this.partyPanel = new PartyStatsPanel(
      this.scene,
      this.heroState,
      this.heroesData,
      this.abilitiesData,
      this.cameraZoom
    );
  }

  private hidePartyPanel(): void {
    if (this.partyPanel) {
      this.partyPanel.destroy();
      this.partyPanel = null;
    }
  }

  private showPlaceholder(title: string, message: string): void {
    this.currentView = title === 'Inventory' ? 'inventory' : 'tactics';
    this.hideMainMenu();

    const uiScale = 1 / this.cameraZoom;
    this.placeholderContainer = this.scene.add.container(0, 0);
    this.placeholderContainer.setScale(uiScale);
    this.placeholderContainer.setDepth(1001);
    this.placeholderContainer.setScrollFactor(0);

    // Background
    const bg = this.scene.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      400,
      200,
      0x000000,
      0.95
    );
    this.placeholderContainer.add(bg);

    // Border
    const border = this.scene.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      400,
      200
    );
    border.setStrokeStyle(2, 0xffffff);
    border.setFillStyle(0x000000, 0);
    this.placeholderContainer.add(border);

    // Title
    const titleText = this.scene.add.text(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2 - 40,
      title,
      {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffff00',
      }
    );
    titleText.setOrigin(0.5, 0.5);
    titleText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.placeholderContainer.add(titleText);

    // Message
    const msgText = this.scene.add.text(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2 + 10,
      message,
      {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#888888',
      }
    );
    msgText.setOrigin(0.5, 0.5);
    msgText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.placeholderContainer.add(msgText);

    // Back hint
    const hintText = this.scene.add.text(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2 + 60,
      'Press ESC to go back',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#666666',
      }
    );
    hintText.setOrigin(0.5, 0.5);
    hintText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.placeholderContainer.add(hintText);
  }

  private hidePlaceholder(): void {
    if (this.placeholderContainer) {
      this.placeholderContainer.destroy(true);
      this.placeholderContainer = null;
    }
  }

  private hideMainMenu(): void {
    this.menuBackground.setVisible(false);
    this.menuBorder.setVisible(false);
    this.titleText.setVisible(false);
    this.cursorText.setVisible(false);
    this.menuTexts.forEach(t => t.setVisible(false));
  }

  private showMainMenu(): void {
    this.currentView = 'main';
    this.menuBackground.setVisible(true);
    this.menuBorder.setVisible(true);
    this.titleText.setVisible(true);
    this.cursorText.setVisible(true);
    this.menuTexts.forEach(t => t.setVisible(true));
  }

  /**
   * Open the menu
   */
  open(): void {
    if (this.isOpen) return;

    this.isOpen = true;
    this.currentView = 'main';
    this.menuSelection = 0;
    this.updateMenuCursor();
    this.container.setVisible(true);
    this.showMainMenu();
  }

  /**
   * Close the menu
   */
  close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.container.setVisible(false);
    this.hidePartyPanel();
    this.hidePlaceholder();
  }

  /**
   * Check if menu is currently open
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Update hero state (call after battles, etc.)
   */
  updateHeroState(heroState: Record<string, HeroState>): void {
    this.heroState = heroState;
  }

  /**
   * Handle input - call from scene's update()
   */
  handleInput(): boolean {
    if (!this.isOpen) {
      // Check for ESC to open
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.open();
        return true;
      }
      return false;
    }

    // Menu is open - handle based on current view
    if (this.currentView === 'main') {
      if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
        this.menuSelection = Math.max(0, this.menuSelection - 1);
        this.updateMenuCursor();
        return true;
      }
      if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
        this.menuSelection = Math.min(this.menuOptions.length - 1, this.menuSelection + 1);
        this.updateMenuCursor();
        return true;
      }
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectMenuItem();
        return true;
      }
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.close();
        return true;
      }
    } else if (this.currentView === 'party') {
      // Let party panel handle scrolling
      if (this.partyPanel) {
        this.partyPanel.handleInput(this.upKey, this.downKey);
      }
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.hidePartyPanel();
        this.showMainMenu();
        return true;
      }
    } else {
      // Placeholder views
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.hidePlaceholder();
        this.showMainMenu();
        return true;
      }
    }

    return true;
  }

  /**
   * Destroy the menu
   */
  destroy(): void {
    this.hidePartyPanel();
    this.hidePlaceholder();
    this.container.destroy(true);
  }
}
