/**
 * Audio Manager — synthesizes the audio theme: tempo from tone, scale plan
 * per depth mood curve, SFX specs per gameplay event with semantically tuned
 * frequency sweeps. Validates coverage of every event the client plays.
 */
import { Agent } from "../core/agent.js";
import type { AudioTheme, SfxSpec } from "../../engine/content/types.js";

const REQUIRED_SFX = [
  "swing", "hit", "hurt", "pickup", "buy", "levelUp",
  "death", "portal", "dodge", "chest", "victory",
] as const;

export class AudioManagerAgent extends Agent {
readonly id = "audio";
  readonly title = "Audio Manager";
  author(depthCount: number, toneWords: string[]): AudioTheme {
    const rng = this.ctx.rng;
    const intense = toneWords.some((t) => ["menacing", "punishing", "oppressive", "hostile"].includes(t.toLowerCase()));
    const tempo = (intense ? 96 : 86) + rng.intInclusive(-4, 8);

    const theme: AudioTheme = {
      masterVolume: 0.85,
      sfxVolume: 0.9,
      musicVolume: 0.32,
      musicTempoBpm: tempo,
      scales: {
        minorPentatonic: [220.0, 261.63, 293.66, 329.63, 392.0],
        dorian: [220.0, 246.94, 261.63, 293.66, 329.63, 392.0, 440.0],
        phrygian: [220.0, 233.08, 261.63, 293.66, 311.13, 349.23, 415.3],
      },
      sfx: {
        swing: spec("sawtooth", 340, 130, 0.12, 0.42),
        hit: spec("square", 210, 82, 0.1, 0.5),
        hurt: spec("square", 150, 68, 0.22, 0.62),
        pickup: spec("triangle", 520, 900, 0.09, 0.38),
        buy: spec("triangle", 660, 1180, 0.11, 0.4),
        levelUp: spec("triangle", 330, 990, 0.5, 0.48),
        death: spec("noise", 320, 55, 0.7, 0.58),
        portal: spec("sine", 170, 540, 0.6, 0.4),
        dodge: spec("noise", 900, 220, 0.14, 0.3),
        chest: spec("triangle", 250, 520, 0.28, 0.44),
        victory: spec("triangle", 392, 784, 0.8, 0.5),
      },
    };

    // Validation: every required cue present with sane values.
    const missing = REQUIRED_SFX.filter((k) => !theme.sfx[k]);
    if (missing.length > 0) throw new Error(`AudioManager bug: missing sfx ${missing.join(",")}`);
    for (const [k, s] of Object.entries(theme.sfx) as Array<[string, SfxSpec]>) {
      if (!(s.durationSec > 0 && s.durationSec <= 2)) throw new Error(`sfx ${k}: bad duration`);
      if (!(s.volume > 0 && s.volume <= 1)) throw new Error(`sfx ${k}: bad volume`);
    }

    this.act("audio.authored", `tempo=${tempo}bpm scales=${Object.keys(theme.scales).length}`);
    this.artifactJson("audio/theme.json", {
      theme,
      plan: {
        depthScales: Array.from({ length: depthCount }, (_, i) =>
          i + 1 === depthCount ? "phrygian" : i % 2 === 0 ? "minorPentatonic" : "dorian"),
        note: "Music is generated at runtime by the client synth; no audio assets ship.",
      },
    });
    return theme;
  }
}

function spec(
  wave: SfxSpec["wave"], f0: number, f1: number, dur: number, vol: number,
): SfxSpec {
  return { wave, freqStart: f0, freqEnd: f1, durationSec: dur, volume: vol, sweepExp: true };
}
