/**
 * Procedural audio — no asset files. SFX are synthesized from the content
 * pack's AudioTheme specs; music is a seeded generative loop over the floor's
 * scale. WebAudio contexts start on first user gesture (autoplay policy).
 */
import type { AudioTheme, SfxSpec } from "../engine/content/types.js";

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private theme: AudioTheme | null = null;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private stepIdx = 0;
  private muted = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.ctx.destination);

    // 1s white noise buffer for percussive/noise SFX.
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      // xorshift for deterministic noise
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 4294967295) * 2 - 1;
    }

    this.applyVolumes();
  }

  setTheme(theme: AudioTheme): void {
    this.theme = theme;
    this.applyVolumes();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.theme) return;
    const m = this.muted ? 0 : 1;
    this.master.gain.value = this.theme.masterVolume * m;
    this.sfxBus!.gain.value = this.theme.sfxVolume;
    this.musicBus!.gain.value = this.theme.musicVolume;
  }

  playSfx(name: string): void {
    if (!this.ctx || !this.theme || this.muted) return;
    const spec: SfxSpec | undefined = this.theme.sfx[name];
    if (!spec) return;
    const t = this.ctx.currentTime;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(spec.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + spec.durationSec);
    gain.connect(this.sfxBus!);

    if (spec.wave === "noise") {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer!;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(Math.max(spec.freqStart, 40), t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(spec.freqEnd, 30), t + spec.durationSec);
      src.connect(filter);
      filter.connect(gain);
      src.start(t);
      src.stop(t + spec.durationSec + 0.05);
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = spec.wave;
      osc.frequency.setValueAtTime(Math.max(spec.freqStart, 20), t);
      if (spec.sweepExp) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(spec.freqEnd, 20), t + spec.durationSec);
      } else {
        osc.frequency.linearRampToValueAtTime(Math.max(spec.freqEnd, 20), t + spec.durationSec);
      }
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + spec.durationSec + 0.02);
    }
  }

  // ---------------------------------------------------------------------------
  // Generative music
  // ---------------------------------------------------------------------------

  startMusic(scaleId: string, variantSeed: number): void {
    if (!this.ctx || !this.theme) return;
    this.stopMusic();
    const scale = this.theme.scales[scaleId] ?? this.theme.scales[Object.keys(this.theme.scales)[0]!] ?? [220];
    const beatSec = 60 / Math.max(this.theme.musicTempoBpm, 30) / 2; // eighth notes
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.stepIdx = 0;

    // Deterministic melodic variation per floor.
    let rngState = variantSeed | 0 || 1;
    const rand = (): number => {
      rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
      return (rngState >>> 0) / 4294967296;
    };
    const patternLength = 32;
    const melody: number[] = [];
    for (let i = 0; i < patternLength; i++) {
      // Sparse pattern: rest-heavy, low-octave root emphasis.
      const r = rand();
      if (r < 0.34) melody.push(-1);
      else if (r < 0.62) melody.push(0);
      else melody.push(1 + Math.floor(rand() * (scale.length - 1)));
    }

    const scheduleNote = (time: number, step: number): void => {
      const noteIdx = melody[step % patternLength]!;
      if (noteIdx >= 0 && this.ctx && this.musicBus) {
        const freq = scale[noteIdx % scale.length]! * (noteIdx >= scale.length ? 2 : 1);
        const osc = this.ctx.createOscillator();
        osc.type = step % 8 === 0 ? "triangle" : "sine";
        osc.frequency.value = freq;
        const g = this.ctx.createGain();
        const dur = beatSec * 0.9;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(step % 8 === 0 ? 0.5 : 0.3, time + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(g);
        g.connect(this.musicBus);
        osc.start(time);
        osc.stop(time + dur + 0.05);

        // Low pulse every beat.
        if (step % 4 === 0) {
          const bass = this.ctx.createOscillator();
          bass.type = "sine";
          bass.frequency.value = (scale[0] ?? 110) / 2;
          const bg = this.ctx.createGain();
          bg.gain.setValueAtTime(0.35, time);
          bg.gain.exponentialRampToValueAtTime(0.001, time + beatSec * 1.6);
          bass.connect(bg);
          bg.connect(this.musicBus);
          bass.start(time);
          bass.stop(time + beatSec * 1.7);
        }
      }
    };

    const tick = (): void => {
      if (!this.ctx) return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
        scheduleNote(this.nextNoteTime, this.stepIdx);
        this.stepIdx++;
        this.nextNoteTime += beatSec;
      }
    };
    tick();
    this.musicTimer = window.setInterval(tick, 120);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
