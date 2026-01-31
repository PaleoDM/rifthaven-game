import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { InventoryState } from '../data/ItemTypes';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload(): void {
    // Create loading bar
    const width = GAME_CONFIG.WIDTH;
    const height = GAME_CONFIG.HEIGHT;

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

    const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    });
    loadingText.setOrigin(0.5, 0.5);
    loadingText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Update progress bar as assets load
    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    // Load all game assets here
    this.loadAssets();
  }

  private loadAssets(): void {
    // Portraits - Main Heroes
    this.load.image('portrait_miss_tibbets', 'assets/portraits/miss_tibbets.png');
    this.load.image('portrait_arden', 'assets/portraits/arden.png');
    this.load.image('portrait_quin', 'assets/portraits/quin.png');
    this.load.image('portrait_veil', 'assets/portraits/veil.png');
    this.load.image('portrait_ty', 'assets/portraits/ty.png');
    this.load.image('portrait_thorn', 'assets/portraits/thorn.png');
    // Potential 6th heroes
    this.load.image('portrait_freddie', 'assets/portraits/freddie.png');
    this.load.image('portrait_leon', 'assets/portraits/leon.png');
    // NPCs
    this.load.image('portrait_dante', 'assets/portraits/dante.png');
    this.load.image('portrait_sister_elarra', 'assets/portraits/sister_elarra.png');

    // Title screen
    this.load.image('title_screen', 'assets/title_screen.png');

    // Maps
    this.load.image('map_abandoned_distillery', 'assets/maps/abandoned_distillery.png');
    this.load.image('map_sparkworks', 'assets/maps/sparkworks.png');
    this.load.image('map_street', 'assets/maps/street.png');
    this.load.image('map_allfather_chapel', 'assets/maps/allfather_chapel.png');
    // this.load.image('map_sparkworks_underground', 'assets/maps/sparkworks_underground.png'); // TODO: Add underground map

    // Hero sprites (4 directions each)
    const heroes = ['arden', 'quin', 'veil', 'ty', 'thorn', 'freddie', 'leon'];
    const directions = ['front', 'back', 'left', 'right'];

    heroes.forEach((hero) => {
      directions.forEach((dir) => {
        this.load.image(`sprite_${hero}_${dir}`, `assets/sprites/heroes/${hero}_${dir}.png`);
      });
    });

    // NPC sprites
    this.load.image('sprite_guard_front', 'assets/sprites/npcs/guard_front.png');
    this.load.image('sprite_guard_back', 'assets/sprites/npcs/guard_back.png');
    this.load.image('sprite_guard_left', 'assets/sprites/npcs/guard_left.png');
    this.load.image('sprite_guard_right', 'assets/sprites/npcs/guard_right.png');
    this.load.image('sprite_villager_male_front', 'assets/sprites/npcs/villager_male_front.png');
    this.load.image('sprite_villager_female_front', 'assets/sprites/npcs/villager_female_front.png');
    this.load.image('sprite_child_male_front', 'assets/sprites/npcs/child_male_front.png');
    this.load.image('sprite_child_female_front', 'assets/sprites/npcs/child_female_front.png');

    // Dante NPC (for dialogue)
    this.load.image('sprite_dante_front', 'assets/sprites/npcs/dante_front.png');
    this.load.image('sprite_dante_back', 'assets/sprites/npcs/dante_back.png');
    this.load.image('sprite_dante_left', 'assets/sprites/npcs/dante_left.png');
    this.load.image('sprite_dante_right', 'assets/sprites/npcs/dante_right.png');

    // Sister Elarra NPC (Ashen Chapel)
    this.load.image('sprite_sister_elarra_front', 'assets/sprites/npcs/sister_elarra_front.png');
    this.load.image('sprite_sister_elarra_back', 'assets/sprites/npcs/sister_elarra_back.png');
    this.load.image('sprite_sister_elarra_left', 'assets/sprites/npcs/sister_elarra_left.png');
    this.load.image('sprite_sister_elarra_right', 'assets/sprites/npcs/sister_elarra_right.png');

    // Moradin Shrine (Ashen Chapel)
    this.load.image('sprite_moradin_shrine_front', 'assets/sprites/npcs/moradin_shrine_front.png');
    this.load.image('sprite_moradin_shrine_back', 'assets/sprites/npcs/moradin_shrine_back.png');
    this.load.image('sprite_moradin_shrine_left', 'assets/sprites/npcs/moradin_shrine_left.png');
    this.load.image('sprite_moradin_shrine_right', 'assets/sprites/npcs/moradin_shrine_right.png');

    // Object sprites (chests, etc.) - 4 directions
    this.load.image('sprite_chest_closed_front', 'assets/sprites/objects/chest_closed_front.png');
    this.load.image('sprite_chest_closed_back', 'assets/sprites/objects/chest_closed_back.png');
    this.load.image('sprite_chest_closed_left', 'assets/sprites/objects/chest_closed_left.png');
    this.load.image('sprite_chest_closed_right', 'assets/sprites/objects/chest_closed_right.png');

    // Data files
    this.load.json('data_heroes', 'data/heroes.json');
    this.load.json('data_map_sparkworks', 'data/maps/sparkworks.json');
    this.load.json('data_map_sparkworks_underground', 'data/maps/sparkworks_underground.json');

    // Battle system data
    this.load.json('data_enemies', 'data/enemies.json');
    this.load.json('data_abilities', 'data/abilities.json');
    this.load.json('data_items', 'data/items.json');
    this.load.json('data_battle_abandoned_distillery', 'data/battles/abandoned_distillery.json');
    this.load.json('data_battle_street', 'data/battles/street.json');
    this.load.json('data_battle_sparkworks_street', 'data/battles/sparkworks_street.json');
    this.load.json('data_battle_allfather_chapel', 'data/battles/allfather_chapel.json');
    this.load.json('data_battle_ashen_chapel', 'data/battles/ashen_chapel.json');

    // Audio / Music
    this.load.audio('music_title', 'assets/audio/title_screen.mp3');
    this.load.audio('music_town', 'assets/audio/town_scenes.mp3');
    this.load.audio('music_travel', 'assets/audio/travel_explore.mp3');
    this.load.audio('music_combat', 'assets/audio/combat.mp3');

    // Enemy sprites (4 directions each)
    // Cultists faction
    const cultists = ['cultist_caster', 'cultist_enforcer', 'cultist_mook'];
    // Ledgermen faction
    const ledgermen = ['ledgerman_enforcer', 'ledgerman_mook', 'ledgerman_hexer'];
    const enemies = [...cultists, ...ledgermen];
    const enemyDirections = ['front', 'back', 'left', 'right'];

    enemies.forEach((enemy) => {
      enemyDirections.forEach((dir) => {
        this.load.image(`sprite_${enemy}_${dir}`, `assets/sprites/enemies/${enemy}_${dir}.png`);
      });
    });
  }

  create(): void {
    // Set LINEAR filtering on portrait textures for smooth downscaling
    // (The game uses pixelArt: true globally, which is NEAREST - great for sprites, but
    // makes high-res portraits look blocky. This overrides just the portraits.)
    const portraitKeys = [
      'portrait_miss_tibbets',
      'portrait_arden',
      'portrait_quin',
      'portrait_veil',
      'portrait_ty',
      'portrait_thorn',
      'portrait_freddie',
      'portrait_leon',
      'portrait_dante',
    ];
    portraitKeys.forEach((key) => {
      const texture = this.textures.get(key);
      if (texture) {
        // Set filter mode via texture API
        texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        // Also directly set scaleMode on texture source for more reliable override of pixelArt: true
        const source = texture.source[0];
        if (source) {
          source.scaleMode = Phaser.ScaleModes.LINEAR;
          // If WebGL renderer, also update the GL texture filter
          if (source.glTexture && this.game.renderer.type === Phaser.WEBGL) {
            (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).setTextureFilter(
              source.glTexture,
              Phaser.Textures.FilterMode.LINEAR
            );
          }
        }
      }
    });

    // Check if we're in a test mode
    const isBattleTest = this.registry.get('battleTestMode');
    const isTravelTest = this.registry.get('travelTestMode');
    const isMenuTest = this.registry.get('menuTestMode');

    if (isMenuTest) {
      // Jump straight to menu scene with test party (all 5 heroes)
      const testHeroState = {
        arden: { level: 2, xp: 75, currentHp: 18, currentMana: 8, equipment: 'ambushers_ring' as const },
        quin: { level: 1, xp: 30, currentHp: 12, currentMana: null, currentKi: 10, equipment: 'swift_anklet' as const },
        veil: { level: 1, xp: 45, currentHp: 8, currentMana: 15, equipment: 'healers_pendant' as const },
        ty: { level: 1, xp: 20, currentHp: 10, currentMana: 10 },
        thorn: { level: 1, xp: 15, currentHp: 14, currentMana: null, permanentBonuses: { damageBonus: 2 } },
      };
      const testInventory: InventoryState = {
        consumables: {
          healing_potion: 5,
          distilled_dendritium: 2,
          antidote: 1,
          celestial_tears: 1,
        },
        equipment: {
          unequipped: ['wardstone', 'bloodstone'],
          obtained: ['ambushers_ring', 'swift_anklet', 'healers_pendant', 'wardstone', 'bloodstone'],
        },
        damageRunes: 1,
      };
      this.scene.start('MenuScene', {
        heroState: testHeroState,
        returnScene: 'PreloadScene',
        inventory: testInventory,
      });
    } else if (isBattleTest) {
      // Jump straight to battle scene (dev mode enabled for testing)
      const battleMap = this.registry.get('battleMap') || 'abandoned_distillery';

      // Create test inventory with items for testing
      const testInventory: InventoryState = {
        consumables: {
          healing_potion: 3,
          distilled_dendritium: 2,
          antidote: 2,
          celestial_tears: 1,
        },
        equipment: {
          unequipped: [],
          obtained: ['swift_anklet', 'ambushers_ring', 'healers_pendant', 'wardstone', 'bloodstone'],
        },
        damageRunes: 1,
      };

      // Create test hero state with equipment for testing
      const testHeroState = {
        arden: { level: 2, xp: 75, currentHp: 18, currentMana: null, currentKi: 10, equipment: 'ambushers_ring' as const },
        quin: { level: 1, xp: 30, currentHp: 12, currentMana: null, currentKi: 10, equipment: 'swift_anklet' as const },
        veil: { level: 1, xp: 45, currentHp: 10, currentMana: 15, equipment: 'healers_pendant' as const },
        ty: { level: 1, xp: 20, currentHp: 10, currentMana: 10, equipment: 'wardstone' as const },
        thorn: { level: 1, xp: 15, currentHp: 14, currentMana: null, equipment: 'bloodstone' as const },
      };

      this.scene.start('BattleScene', {
        battleMap: battleMap,
        heroId: 'arden',
        devMode: true,
        inventory: testInventory,
        heroState: testHeroState,
        returnScene: 'SparkworksScene',
      });
    } else if (isTravelTest) {
      // Jump straight to Sparkworks scene for testing
      this.scene.start('SparkworksScene', {
        heroId: 'arden',
      });
    } else {
      // Normal game flow - show launch button to unlock audio context
      this.showLaunchButton();
    }
  }

  private showLaunchButton(): void {
    const width = GAME_CONFIG.WIDTH;
    const height = GAME_CONFIG.HEIGHT;

    // Create launch button background
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x222222, 0.9);
    buttonBg.fillRoundedRect(width / 2 - 100, height / 2 - 25, 200, 50, 8);
    buttonBg.lineStyle(2, 0xffffff, 1);
    buttonBg.strokeRoundedRect(width / 2 - 100, height / 2 - 25, 200, 50, 8);

    // Create launch button text
    const launchText = this.add.text(width / 2, height / 2, 'Click to Launch', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    });
    launchText.setOrigin(0.5, 0.5);
    launchText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Make the button interactive
    const hitArea = this.add.rectangle(width / 2, height / 2, 200, 50, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });

    // Hover effect
    hitArea.on('pointerover', () => {
      launchText.setColor('#ffff00');
    });
    hitArea.on('pointerout', () => {
      launchText.setColor('#ffffff');
    });

    // Click to launch
    hitArea.on('pointerdown', () => {
      // Start music (user has now interacted, so audio context is unlocked)
      this.sound.play('music_title', { loop: true, volume: 0.5 });
      // Transition to title screen
      this.scene.start('TitleScene');
    });
  }
}
