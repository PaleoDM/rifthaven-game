import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Boot scene loads minimal assets needed for the preload screen
    // For now, we just transition immediately
  }

  create(): void {
    // Transition to preload scene
    this.scene.start('PreloadScene');
  }
}
