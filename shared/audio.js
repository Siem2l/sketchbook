// The part of an audio-reactive sketch that could never be pure: the
// oscillators, the FFT, and the automatic gain that makes a room mic and a
// synth bank comparable.
//
// It emits four numbers in 0..1 and decides nothing about what they mean. The
// hendriklaan sketch maps them onto the AHN classification of a street; the
// elsewhere sketch maps them onto categories it derives from a height field.
// Having two callers disagree about the meaning is the point.
import { sequence, NOTES } from './beat.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A fraction of the way up something, as a pitch. Fourteen diatonic steps over
// two octaves, drawn from the pool the bass already plays out of, so a struck
// note is in the key of the built-in tune rather than on a frequency of its
// own. Free pitch would want a tuning decision this has no business making.
export function noteFor(f) {
  const step = Math.round(clamp(f, 0, 1) * (NOTES.length * 2 - 1));
  return NOTES[step % NOTES.length].hz * (1 << Math.floor(step / NOTES.length));
}

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
    this.deviceId = null;
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
    // A bus of its own for one-shots, feeding the speakers and the analyser
    // both. The second connection is the good half: a note the caller strikes
    // is heard by the FFT and comes back out as displacement, so hitting the
    // road makes the sub band spike and the ground heave under the blow.
    this.voice = this.ctx.createGain();
    this.voice.gain.value = 0;
    this.voice.connect(this.analyser);
    this.voice.connect(this.ctx.destination);
    return this.ctx;
  }

  // One shot, built per hit and disposed of when it ends. The caller decides
  // what it hit; this decides what that sounds like.
  strike(kind, hz) {
    // No context means `field`, which drives the bands from the sequencer and
    // never opens one — the reason the page moves on load with no gesture and
    // no permission. Silent by construction rather than by a check.
    if (!this.ctx || !this.voice) return false;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(this.voice);
    // Exponential ramps cannot pass through zero, so the rest is at a value
    // small enough to be silence and large enough to be legal.
    const REST = 0.0001;
    const hit = (peak, dur) => {
      g.gain.setValueAtTime(REST, now);
      g.gain.exponentialRampToValueAtTime(peak, now + 0.006);
      g.gain.exponentialRampToValueAtTime(REST, now + dur);
      return dur;
    };
    const done = (node, dur) => {
      node.stop(now + dur + 0.02);
      node.onended = () => g.disconnect();
    };

    if (kind === 'canopy') {
      // A crown is leaves, a branch and the ground in one column, and none of
      // it has a pitch. Noise in the band the note points at instead.
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(9000, hz * 8);
      bp.Q.value = 1.1;
      src.connect(bp); bp.connect(g);
      src.start(now);
      done(src, hit(0.55, 0.18));
      return true;
    }

    const o = ctx.createOscillator();
    if (kind === 'ground') {
      // The deck, hit. A sine falling half an octave in a tenth of a second is
      // the whole of what makes a thud a thud rather than a beep, and ground
      // has hag near zero, so the pitch mapping has already put it in the bass.
      o.type = 'sine';
      o.frequency.setValueAtTime(hz, now);
      o.frequency.exponentialRampToValueAtTime(hz * 0.5, now + 0.12);
      o.connect(g);
      o.start(now);
      done(o, hit(0.85, 0.4));
      return true;
    }

    // Roofs and facades: a struck bell, with a fifth over it for the ring.
    o.type = 'triangle';
    o.frequency.value = hz;
    const fifth = ctx.createOscillator();
    fifth.type = 'sine';
    fifth.frequency.value = hz * 1.5;
    const fg = ctx.createGain();
    fg.gain.value = 0.4;
    o.connect(g); fifth.connect(fg); fg.connect(g);
    o.start(now); fifth.start(now);
    const dur = hit(0.5, 0.5);
    fifth.stop(now + dur + 0.02);
    done(o, dur);
    return true;
  }

  buildTone() {
    const ctx = this.ensureCtx();
    const out = ctx.createGain();
    out.gain.value = TONE_LEVEL;
    // The analyser is a tap and nothing else. Running the speakers off it —
    // out → analyser → destination, which is what this was — put the mic on the
    // path to the destination too the moment `mic` connected its source, three
    // lines under a comment promising it did not. That is a feedback loop, and
    // it only wanted a source switched from tone to mic to howl.
    out.connect(this.analyser);
    out.connect(ctx.destination);

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

  // Every audible path in one place, so silence is one call and not four. The
  // bands are the caller's business — they are what the geometry reads, and a
  // caller that wants the survey exactly has to zero them itself.
  hush() {
    if (this.nodes) this.nodes.out.gain.value = 0;
    if (this.voice) this.voice.gain.value = 0;
  }

  // Let go of the microphone. Separate from hush() because that one is about
  // what comes out and this is about what goes in, and a caller switching a
  // source off means both. Leaving it out meant a page told to stop listening
  // kept the capture open and the recording indicator lit — the user had said
  // off and the machine still said otherwise.
  releaseInput() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.micNode) { this.micNode.disconnect(); this.micNode = null; }
    this.deviceId = null;
  }

  // Ask once, purely to make the device labels readable, and let go again
  // immediately. Labels are blank until access has been granted, so choosing a
  // device by name needs permission first — and doing that by opening the
  // default input for real means listening to whatever it hears in the
  // meantime. This opens nothing into the graph and stops the tracks before
  // returning, so the wrong microphone is never connected at all.
  async unlockLabels() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      return true;
    } catch { return false; }
  }

  // The audio inputs the browser will admit to. Labels are blank until the user
  // has granted access once, which is a rule rather than a choice — so a caller
  // building a picker has to call this after permission, not before.
  async inputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return all.filter((d) => d.kind === 'audioinput')
      .map((d) => ({ id: d.deviceId, label: d.label || '' }));
  }

  // Matched on the label rather than the id. A deviceId is an opaque per-origin
  // string a browser is free to rotate; "BlackHole" is something a person can
  // type into a URL and still have right next month.
  async inputMatching(text) {
    if (!text) return null;
    const want = text.toLowerCase();
    const hit = (await this.inputs()).find((d) => d.label.toLowerCase().includes(want));
    return hit ? hit.id : null;
  }

  async setMode(mode, deviceId = null) {
    this.error = '';
    // Nothing to do only if the source and the device both already match *and*,
    // for the microphone, a capture is actually still held. Without that last
    // clause a source switched off and back on again returned here without
    // re-acquiring, and listened to nothing for the rest of the session.
    if (mode === this.mode && deviceId === this.deviceId
        && (mode !== 'mic' || this.stream !== null)) return;
    this.deviceId = deviceId;
    // Released before anything is acquired, and on every transition including
    // mic to mic. The guard here used to be `mode !== 'mic'`, which was right
    // while the only way into mic was from another mode — the moment a device
    // argument made mic-to-mic possible it became a leak, and a bad one: the
    // old capture stayed connected to the analyser beside the new one, so a
    // page that had briefly opened the default microphone to read the device
    // labels went on listening to the room forever. It answered typing.
    const keep = this.deviceId;
    this.releaseInput();
    this.deviceId = keep;
    if (mode === 'tone') {
      this.ensureCtx();
      if (!this.nodes) this.buildTone();
      if (this.nodes) this.nodes.out.gain.value = TONE_LEVEL;
      await this.ctx.resume();
    } else if (this.nodes) {
      this.nodes.out.gain.value = 0;
    }
    // Struck notes belong to whichever source can be heard at all, and the
    // decision is made from the mode this call actually lands on rather than
    // the one it was asked for — a refused microphone falls back to `field`,
    // which is inaudible, and would otherwise leave the voice open behind it.
    const voiceFor = (m) => { if (this.voice) this.voice.gain.value = m === 'field' ? 0 : 0.6; };
    if (mode === 'mic') {
      try {
        // Nothing the browser might helpfully do to a voice is wanted here: a
        // loopback of the system's own output is already clean, and every one
        // of these would be fighting the music rather than the room.
        const want = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        // `exact`, so a missing device is an error to report rather than a
        // silent fall back to the built-in microphone — which would look like
        // it worked and sound like the room.
        if (deviceId) want.deviceId = { exact: deviceId };
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: want });
        this.ensureCtx();
        this.micNode = this.ctx.createMediaStreamSource(this.stream);
        this.micNode.connect(this.analyser);
        // Deliberately not connected to destination: monitoring a room mic
        // through the room's own speakers is a feedback loop.
        await this.ctx.resume();
      } catch (e) {
        // Two different failures worth telling apart: a device that was asked
        // for by name and is not there, and no audio input at all.
        this.error = deviceId
          ? 'that input is not available — staying on the built-in field'
          : 'no microphone — staying on the built-in field';
        this.mode = 'field';
        this.deviceId = null;
        voiceFor('field');
        return;
      }
    }
    this.mode = mode;
    voiceFor(mode);
  }
}
