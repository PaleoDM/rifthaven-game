// LevelUpOverlay - Displays level-up celebration with hero card and stat changes
import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { SaveManager } from '../systems/SaveManager';
import { BattleXPSummary } from '../systems/XPTracker';

interface LevelUpOverlayConfig {
  scene: Phaser.Scene;
  levelUps: BattleXPSummary[];
  onComplete: () => void;
}

export class LevelUpOverlay {
  private scene: Phaser.Scene;
  private levelUps: BattleXPSummary[];
  private onComplete: () => void;
  private container!: Phaser.GameObjects.Container;
  private currentIndex: number = 0;
  private waitingForInput: boolean = false;

  // Hero display names (Rifthaven heroes)
  private static heroNames: Record<string, string> = {
    arden: 'Arden',
    quin: 'Quin',
    veil: 'Veil',
    ty: 'Ty',
    thorn: 'Thorn',
  };

  // Level 3 abilities (Rifthaven heroes)
  private static level3Abilities: Record<string, string> = {
    arden: 'Shield of Faith',
    quin: 'Counterspell',
    veil: 'Shadow Step',
    ty: 'Flame Strike',
    thorn: 'Call Lightning',
  };

  constructor(config: LevelUpOverlayConfig) {
    this.scene = config.scene;
    this.levelUps = config.levelUps;
    this.onComplete = config.onComplete;
  }

  show(): void {
    // Create container for all overlay elements
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(3000);
    this.container.setScrollFactor(0);

    // Semi-transparent background
    const bg = this.scene.add.rectangle(
      this.scene.cameras.main.width / 2,
      this.scene.cameras.main.height / 2,
      this.scene.cameras.main.width,
      this.scene.cameras.main.height,
      0x000000,
      0.7
    );
    this.container.add(bg);

    // Gold camera flash
    this.scene.cameras.main.flash(500, 255, 215, 0, false);

    // Create gold sparkle particles
    this.createSparkles();

    // Show "LEVEL UP!" text animation
    this.showLevelUpText(() => {
      // After text animation, show first hero card
      this.showHeroCard(this.currentIndex);
    });
  }

