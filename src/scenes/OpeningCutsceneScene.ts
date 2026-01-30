import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';

interface DialogueLine {
  speaker: string;
  text: string;
  portrait?: string;
}

/**
 * Opening cutscene - dark room dialogue before the first battle
 * Heroes meet in the abandoned distillery, exchange banter in the dark,
 * then the lights come on revealing the scene.
 */
export class OpeningCutsceneScene extends Phaser.Scene {
  private heroId: string = 'arden';
  private devMode: boolean = false;
  private currentLineIndex: number = 0;
  private enterKey!: Phaser.Input.Keyboard.Key;

  // UI elements
  private dialogueBox!: Phaser.GameObjects.Graphics;
  private speakerText!: Phaser.GameObjects.Text;
  private dialogueText!: Phaser.GameObjects.Text;
  private continueIndicator!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Image | null;

  // Phase tracking (only dark_dialogue used now - battle handles the rest)
  private phase: 'dark_dialogue' = 'dark_dialogue';

  // Dark room dialogue - heroes meeting in the dark
  private darkDialogue: DialogueLine[] = [
    { speaker: 'Arden', text: "So I'm not the only one who got the note? Shucks, I thought I was special.", portrait: 'portrait_arden' },
    { speaker: 'Veil', text: "Who's to say you ain't? Mor'n likely we're all good for a scrap.", portrait: 'portrait_veil' },
    { speaker: 'Ty', text: "Yeah, pretty boy's right. None of you look like posers to me.", portrait: 'portrait_ty' },
    { speaker: 'Quin', text: "Yeah yeah. Jokes. But I don't leave anything to chance. And the math isn't in our favor here. This place gives me the creeps.", portrait: 'portrait_quin' },
    { speaker: 'Thorn', text: "The Oak does not concern itself with the soil in which its roots settles.", portrait: 'portrait_thorn' },
    { speaker: 'Veil', text: "Right. Roots. But the Oak don't need to see. We do. Or at least, I do. Anyone got a light?", portrait: 'portrait_veil' },
    { speaker: 'Arden', text: "Or a clue why we're meeting at an abandoned distillery? I was rather hoping it would be in service...", portrait: 'portrait_arden' },
    { speaker: 'Narrator', text: "*grunt* *thud* *shatter*" },
    { speaker: 'Narrator', text: "*Sounds of a scuffle are punctuated by a shrill scream*" },
    { speaker: 'Ty', text: "That better not be our paycheck...", portrait: 'portrait_ty' },
    { speaker: 'Arden', text: "Maybe he brought cash?", portrait: 'portrait_arden' },
    { speaker: 'Thorn', text: "We should move. Now.", portrait: 'portrait_thorn' },
    { speaker: 'Veil', text: "Agree. Let's go!", portrait: 'portrait_veil' },
    { speaker: 'Quin', text: "Wait! I can make light.", portrait: 'portrait_quin' },
  ];

  // Battle intro dialogue - after the map is revealed
  private battleIntroDialogue: DialogueLine[] = [
    { speaker: 'Narrator', text: "A tiefling man with a brilliant macaw sits, tied to a wooden chair in the center of the distillery." },
    { speaker: 'Narrator', text: "Around him lay half a dozen bodies. But before you can get your bearings, attacks emerge from the shadows!" },
    { speaker: 'Narrator', text: "Roll for initiative!" },
  ];

  constructor() {
    super({ key: 'OpeningCutsceneScene' });
  }

  init(data: { heroId?: string; devMode?: boolean }): void {
    this.heroId = data.heroId || 'arden';
    this.devMode = data.devMode ?? false;
    this.currentLineIndex = 0;
    this.phase = 'dark_dialogue';
    this.portrait = null;
  }

  create(): void {
    // Stop title music and start with silence (dark, tense atmosphere)
    this.sound.stopAll();

    // Black background (the dark room)
    this.add.rectangle(
      GAME_CONFIG.WIDTH / 2,
      GAME_CONFIG.HEIGHT / 2,
      GAME_CONFIG.WIDTH,
      GAME_CONFIG.HEIGHT,
      0x000000
    );

    // Create dialogue UI
    this.createDialogueUI();

    // Setup input
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // Show first line
    this.showCurrentLine();
  }

