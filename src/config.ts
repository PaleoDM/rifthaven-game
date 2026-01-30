// Game configuration constants

export const GAME_CONFIG = {
  // Display
  WIDTH: 800,
  HEIGHT: 600,

  // Grid
  TILE_SIZE: 32,
  SPRITE_SIZE: 512,
  PORTRAIT_SIZE: 96,

  // Colors
  GRID_COLOR: 0xffffff,
  GRID_ALPHA: 0.15,

  // UI
  DIALOGUE_BG_COLOR: 0x000000,
  DIALOGUE_BG_ALPHA: 0.85,
  DIALOGUE_BORDER_COLOR: 0xffffff,

  // Text rendering - higher resolution for crisp text despite pixelArt: true
  // Value of 2 renders text at 2x resolution while maintaining display size
  TEXT_RESOLUTION: 2,
} as const;
