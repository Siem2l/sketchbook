// The part of an audio-reactive sketch that could never be pure: the
// oscillators, the FFT, and the automatic gain that makes a room mic and a
// synth bank comparable.
//
// It emits four numbers in 0..1 and decides nothing about what they mean. The
// hendriklaan sketch maps them onto the AHN classification of a street; the
// elsewhere sketch maps them onto categories it derives from a height field.
// Having two callers disagree about the meaning is the point.
import { sequence } from './beat.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// One sequencer drives all three sources. In `field` it drives the band values
// directly with no AudioContext at all, which is what makes the page move on
// load with no gesture and no permission — the thumbnail grabber and the tests
// both depend on that. In `tone` the same envelopes drive real oscillators and
// the bands come back out of an FFT of the result, so the two modes look
// identical and only one of them is audible. `mic` swaps the FFT's input.
//
// The sequencer itself now lives in beat.js, because the pattern it plays is
// editable and a mask is a thing you can hand a click. What is left here is
// the part that could never be pure: the oscillators, the FFT, and the
// automatic gain that makes a room mic and a synth bank comparable.
const TONE_LEVEL = 0.28;   // bus level for the built-in pattern

export class Listener {
  constructor(pattern) {
    this.pattern = pattern;   // live reference — the editor mutates it in place
    this.mode = 'field';
    this.bands = new Float32Array(4);
    this.ctx = null;
    this.analyser = null;
    this.bins = null;
    this.nodes = null;
    this.stream = null;
    this.error = '';
    this.peak = new Float32Array([0.2, 0.2, 0.2, 0.2]);
    this.floor = new Float32Array([0.2, 0.2, 0.2, 0.2]);
  }

  // Per-band automatic gain. FFT magnitudes are absolute, and the three
  // sources are nowhere near each other in level: a room mic at conversation
  // volume sits near the floor of the byte range while the built-in bank sits
  // near the ceiling. A fixed gain and gamma had the synth pinning every band
  // above 0.79 — the street stayed at full displacement and stopped answering
  // the music at all. Each band instead carries a peak and a floor that chase
  // the signal fast and fall back slowly, so what drives the geometry is where
  // this band is inside its own recent range: structure, not level.
  agc(raw) {
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      this.peak[i] = Math.max(raw[i], this.peak[i] * 0.998);
      this.floor[i] = Math.min(raw[i], this.floor[i] * 0.998 + 0.002);
      const span = Math.max(0.04, this.peak[i] - this.floor[i]);
      out[i] = clamp((raw[i] - this.floor[i]) / span, 0, 1);
    }
    return out;
  }

  // Attack fast, release slow — the eye wants the hit and then the decay, and
  // a symmetric filter turns every transient into mush.
  smooth(target) {
    for (let i = 0; i < 4; i++) {
      const k = target[i] > this.bands[i] ? 0.55 : 0.09;
      this.bands[i] += (target[i] - this.bands[i]) * k;
    }
  }

  update(t, beats) {
    if (this.mode === 'field' || !this.analyser) {
      const s = sequence(t, beats, this.pattern);
      this.smooth([
        clamp(s.kick * 1.05, 0, 1),
        clamp(s.bass * 1.0, 0, 1),
        clamp(s.pad, 0, 1),
        clamp(s.hat * 0.9, 0, 1),
      ]);
      return;
    }
    if (this.mode === 'tone' && this.nodes) this.drive(t, beats);

    this.analyser.getByteFrequencyData(this.bins);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hz));
      const b = Math.min(this.bins.length - 1, Math.ceil(hi / hz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.bins[i];
      return sum / (b - a + 1) / 255;
    };
    this.smooth(this.agc([band(20, 120), band(120, 500), band(500, 2200), band(2200, 9000)]));
  }

  ensureCtx() {
    if (this.ctx) return this.ctx;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    return this.ctx;
  }

  buildTone() {
    const ctx = this.ensureCtx();
    const out = ctx.createGain();
    out.gain.value = TONE_LEVEL;
    out.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    const osc = (type, freq, to) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = 0;
      o.connect(g); g.connect(to); o.start();
      return { o, g };
    };

    // Each voice is written into the band it is supposed to drive, because the
    // FFT does not care what the parts are called. The first pass put the bass
    // fundamental at 55 Hz, which parked it in the sub band on top of the kick
    // and pinned the ground to maximum for the whole loop. 110 Hz was no better
    // — the sub band runs to 120. At E3 it lands in 120–500 where it belongs
    // and the sub band is the kick alone, which is what makes the road heave
    // on the beat instead of just staying up.
    const kick = osc('sine', 55, out);

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass'; bassFilter.frequency.value = 420;
    bassFilter.connect(out);
    const bass = osc('sawtooth', 164.8, bassFilter);

    // The pad's cutoff is swept by the same envelope as its level. Level alone
    // moved the mid band by 0.03 out of 1 — a saw's harmonics above 500 Hz are
    // there whether it is loud or quiet — and the canopy barely stirred. The
    // filter is what the mid band can actually see.
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass'; padFilter.frequency.value = 900;
    padFilter.Q.value = 3;
    padFilter.connect(out);
    const padA = osc('sawtooth', 246.9, padFilter);
    const padB = osc('sawtooth', 370.0, padFilter);

    // Hats: two seconds of white noise on a loop through a highpass. Cheaper
    // and steadier than a per-hit buffer, and the FFT cannot tell.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 5200;
    const hatGain = ctx.createGain();
    hatGain.gain.value = 0;
    noise.connect(hp); hp.connect(hatGain); hatGain.connect(out);
    noise.start();

    this.nodes = { kick, bass, padA, padB, hatGain, padFilter, out };
  }

  drive(t, beats) {
    const s = sequence(t, beats, this.pattern);
    const n = this.nodes;
    const now = this.ctx.currentTime;
    const set = (p, v) => p.setTargetAtTime(v, now, 0.02);
    set(n.kick.g.gain, s.kick * 0.75);
    set(n.kick.o.frequency, 40 + s.kick * 78);      // the pitch drop that makes it a kick
    set(n.bass.g.gain, s.bass * 0.26);
    set(n.bass.o.frequency, s.note);
    set(n.padA.g.gain, s.pad * 0.055);
    set(n.padB.g.gain, s.pad * 0.045);
    set(n.padFilter.frequency, 480 + s.pad * 2600);
    set(n.hatGain.gain, s.hat * 0.10);
  }

  async setMode(mode) {
    this.error = '';
    if (mode === this.mode) return;
    if (this.stream && mode !== 'mic') {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.micNode) { this.micNode.disconnect(); this.micNode = null; }
    }
    if (mode === 'tone') {
      this.ensureCtx();
      if (!this.nodes) this.buildTone();
      if (this.nodes) this.nodes.out.gain.value = TONE_LEVEL;
      await this.ctx.resume();
    } else if (this.nodes) {
      this.nodes.out.gain.value = 0;
    }
    if (mode === 'mic') {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        this.ensureCtx();
        this.micNode = this.ctx.createMediaStreamSource(this.stream);
        this.micNode.connect(this.analyser);
        // Deliberately not connected to destination: monitoring a room mic
        // through the room's own speakers is a feedback loop.
        await this.ctx.resume();
      } catch (e) {
        this.error = 'no microphone — staying on the built-in field';
        this.mode = 'field';
        return;
      }
    }
    this.mode = mode;
  }
}
