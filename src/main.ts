import Phaser from 'phaser';
import { GAME_CONFIG } from './config';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { TitleScene } from './scenes/TitleScene';
import { NarratorScene } from './scenes/NarratorScene';
import { SparkworksScene } from './scenes/SparkworksScene';
import { SparkworksUndergroundScene } from './scenes/SparkworksUndergroundScene';
import { BattleScene } from './scenes/BattleScene';
import { TerrainEditorScene } from './scenes/TerrainEditorScene';
import { MenuScene } from './scenes/MenuScene';
import { ExploreScene } from './scenes/ExploreScene';
import { OpeningCutsceneScene } from './scenes/OpeningCutsceneScene';

// Check URL parameters for special modes
const urlParams = new URLSearchParams(window.location.search);
const editorParam = urlParams.get('editor');
const isEditorMode = editorParam !== null; // ?editor or ?editor=mapname
const editorMap = editorParam && editorParam !== 'true' ? editorParam : null; // specific map to open
const isBattleTest = urlParams.get('battle') === 'true';
const isTravelTest = urlParams.get('travel') === 'true';
const isMenuTest = urlParams.get('menu') === 'true';
const battleMap = urlParams.get('map') || 'abandoned_distillery'; // Optional: specify which battle

// Determine which scenes to load based on mode
let scenes: Phaser.Types.Scenes.SceneType[];
let gameWidth: number = GAME_CONFIG.WIDTH;
let gameHeight: number = GAME_CONFIG.HEIGHT;

if (isEditorMode) {
  scenes = [TerrainEditorScene];
  gameWidth = 1200;
  gameHeight = 800;
} else if (isMenuTest) {
  // Menu test mode: PreloadScene loads assets, then jumps directly to MenuScene
  scenes = [BootScene, PreloadScene, NarratorScene, MenuScene];
} else if (isBattleTest) {
  // Battle test mode: PreloadScene loads assets, then jumps to BattleScene
  scenes = [BootScene, PreloadScene, NarratorScene, BattleScene, SparkworksScene, MenuScene];
} else if (isTravelTest) {
  // Travel test mode: PreloadScene loads assets, then jumps to SparkworksScene
  scenes = [BootScene, PreloadScene, NarratorScene, OpeningCutsceneScene, SparkworksScene, SparkworksUndergroundScene, BattleScene, ExploreScene, MenuScene];
} else {
  // Normal game flow
  scenes = [BootScene, PreloadScene, TitleScene, NarratorScene, OpeningCutsceneScene, SparkworksScene, SparkworksUndergroundScene, BattleScene, ExploreScene, MenuScene];
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: gameWidth,
  height: gameHeight,
  parent: 'game-container',
  backgroundColor: '#000000',
  pixelArt: true, // Crucial for 16-bit aesthetic - no antialiasing
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: scenes,
};

const game = new Phaser.Game(config);

// Store test params in registry for scenes to access
if (isBattleTest) {
  game.registry.set('battleTestMode', true);
  game.registry.set('battleMap', battleMap);
}
if (isTravelTest) {
  game.registry.set('travelTestMode', true);
}
if (isMenuTest) {
  game.registry.set('menuTestMode', true);
}
if (isEditorMode && editorMap) {
  game.registry.set('editorMap', editorMap);
}