  private createDialogueUI(): void {
    const boxWidth = 700;
    const boxHeight = 120;
    const boxX = (GAME_CONFIG.WIDTH - boxWidth) / 2;
    const boxY = GAME_CONFIG.HEIGHT - boxHeight - 30;
    const padding = 15;

    // Dialogue box background
    this.dialogueBox = this.add.graphics();
    this.dialogueBox.fillStyle(0x111111, 0.95);
    this.dialogueBox.fillRoundedRect(boxX, boxY, boxWidth, boxHeight, 8);
    this.dialogueBox.lineStyle(2, 0x444444, 1);
    this.dialogueBox.strokeRoundedRect(boxX, boxY, boxWidth, boxHeight, 8);

    // Speaker name
    this.speakerText = this.add.text(boxX + padding, boxY + padding, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffff00',
      fontStyle: 'bold',
    });
    this.speakerText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Dialogue text
    this.dialogueText = this.add.text(boxX + padding, boxY + padding + 28, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      wordWrap: { width: boxWidth - padding * 2 },
      lineSpacing: 4,
    });
    this.dialogueText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Continue indicator
    this.continueIndicator = this.add.text(
      boxX + boxWidth - padding - 20,
      boxY + boxHeight - padding - 12,
      '>>',
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888888',
      }
    );
    this.continueIndicator.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Animate continue indicator
    this.tweens.add({
      targets: this.continueIndicator,
      alpha: 0.3,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });
  }

  private showCurrentLine(): void {
    if (this.currentLineIndex >= this.darkDialogue.length) {
      this.advancePhase();
      return;
    }

    const line = this.darkDialogue[this.currentLineIndex];

    // Update speaker name with color coding
    this.speakerText.setText(line.speaker);
    if (line.speaker === 'Narrator') {
      this.speakerText.setColor('#888888');
    } else {
      this.speakerText.setColor('#ffff00');
    }

    // Update dialogue text
    let text = line.text;
    if (text.startsWith('*') && text.endsWith('*')) {
      // Italic for narrator actions
      this.dialogueText.setFontStyle('italic');
      text = text.slice(1, -1);
    } else {
      this.dialogueText.setFontStyle('normal');
    }
    this.dialogueText.setText(text);

    // Update portrait
    if (this.portrait) {
      this.portrait.destroy();
      this.portrait = null;
    }

    if (line.portrait && this.textures.exists(line.portrait)) {
      const boxX = (GAME_CONFIG.WIDTH - 700) / 2;
      const boxY = GAME_CONFIG.HEIGHT - 120 - 30;
      const portraitSize = 140;

      // Position portrait ABOVE the dialogue box (like Ishetar's DialogueRenderer)
      this.portrait = this.add.image(boxX, boxY - portraitSize - 10, line.portrait);
      this.portrait.setOrigin(0, 0);
      this.portrait.setDisplaySize(portraitSize, portraitSize);
      this.portrait.setDepth(12); // Above dialogue UI

      // Apply LINEAR filtering for portrait quality
      const textureSource = this.portrait.texture.source[0];
      if (textureSource) {
        textureSource.scaleMode = Phaser.ScaleModes.LINEAR;
        if (textureSource.glTexture && this.game.renderer.type === Phaser.WEBGL) {
          (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).setTextureFilter(
            textureSource.glTexture,
            Phaser.Textures.FilterMode.LINEAR
          );
        }
      }
    }
  }

  private advancePhase(): void {
    if (this.phase === 'dark_dialogue') {
      // After dark dialogue, transition to BattleScene with lights-on reveal
      this.startBattle();
    }
  }

  private startBattle(): void {
    // Transition to the actual battle scene with lights-on reveal
    // BattleScene will handle the flash effect and battle intro dialogue
    this.scene.start('BattleScene', {
      heroId: this.heroId,
      battleMap: 'abandoned_distillery',
      returnScene: 'SparkworksScene',
      isOpeningBattle: true,
      gameFlags: {},
      devMode: this.devMode,
      showLightsOnReveal: true,
      battleIntroDialogue: this.battleIntroDialogue,
    });
  }

  update(): void {
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.currentLineIndex++;
      this.showCurrentLine();
    }
  }
}