  private createSparkles(): void {
    // Create a simple gold particle texture if it doesn't exist
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(0xffd700);
    graphics.fillCircle(4, 4, 4);
    graphics.generateTexture('gold_sparkle', 8, 8);
    graphics.destroy();

    // Create particle emitter
    const particles = this.scene.add.particles(0, 0, 'gold_sparkle', {
      x: { min: 0, max: this.scene.cameras.main.width },
      y: { min: 0, max: this.scene.cameras.main.height },
      lifespan: 2000,
      speed: { min: 50, max: 150 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      frequency: 100,
      quantity: 2,
    });
    particles.setScrollFactor(0);
    particles.setDepth(3001);
    this.container.add(particles);
  }

  private showLevelUpText(onComplete: () => void): void {
    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;

    const levelUpText = this.scene.add.text(screenWidth / 2, screenHeight / 2 - 100, 'LEVEL UP!', {
      fontFamily: 'monospace',
      fontSize: '56px',
      color: '#ffd700',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    levelUpText.setOrigin(0.5);
    levelUpText.setScale(0);
    levelUpText.setAlpha(0);
    levelUpText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(levelUpText);

    // Scale in and pulse animation
    this.scene.tweens.add({
      targets: levelUpText,
      scale: 1,
      alpha: 1,
      duration: 400,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Pulse effect
        this.scene.tweens.add({
          targets: levelUpText,
          scale: 1.15,
          duration: 200,
          yoyo: true,
          repeat: 1,
          onComplete: () => {
            // Move up and fade slightly
            this.scene.tweens.add({
              targets: levelUpText,
              y: 50,
              scale: 0.7,
              duration: 400,
              onComplete: () => {
                onComplete();
              },
            });
          },
        });
      },
    });
  }

  private showHeroCard(index: number): void {
    const levelUp = this.levelUps[index];
    const heroId = levelUp.heroId;
    const heroName = LevelUpOverlay.heroNames[heroId] || heroId;
    const heroesData = this.scene.cache.json.get('data_heroes');
    const heroData = heroesData?.[heroId];

    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;

    // Card dimensions
    const cardWidth = 350;
    const cardHeight = 320;
    const cardX = screenWidth / 2 - cardWidth / 2;
    const cardY = screenHeight / 2 - cardHeight / 2 + 30;

    // Card background with gold border (for level up)
    const cardBg = this.scene.add.rectangle(
      cardX + cardWidth / 2,
      cardY + cardHeight / 2,
      cardWidth,
      cardHeight,
      0x1a1a2e,
      0.95
    );
    this.container.add(cardBg);

    // Gold border
    const cardBorder = this.scene.add.rectangle(
      cardX + cardWidth / 2,
      cardY + cardHeight / 2,
      cardWidth,
      cardHeight,
      0xffd700,
      0
    ).setStrokeStyle(4, 0xffd700);
    this.container.add(cardBorder);

    // Portrait
    const portrait = this.scene.add.image(
      cardX + 70,
      cardY + 70,
      `portrait_${heroId}`
    );
    portrait.setDisplaySize(100, 100);
    this.container.add(portrait);

    // Hero name and new level
    const nameText = this.scene.add.text(cardX + 140, cardY + 25, heroName, {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    nameText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(nameText);

    const levelText = this.scene.add.text(cardX + 140, cardY + 60, `Level ${levelUp.newLevel}`, {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#ffd700',
    });
    levelText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(levelText);

    // Class info
    if (heroData) {
      const classText = this.scene.add.text(cardX + 140, cardY + 90, `${heroData.race} ${heroData.class}`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#aaaaaa',
      });
      classText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.container.add(classText);
    }

    // Stat changes section
    const statsY = cardY + 140;

    const statsHeader = this.scene.add.text(cardX + 20, statsY, 'Stat Growth:', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#888888',
    });
    statsHeader.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(statsHeader);

    // Calculate stat changes
    const prevLevel = levelUp.previousLevel;
    const newLevel = levelUp.newLevel;

    const prevHp = SaveManager.getMaxHp(heroId, prevLevel);
    const newHp = SaveManager.getMaxHp(heroId, newLevel);
    const hpGain = newHp - prevHp;

    const prevMana = SaveManager.getMaxMana(heroId, prevLevel);
    const newMana = SaveManager.getMaxMana(heroId, newLevel);
    const manaGain = (newMana !== null && prevMana !== null) ? newMana - prevMana : 0;

    let prevKi = 0, newKi = 0, kiGain = 0;
    if (heroId === 'vicas') {
      prevKi = SaveManager.getMaxKi(prevLevel);
      newKi = SaveManager.getMaxKi(newLevel);
      kiGain = newKi - prevKi;
    }

    // HP stat line
    let statLineY = statsY + 30;
    this.addStatLine(cardX + 30, statLineY, 'HP', prevHp, newHp, hpGain, 0x44ff44);
    statLineY += 28;

    // Mana or Ki stat line
    if (heroId === 'vicas') {
      this.addStatLine(cardX + 30, statLineY, 'Ki', prevKi, newKi, kiGain, 0xffaa00);
    } else if (manaGain > 0 || (newMana !== null && newMana > 0)) {
      this.addStatLine(cardX + 30, statLineY, 'Mana', prevMana || 0, newMana || 0, manaGain, 0x4488ff);
    }
    statLineY += 35;

    // New ability section (level 3 only)
    if (newLevel === 3) {
      const newAbility = LevelUpOverlay.level3Abilities[heroId];
      if (newAbility) {
        const abilityHeader = this.scene.add.text(cardX + 20, statLineY, 'New Ability Learned:', {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#888888',
        });
        abilityHeader.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.container.add(abilityHeader);

        const abilityText = this.scene.add.text(cardX + 30, statLineY + 25, newAbility, {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#ff88ff',
          fontStyle: 'bold',
        });
        abilityText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
        this.container.add(abilityText);

        // Add sparkle effect to ability text
        this.scene.tweens.add({
          targets: abilityText,
          alpha: 0.6,
          duration: 500,
          yoyo: true,
          repeat: -1,
        });
      }
    }

    // Continue prompt
    const promptY = cardY + cardHeight - 25;
    const promptText = this.scene.add.text(
      cardX + cardWidth / 2,
      promptY,
      index < this.levelUps.length - 1 ? 'Press ENTER for next hero...' : 'Press ENTER to continue...',
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888888',
      }
    );
    promptText.setOrigin(0.5);
    promptText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(promptText);

    // Pulse the prompt
    this.scene.tweens.add({
      targets: promptText,
      alpha: 0.4,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    // Enable input after a short delay
    this.scene.time.delayedCall(500, () => {
      this.waitingForInput = true;
    });
  }

  private addStatLine(x: number, y: number, label: string, oldValue: number, newValue: number, gain: number, _color: number): void {
    // Label
    const labelText = this.scene.add.text(x, y, label, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    });
    labelText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(labelText);

    // Old value -> New value
    const valueText = this.scene.add.text(x + 60, y, `${oldValue} → ${newValue}`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    });
    valueText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    this.container.add(valueText);

    // Green +X indicator
    if (gain > 0) {
      const gainText = this.scene.add.text(x + 180, y, `+${gain}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#44ff44',
        fontStyle: 'bold',
      });
      gainText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      this.container.add(gainText);

      // Bounce animation for the gain indicator
      this.scene.tweens.add({
        targets: gainText,
        y: y - 5,
        duration: 300,
        yoyo: true,
        repeat: 2,
        ease: 'Bounce.easeOut',
      });
    }
  }

  handleInput(): void {
    if (!this.waitingForInput) return;

    this.waitingForInput = false;
    this.currentIndex++;

    if (this.currentIndex < this.levelUps.length) {
      // Clear current card and show next
      this.clearCard();
      this.showHeroCard(this.currentIndex);
    } else {
      // All done, clean up and call completion callback
      this.destroy();
      this.onComplete();
    }
  }

  private clearCard(): void {
    // Remove all elements except background and sparkles (indices 0-2)
    const elementsToRemove = this.container.list.slice(3);
    elementsToRemove.forEach((element) => {
      if (element instanceof Phaser.GameObjects.GameObject) {
        element.destroy();
      }
    });
  }

  destroy(): void {
    if (this.container) {
      this.container.destroy(true);
    }
  }

  isWaitingForInput(): boolean {
    return this.waitingForInput;
  }
}
