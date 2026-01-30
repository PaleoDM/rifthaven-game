import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';

export interface ProgressBarConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: number;
  backgroundColor?: number;
  borderColor?: number;
  borderWidth?: number;
  showText?: boolean;
  textFormat?: 'fraction' | 'percent';
}

/**
 * Reusable progress bar component for HP, MP, XP displays
 */
export class ProgressBar {
  private scene: Phaser.Scene;
  private x: number;
  private y: number;
  private width: number;
  private height: number;
  private fillColor: number;
  private backgroundColor: number;
  private borderColor: number;
  private borderWidth: number;
  private showText: boolean;
  private textFormat: 'fraction' | 'percent';

  private background: Phaser.GameObjects.Rectangle;
  private fill: Phaser.GameObjects.Rectangle;
  private border: Phaser.GameObjects.Rectangle;
  private text?: Phaser.GameObjects.Text;

  private currentValue: number = 0;
  private maxValue: number = 100;

  constructor(scene: Phaser.Scene, config: ProgressBarConfig) {
    this.scene = scene;
    this.x = config.x;
    this.y = config.y;
    this.width = config.width;
    this.height = config.height;
    this.fillColor = config.fillColor ?? 0x00ff00;
    this.backgroundColor = config.backgroundColor ?? 0x333333;
    this.borderColor = config.borderColor ?? 0xffffff;
    this.borderWidth = config.borderWidth ?? 1;
    this.showText = config.showText ?? false;
    this.textFormat = config.textFormat ?? 'fraction';

    // Create border (behind everything)
    this.border = scene.add.rectangle(
      this.x + this.width / 2,
      this.y + this.height / 2,
      this.width + this.borderWidth * 2,
      this.height + this.borderWidth * 2,
      this.borderColor
    );

    // Create background
    this.background = scene.add.rectangle(
      this.x + this.width / 2,
      this.y + this.height / 2,
      this.width,
      this.height,
      this.backgroundColor
    );

    // Create fill bar (starts at 0 width)
    this.fill = scene.add.rectangle(
      this.x,
      this.y + this.height / 2,
      0,
      this.height - 2,
      this.fillColor
    );
    this.fill.setOrigin(0, 0.5);

    // Create text if enabled
    if (this.showText) {
      this.text = scene.add.text(
        this.x + this.width / 2,
        this.y + this.height / 2,
        '',
        {
          fontFamily: 'monospace',
          fontSize: `${Math.max(this.height - 4, 8)}px`,
          color: '#ffffff',
        }
      );
      this.text.setOrigin(0.5, 0.5);
      this.text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
    }
  }

  /**
   * Set the current and max values
   */
  setValue(current: number, max: number): void {
    this.currentValue = Math.max(0, current);
    this.maxValue = Math.max(1, max);
    this.updateDisplay();
  }

  /**
   * Update the fill bar color
   */
  setFillColor(color: number): void {
    this.fillColor = color;
    this.fill.setFillStyle(color);
  }

  /**
   * Update visual display based on current values
   */
  private updateDisplay(): void {
    const percentage = Math.min(this.currentValue / this.maxValue, 1);
    const fillWidth = Math.max(0, (this.width - 2) * percentage);

    this.fill.setSize(fillWidth, this.height - 2);

    if (this.text) {
      if (this.textFormat === 'fraction') {
        this.text.setText(`${Math.floor(this.currentValue)}/${this.maxValue}`);
      } else {
        this.text.setText(`${Math.floor(percentage * 100)}%`);
      }
    }
  }

  /**
   * Animate the bar to a new value
   */
  animateTo(current: number, max: number, duration: number = 300): void {
    const startValue = this.currentValue;
    this.maxValue = Math.max(1, max);

    this.scene.tweens.add({
      targets: { value: startValue },
      value: current,
      duration,
      ease: 'Power2',
      onUpdate: (tween) => {
        const obj = tween.targets[0] as { value: number };
        this.currentValue = obj.value;
        this.updateDisplay();
      },
    });
  }

  /**
   * Flash the bar with a color (for level up, etc.)
   */
  flash(color: number, duration: number = 200): void {
    const originalColor = this.fillColor;
    this.fill.setFillStyle(color);

    this.scene.time.delayedCall(duration, () => {
      this.fill.setFillStyle(originalColor);
    });
  }

  /**
   * Set the position of the progress bar
   */
  setPosition(x: number, y: number): void {
    const dx = x - this.x;
    const dy = y - this.y;

    this.x = x;
    this.y = y;

    this.border.setPosition(this.border.x + dx, this.border.y + dy);
    this.background.setPosition(this.background.x + dx, this.background.y + dy);
    this.fill.setPosition(this.fill.x + dx, this.fill.y + dy);
    if (this.text) {
      this.text.setPosition(this.text.x + dx, this.text.y + dy);
    }
  }

  /**
   * Set visibility of the progress bar
   */
  setVisible(visible: boolean): void {
    this.border.setVisible(visible);
    this.background.setVisible(visible);
    this.fill.setVisible(visible);
    if (this.text) {
      this.text.setVisible(visible);
    }
  }

  /**
   * Set scroll factor (for UI elements that shouldn't scroll)
   */
  setScrollFactor(factor: number): void {
    this.border.setScrollFactor(factor);
    this.background.setScrollFactor(factor);
    this.fill.setScrollFactor(factor);
    if (this.text) {
      this.text.setScrollFactor(factor);
    }
  }

  /**
   * Set depth for layering
   */
  setDepth(depth: number): void {
    this.border.setDepth(depth);
    this.background.setDepth(depth + 1);
    this.fill.setDepth(depth + 2);
    if (this.text) {
      this.text.setDepth(depth + 3);
    }
  }

  /**
   * Add all elements to a container
   */
  addToContainer(container: Phaser.GameObjects.Container): void {
    container.add(this.border);
    container.add(this.background);
    container.add(this.fill);
    if (this.text) {
      container.add(this.text);
    }
  }

  /**
   * Destroy the progress bar
   */
  destroy(): void {
    this.border.destroy();
    this.background.destroy();
    this.fill.destroy();
    if (this.text) {
      this.text.destroy();
    }
  }
}
