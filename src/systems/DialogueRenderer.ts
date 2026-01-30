import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';

export class DialogueRenderer {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private background: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private dialogueText: Phaser.GameObjects.Text;
  private continueIndicator: Phaser.GameObjects.Text;
  private portrait: Phaser.GameObjects.Image | null = null;

  private lines: string[] = [];
  private currentLineIndex: number = 0;
  private onComplete?: () => void;
  private isActive: boolean = false;

  // Dialogue box positioning within container (relative coords)
  // These are the positions within the container, starting at (0, 0)
  private boxX = 0;
  private boxY = 0;
  private readonly boxWidth = 320;
  private readonly boxHeight = 110;
  private readonly padding = 10;

  // Portrait positioning - above the dialogue box (within container)
  private portraitX = 0;
  private portraitY = -150;
  private readonly portraitMaxHeight = 140;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Create container for all dialogue elements
    this.container = scene.add.container(0, 0);

    // Create semi-transparent background
    this.background = scene.add.graphics();
    this.background.fillStyle(GAME_CONFIG.DIALOGUE_BG_COLOR, GAME_CONFIG.DIALOGUE_BG_ALPHA);
    this.background.fillRoundedRect(this.boxX, this.boxY, this.boxWidth, this.boxHeight, 8);
    this.background.lineStyle(2, GAME_CONFIG.DIALOGUE_BORDER_COLOR, 1);
    this.background.strokeRoundedRect(this.boxX, this.boxY, this.boxWidth, this.boxHeight, 8);

    // Create speaker name text
    this.nameText = scene.add.text(this.boxX + this.padding, this.boxY + this.padding, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffff00',
      fontStyle: 'bold',
    });
    this.nameText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Create dialogue text
    this.dialogueText = scene.add.text(
      this.boxX + this.padding,
      this.boxY + this.padding + 20,
      '',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        wordWrap: { width: this.boxWidth - this.padding * 2 },
        lineSpacing: 4,
      }
    );
    this.dialogueText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Create continue indicator
    this.continueIndicator = scene.add.text(
      this.boxX + this.boxWidth - this.padding - 15,
      this.boxY + this.boxHeight - this.padding - 8,
      '▼',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
      }
    );
    this.continueIndicator.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Add all elements to container
    this.container.add([
      this.background,
      this.nameText,
      this.dialogueText,
      this.continueIndicator,
    ]);

    // Start hidden
    this.container.setVisible(false);

    // Animate the continue indicator
    scene.tweens.add({
      targets: this.continueIndicator,
      alpha: 0.3,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });
  }

  startDialogue(lines: string[], speaker: string, onComplete?: () => void, portraitKey?: string): void {
    this.lines = lines;
    this.currentLineIndex = 0;
    this.onComplete = onComplete;
    this.isActive = true;

    this.nameText.setText(speaker);

    // Handle portrait
    if (this.portrait) {
      this.portrait.destroy();
      this.portrait = null;
    }

    if (portraitKey && this.scene.textures.exists(portraitKey)) {
      this.portrait = this.scene.add.image(this.portraitX, this.portraitY, portraitKey);
      this.portrait.setOrigin(0, 0);

      // Use setDisplaySize for crisp rendering at any resolution while maintaining aspect ratio
      const aspectRatio = this.portrait.width / this.portrait.height;
      const displayHeight = this.portraitMaxHeight;
      const displayWidth = displayHeight * aspectRatio;
      this.portrait.setDisplaySize(displayWidth, displayHeight);

      // Add to container and set scroll factor
      this.container.add(this.portrait);
      this.container.sendToBack(this.portrait);
    }

    this.container.setVisible(true);
    this.showCurrentLine();
  }

  showStatic(text: string, speaker: string): void {
    this.isActive = false;
    this.nameText.setText(speaker);

    // Check for italic formatting (*text*)
    if (text.startsWith('*') && text.endsWith('*')) {
      text = text.slice(1, -1);
      this.dialogueText.setFontStyle('italic');
    } else {
      this.dialogueText.setFontStyle('normal');
    }

    this.dialogueText.setText(text);
    this.continueIndicator.setVisible(false);
    this.container.setVisible(true);
  }

  private showCurrentLine(): void {
    if (this.currentLineIndex < this.lines.length) {
      let text = this.lines[this.currentLineIndex];

      // Check for italic formatting (*text*)
      if (text.startsWith('*') && text.endsWith('*')) {
        text = text.slice(1, -1);
        this.dialogueText.setFontStyle('italic');
      } else {
        this.dialogueText.setFontStyle('normal');
      }

      this.dialogueText.setText(text);
      this.continueIndicator.setVisible(true);
    }
  }

  advance(): void {
    if (!this.isActive) return;

    this.currentLineIndex++;

    if (this.currentLineIndex >= this.lines.length) {
      // Dialogue complete
      this.isActive = false;
      this.container.setVisible(false);
      if (this.onComplete) {
        this.onComplete();
      }
    } else {
      this.showCurrentLine();
    }
  }

  hide(): void {
    this.container.setVisible(false);
    this.isActive = false;
  }

  isDialogueActive(): boolean {
    return this.isActive;
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  setScrollFactor(factor: number): void {
    this.container.setScrollFactor(factor);
  }

  // Position the dialogue relative to a world position (e.g., the player)
  // Offset is how far from the target to place the top-left of the dialogue box
  // Automatically flips to below if portrait would be cut off at top of screen
  positionRelativeTo(targetX: number, targetY: number, offsetX: number, offsetY: number): void {
    const newX = targetX + offsetX;
    let newY = targetY + offsetY;

    // Check if the portrait would be cut off at the top of the camera view
    const camera = this.scene.cameras.main;
    const cameraTop = camera.worldView.y;

    // Portrait top in world coords = container Y + portrait relative Y (-150)
    const portraitTopWorld = newY + this.portraitY;

    // If portrait would be cut off, flip dialogue to below the target
    if (portraitTopWorld < cameraTop) {
      // Position below: target + some padding to clear the character sprite
      newY = targetY + 40;
    }

    this.container.setPosition(newX, newY);
  }

  setPosition(x: number, y: number): void {
    this.boxX = x;
    this.boxY = y;

    // Update portrait position to stay above the box
    this.portraitX = x;
    this.portraitY = y - this.portraitMaxHeight - 10; // 10px gap above box

    // Rebuild background
    this.background.clear();
    this.background.fillStyle(GAME_CONFIG.DIALOGUE_BG_COLOR, GAME_CONFIG.DIALOGUE_BG_ALPHA);
    this.background.fillRoundedRect(this.boxX, this.boxY, this.boxWidth, this.boxHeight, 8);
    this.background.lineStyle(2, GAME_CONFIG.DIALOGUE_BORDER_COLOR, 1);
    this.background.strokeRoundedRect(this.boxX, this.boxY, this.boxWidth, this.boxHeight, 8);

    // Reposition text elements
    this.nameText.setPosition(this.boxX + this.padding, this.boxY + this.padding);
    this.dialogueText.setPosition(this.boxX + this.padding, this.boxY + this.padding + 20);
    this.continueIndicator.setPosition(
      this.boxX + this.boxWidth - this.padding - 15,
      this.boxY + this.boxHeight - this.padding - 8
    );

    // Reposition portrait if it exists
    if (this.portrait) {
      this.portrait.setPosition(this.portraitX, this.portraitY);
    }
  }

  setPortraitPosition(x: number, y: number): void {
    this.portraitX = x;
    this.portraitY = y;
    if (this.portrait) {
      this.portrait.setPosition(x, y);
    }
  }
}
