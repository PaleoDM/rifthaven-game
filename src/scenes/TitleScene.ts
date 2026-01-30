import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';

/**
 * Title screen - displays game logo and credits before main menu
 */
export class TitleScene extends Phaser.Scene {
  private enterKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    // Black background
    this.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      GAME_CONFIG.WIDTH,
      GAME_CONFIG.HEIGHT,
      0x000000
    );

    // Title screen image centered at 50% scale
    const titleImage = this.add.image(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2 - 40,
      'title_screen'
    );
    titleImage.setOrigin(0.5, 0.5);
    titleImage.setScale(0.5);

    // "Press Enter to Play" text
    const playText = this.add.text(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT - 80,
      'Press Enter to Play',
      {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
      }
    );
    playText.setOrigin(0.5, 0.5);
    playText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Pulsing effect on the play text
    this.tweens.add({
      targets: playText,
      alpha: 0.5,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Credit text
    const creditText = this.add.text(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT - 50,
      'By Carlos Mauricio Peredo',
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
      }
    );
    creditText.setOrigin(0.5, 0.5);
    creditText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Setup input
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  }

  update(): void {
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.scene.start('NarratorScene');
    }
  }
}
