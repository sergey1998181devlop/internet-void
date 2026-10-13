class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientPan = null;
    this.ambientDuck = null;
    this._pan = 0;
    this.enabled = false;
    this.started = false;
    this.ambientGain = null;
    this.ambLP = null;
    this.motionGain = null;
    this.ambGate = null;
    this.musicDuck = null;
    this.musicGain = null;
    this.musicLP = null;
    this.rickGain = null;
    this.rickAnalyser = null;
    this._ambBase = 0.25;
    this._fading = false;
    this._rick = false;
    this._idleTimer = null;
    this._activityBound = false;
    this._nodes = [];
    this._listeners = new Set();
    this._reverbIn = null;
    this._padTimer = null;

    // camera-motion driven layers (0..1)
    this._motion = 0;
    // while a click secret owns the tone ('overload' | 'white') the per-frame
    // motion pass must not touch the filters/detunes that secret is ramping
    this._toneLock = null;
    this.whooshGain = null;
    this.whooshFilter = null;
    this.rumbleFilter = null;
    this.motionLfo = null;
    this.droneOscs = [];
    this.padOscs = [];
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  getSnapshot() {
    return this.enabled;
  }

  _notify() {
    this._listeners.forEach((l) => l());
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;

    // master bus -> destination; ambient gets its own stereo panner
    this.master.connect(this.ctx.destination);

    if (this.ctx.createStereoPanner) {
      this.ambientPan = this.ctx.createStereoPanner();
      this.ambientPan.pan.value = this._pan || 0;
      this.ambientPan.connect(this.master);
    }
    this._applyPan();
  }

  // camera azimuth -> stereo image of the ambient drone
  setPan(v) {
    const val = Math.max(-1, Math.min(1, Number(v) || 0));
    this._pan = val;
    this._applyPan();
  }

  _applyPan() {
    if (!this.ctx || !this.ambientPan) return;
    try {
      this.ambientPan.pan.setTargetAtTime(this._pan || 0, this.ctx.currentTime, 0.12);
    } catch {
      this.ambientPan.pan.value = this._pan || 0;
    }
  }

  _buildAmbient() {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // velvet low-pass: keeps only the deep hum of the void, cuts the hiss
    this.ambLP = ctx.createBiquadFilter();
    this.ambLP.type = 'lowpass';
    this.ambLP.frequency.value = 180;
    this.ambLP.Q.value = 0.7;
    // camera-motion brightness layer (idle stays dark, dragging opens it)
    this.motionGain = ctx.createGain();
    this.motionGain.gain.value = 1;
    this.ambLP.connect(this.motionGain);

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.12; // quiet start: 10-15% until the fade-in
    this._ambBase = 0.25;
    this.motionGain.connect(this.ambientGain);
    // duck bus: accent sounds pull the music down 40-60% and let it back up
    this.ambientDuck = ctx.createGain();
    this.ambientDuck.gain.value = 1;
    this.ambientGain.connect(this.ambientDuck);
    // rickroll gate: instant cut of the hole noise while the easter egg plays
    this.ambGate = ctx.createGain();
    this.ambGate.gain.value = 1;
    this.ambientDuck.connect(this.ambGate);
    // ambient goes through the camera-driven stereo panner
    this.ambGate.connect(this.ambientPan || this.master);

    // deep drone: stacked detuned sines
    const freqs = [36, 54, 72.5, 108];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.16 / (i + 1);

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.03 + i * 0.017;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.06 / (i + 1);
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);

      osc.connect(g);
      g.connect(this.ambLP);
      osc.start(t);
      lfo.start(t);
      this.droneOscs.push(osc);
      this._nodes.push(osc, lfo);
    });

    // filtered noise = "vacuum rumble"
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.7;
    this.rumbleFilter = lp;
    const ng = ctx.createGain();
    ng.gain.value = 0.22;
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.ambLP);
    src.start(t);
    this._nodes.push(src);

    this._buildPad();
    this._buildWhoosh();
    this._applyMotion(this._motion, 0.01);

    // first gesture: fade from the quiet 12% start up to the calm 25% base
    this._fading = true;
    try {
      this.ambientGain.gain.cancelScheduledValues(t);
      this.ambientGain.gain.setValueAtTime(0.12, t);
      this.ambientGain.gain.linearRampToValueAtTime(0.25, t + 2);
    } catch {
      /* best effort */
    }
    setTimeout(() => {
      this._fading = false;
    }, 2200);
    this._armIdle();
  }

  // no interaction for 30s -> the drone sinks to a whisper, any activity
  // brings it back to the calm base level
  _armIdle() {
    if (this._activityBound) return;
    this._activityBound = true;
    const touch = () => {
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => this._setAmbBase(0.05), 30000);
      if (this._ambBase !== 0.25) this._setAmbBase(0.25);
    };
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
      window.addEventListener(ev, touch, { passive: true })
    );
    this._idleTimer = setTimeout(() => this._setAmbBase(0.05), 30000);
  }

  _setAmbBase(v) {
    if (!this.ctx || !this.ambientGain || this._ambBase === v) return;
    this._ambBase = v;
    if (this._fading) return; // never fight the 2s fade-in
    try {
      this.ambientGain.gain.setTargetAtTime(v, this.ctx.currentTime, 1.4);
    } catch {
      /* best effort */
    }
  }

  // slow organ-pad bed: four voices breathing through a chord progression
  _buildPad() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    lp.Q.value = 0.9;

    const breath = ctx.createOscillator();
    breath.type = 'sine';
    breath.frequency.value = 0.035;
    const breathAmt = ctx.createGain();
    breathAmt.gain.value = 260;
    breath.connect(breathAmt);
    breathAmt.connect(lp.frequency);

    const padGain = ctx.createGain();
    padGain.gain.value = 0.085;
    lp.connect(padGain);
    padGain.connect(this.ambLP);

    const roots = [1, 0.8409, 1.3348, 1.4983]; // A, F, C, G
    const ratios = [1, 1.4983, 2, 3];
    const oscs = ratios.map(() => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      osc.connect(g);
      g.connect(lp);
      osc.start(t);
      this._nodes.push(osc);
      return osc;
    });
    this.padOscs = oscs;

    breath.start(t);
    this._nodes.push(breath);

    let step = 0;
    const retune = () => {
      if (!this.ctx) return;
      const root = roots[step % roots.length];
      step++;
      const tt = this.ctx.currentTime;
      oscs.forEach((osc, i) => {
        const f = 110 * root * ratios[i];
        try {
          osc.frequency.setTargetAtTime(f, tt, 2.4);
        } catch {
          osc.frequency.value = f;
        }
      });
    };
    retune();
    this._padTimer = setInterval(retune, 9000);
  }

  // small plate-ish reverb built from a decaying noise impulse
  _buildReverb() {
    if (this._reverbIn || !this.ctx) return;
    const ctx = this.ctx;
    const seconds = 2.6;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.1);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    conv.connect(wet);
    wet.connect(this.master);

    const inG = ctx.createGain();
    inG.gain.value = 1;
    inG.connect(conv);
    this._reverbIn = inG;
  }

  // accent ducking: pull the ambient bed down by `amount` (0.4..0.6)
  duck(amount = 0.5, dur = 3) {
    if (!this.ctx || !this.ambientDuck) return;
    const t = this.ctx.currentTime;
    const g = this.ambientDuck.gain;
    const lvl = Math.max(0.05, 1 - Math.min(0.95, amount));
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(lvl, t + 0.18);
      g.setTargetAtTime(1, t + dur, 0.7);
    } catch {
      /* best effort */
    }
  }

  // space-music player: big events ($10+, gamma, explosions) pull the radio
  // down by 70% for the duration of the animation and let it back up
  duckMusic(amount = 0.7, dur = 3) {
    if (!this.ctx || !this.musicDuck) return;
    const t = this.ctx.currentTime;
    const g = this.musicDuck.gain;
    const lvl = Math.max(0.05, 1 - Math.min(0.95, amount));
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(lvl, t + 0.18);
      g.setTargetAtTime(1, t + dur, 0.7);
    } catch {
      /* best effort */
    }
  }

  // radio bus: element -> musicDuck -> musicGain -> master (so the global
  // sound toggle and the big-bang mute cover the player as well)
  ensureMusic() {
    this._ensure();
    if (!this.ctx) return null;
    if (!this.musicDuck) {
      this.musicDuck = this.ctx.createGain();
      this.musicDuck.gain.value = 1;
      // tone of the radio: the white-hole secret sweeps it like a rewind
      this.musicLP = this.ctx.createBiquadFilter();
      this.musicLP.type = 'lowpass';
      this.musicLP.frequency.value = 20000;
      this.musicLP.Q.value = 0.7;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.9;
      this.musicDuck.connect(this.musicLP);
      this.musicLP.connect(this.musicGain);
      this.musicGain.connect(this.master);
    }
    return this.musicDuck;
  }

  attachMusic(el) {
    if (!el || el.__voidSrc) return;
    if (!this.ensureMusic()) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.musicDuck);
      el.__voidSrc = src;
    } catch (e) {
      console.warn('[audio] attachMusic', e.message);
    }
  }

  // rickroll easter egg: own element chain with an analyser for the bass pulse
  attachRickroll(el) {
    if (!el || el.__voidSrc) return null;
    this._ensure();
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    try {
      if (!this.rickGain) {
        this.rickGain = this.ctx.createGain();
        this.rickGain.gain.value = 1;
        this.rickGain.connect(this.master);
      }
      if (!this.rickAnalyser) {
        this.rickAnalyser = this.ctx.createAnalyser();
        this.rickAnalyser.fftSize = 256;
        this.rickAnalyser.smoothingTimeConstant = 0.75;
      }
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.rickAnalyser);
      this.rickAnalyser.connect(this.rickGain);
      el.__voidSrc = src;
      return this.rickAnalyser;
    } catch (e) {
      console.warn('[audio] attachRickroll', e.message);
      return null;
    }
  }

  // interstellar secret: Cornfield Chase on its own chain to the master bus
  attachInterstellar(el) {
    if (!el || el.__voidSrc) return null;
    this._ensure();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    try {
      if (!this.islGain) {
        this.islGain = this.ctx.createGain();
        this.islGain.gain.value = 1;
        this.islGain.connect(this.master);
      }
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.islGain);
      el.__voidSrc = src;
    } catch (e) {
      console.warn('[audio] attachInterstellar', e.message);
    }
  }

  // hard-mute the hole drone while an easter-egg track runs, restore after.
  // rickroll and interstellar share the gate: either one holds it shut.
  setRickroll(on) {
    this._rick = !!on;
    this._syncEggGate();
  }

  setInterstellar(on) {
    this._isl = !!on;
    this._syncEggGate();
  }

  _syncEggGate() {
    const on = this._rick || this._isl;
    if (!this.ctx || !this.ambGate) return;
    const t = this.ctx.currentTime;
    const g = this.ambGate.gain;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(on ? 0.0001 : 1, t + (on ? 0.15 : 1.2));
    } catch {
      /* best effort */
    }
  }

  // absolute silence during the big bang pause (scheduled with the event).
  // `delay` may be negative: the packet arrived after the moment it describes
  // (busy main thread), and the silence window must still line up with the
  // visual timeline, so past offsets are folded into "now".
  planBigBang(delay = 0, ts = 1) {
    this._ensure();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const target = this.enabled ? 0.85 : 0.0001;
    const g = this.master.gain;
    const mute = now + delay + 3.0 * ts;
    const hold = now + delay + 3.78 * ts;
    const back = now + delay + 5.2 * ts;
    try {
      g.cancelScheduledValues(now);
      if (mute <= now && back > now) {
        // already inside the silence window: hold it, then let music back in
        g.setValueAtTime(0.0001, now);
        g.setValueAtTime(0.0001, Math.max(now, hold));
        g.linearRampToValueAtTime(target, back);
        return;
      }
      if (back <= now) return; // whole event is behind us, nothing to schedule
      g.setValueAtTime(g.value, now);
      g.setValueAtTime(target, mute);
      g.linearRampToValueAtTime(0.0001, Math.max(mute, now) + 0.08 * ts); // mute the instant it crushes
      g.setValueAtTime(0.0001, hold);
      g.linearRampToValueAtTime(target, back); // music flows back in
    } catch {
      /* best effort */
    }
  }

  restoreMusic() {
    if (!this.ctx) return;
    const target = this.enabled ? 0.85 : 0.0001;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(target, t + 1.0);
    } catch {
      /* best effort */
    }
  }

  // airy "drag" layer: a band-passed noise bed that only opens up when the
  // camera is actually spinning around the horizon
  _buildWhoosh() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 1.6;
    this.whooshFilter = filter;

    const g = ctx.createGain();
    g.gain.value = 0;
    this.whooshGain = g;

    // slow wobble so the drag never sounds static
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.14;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 160;
    lfo.connect(lfoAmt);
    lfoAmt.connect(filter.frequency);
    this.motionLfo = lfo;

    src.connect(filter);
    filter.connect(g);
    g.connect(this.ambientGain);
    src.start(t);
    lfo.start(t);
    this._nodes.push(src, lfo);
  }

  // camera angular speed (rad/s) -> how hard the void is "dragging" on you
  setMotion(radPerSec) {
    const m = Math.max(0, Math.min(1, Math.abs(Number(radPerSec) || 0) / 2.4));
    this._motion = m;
    if (this.started) this._applyMotion(m);
  }

  _applyMotion(m, forceTc) {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;
    const tc = forceTc != null ? forceTc : m > this._appliedMotion ? 0.05 : 0.3;
    this._appliedMotion = m;
    // a click secret is ramping these right now — it owns them until it lets go
    const lock = this._toneLock;
    try {
      if (this.whooshGain) this.whooshGain.gain.setTargetAtTime(m * 0.34, t, tc);
      if (this.whooshFilter) {
        this.whooshFilter.frequency.setTargetAtTime(380 + 3200 * m, t, tc);
        this.whooshFilter.Q.setTargetAtTime(1.6 + 3.4 * m, t, tc);
      }
      if (!lock && this.rumbleFilter) {
        this.rumbleFilter.frequency.setTargetAtTime(220 + 1500 * m, t, tc);
      }
      if (this.motionLfo) this.motionLfo.frequency.setTargetAtTime(0.14 + 1.1 * m, t, tc);
      if (!lock && this.ambLP) this.ambLP.frequency.setTargetAtTime(180 + 1400 * m, t, tc);
      if (this.motionGain) this.motionGain.gain.setTargetAtTime(1 + 0.5 * m, t, tc);
      // doppler-ish spin up of the drone itself
      if (!lock) {
        this.droneOscs.forEach((osc, i) => {
          osc.detune.setTargetAtTime(m * (120 + i * 70), t, tc);
        });
      }
    } catch {
      /* audio params are best-effort */
    }
  }

  enable() {
    this._ensure();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._buildAmbient();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.6);
    this._notify();
    return true;
  }

  disable() {
    if (!this.ctx) return false;
    this.enabled = false;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.35);
    this._notify();
    return false;
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
    return this.enabled;
  }

  // spaghettification: doppler-ish pitch fall + sub drop
  playSuck() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 2.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(120, t + 2.6);
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
    osc.connect(bp); bp.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 3.0);

    // sub-bass drop on the moment of swallow
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, t + 2.4);
    sub.frequency.exponentialRampToValueAtTime(28, t + 3.4);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t + 2.4);
    sg.gain.exponentialRampToValueAtTime(0.75, t + 2.62);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    sub.connect(sg); sg.connect(this.master);
    sub.start(t + 2.4); sub.stop(t + 3.7);
  }

  // gamma burst: shockwave
  playGamma() {
    if (!this.ctx || !this.enabled) return;
    this.duck(0.4, 2.4);
    this.duckMusic(0.7, 2.4);
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t);

    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(22, t + 1.1);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.9, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    boom.connect(bg); bg.connect(this.master);
    boom.start(t); boom.stop(t + 1.4);
  }

  // tiny UI blip
  playClick() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.22);
  }

  // --- Gargantua: five seconds of dramatic church organ ---------------------
  playOrgan() {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 5.2;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.55, t + 0.75);
    out.gain.setValueAtTime(0.55, t + dur - 2.4);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(640, t);
    lp.frequency.linearRampToValueAtTime(2700, t + 1.2);
    lp.frequency.linearRampToValueAtTime(850, t + dur);
    lp.Q.value = 0.7;
    lp.connect(out);
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    const chord = [65.41, 98.0, 130.81, 196.0, 261.63, 329.63, 392.0];
    chord.forEach((f, i) => {
      for (let k = 0; k < 2; k++) {
        const osc = ctx.createOscillator();
        osc.type = k ? 'sine' : 'sawtooth';
        osc.frequency.value = f * (k ? 2 : 1);
        const g = ctx.createGain();
        g.gain.value = (k ? 0.04 : 0.07) / (1 + i * 0.32);
        osc.connect(g);
        g.connect(lp);
        osc.start(t);
        osc.stop(t + dur + 0.1);
      }
    });
  }

  // --- ARG: the quiet vinyl tick the void answers the R key with -----------
  playTick() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(740, t);
    osc.frequency.exponentialRampToValueAtTime(210, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  // --- Bitcoin: juicy metallic ring, then the disintegration ---------------
  playCoin() {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    // struck metal: stacked inharmonic partials
    const partials = [
      [1174.66, 0.34, 1.7],
      [1567.98, 0.26, 1.4],
      [2349.32, 0.18, 1.1],
      [3135.96, 0.11, 0.85],
      [4698.64, 0.06, 0.6],
    ];
    partials.forEach(([f, a, d]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g); g.connect(out);
      osc.start(t);
      osc.stop(t + d + 0.05);
    });

    // the strike itself
    const len = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dd = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200;
    bp.Q.value = 1.4;
    const sg = ctx.createGain();
    sg.gain.value = 0.3;
    src.connect(bp); bp.connect(sg); sg.connect(out);
    src.start(t);

    // synth swell hinting at the coming collapse
    const sw = ctx.createOscillator();
    sw.type = 'sawtooth';
    sw.frequency.setValueAtTime(210, t + 0.25);
    sw.frequency.exponentialRampToValueAtTime(1500, t + 1.3);
    const swf = ctx.createBiquadFilter();
    swf.type = 'lowpass';
    swf.frequency.value = 2200;
    const swg = ctx.createGain();
    swg.gain.setValueAtTime(0.0001, t + 0.25);
    swg.gain.exponentialRampToValueAtTime(0.10, t + 0.75);
    swg.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    sw.connect(swf); swf.connect(swg); swg.connect(out);
    sw.start(t + 0.25);
    sw.stop(t + 1.6);
  }

  // matter coming apart: shimmering noise collapsing into the hole
  playCoinBreak() {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.7;

    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.5;
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(240, t + dur);

    // granular stutter so it reads as particles, not just hiss
    const stut = ctx.createGain();
    stut.gain.value = 1;
    const sh = ctx.createOscillator();
    sh.type = 'square';
    sh.frequency.value = 42;
    const shAmt = ctx.createGain();
    shAmt.gain.value = 0.45;
    sh.connect(shAmt);
    shAmt.connect(stut.gain);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp); bp.connect(stut); stut.connect(g);
    g.connect(this.master);
    if (this._reverbIn) g.connect(this._reverbIn);
    src.start(t);
    sh.start(t);
    sh.stop(t + dur);

    // thump on the break
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, t + 0.1);
    sub.frequency.exponentialRampToValueAtTime(34, t + 1.1);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t + 0.1);
    sg.gain.exponentialRampToValueAtTime(0.55, t + 0.24);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    sub.connect(sg); sg.connect(this.master);
    sub.start(t + 0.1);
    sub.stop(t + 1.4);
  }

  // --- 404 / NULL: 8-bit fault ---------------------------------------------
  playGlitch() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.75;

    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.master);

    // stepped square: pure console error
    const osc = ctx.createOscillator();
    osc.type = 'square';
    let tt = t;
    while (tt < t + dur - 0.03) {
      osc.frequency.setValueAtTime(90 + Math.random() * 2700, tt);
      tt += 0.018 + Math.random() * 0.05;
    }
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.16, t);
    og.gain.setValueAtTime(0.16, t + dur - 0.14);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(og); og.connect(out);
    osc.start(t); osc.stop(t + dur);

    // sample-and-hold noise = data corruption
    const nlen = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let hold = 0;
    for (let i = 0; i < nlen; i++) {
      if (i % 44 === 0) hold = Math.random() * 2 - 1;
      d[i] = hold;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.10, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(ng); ng.connect(out);
    src.start(t);

    // dead-air thud when it drops back to normal
    const th = ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(160, t + dur - 0.1);
    th.frequency.exponentialRampToValueAtTime(40, t + dur + 0.35);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t + dur - 0.1);
    tg.gain.exponentialRampToValueAtTime(0.4, t + dur);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.45);
    th.connect(tg); tg.connect(this.master);
    th.start(t + dur - 0.1);
    th.stop(t + dur + 0.5);
  }

  // --- Ripple: a soft, meditative vacuum click ------------------------------
  playVacuumClick() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const len = Math.floor(ctx.sampleRate * 0.16);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 7;
    bp.frequency.setValueAtTime(1700, t);
    bp.frequency.exponentialRampToValueAtTime(620, t + 0.16);
    const g = ctx.createGain();
    g.gain.value = 0.11;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(360, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.13);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.055, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + 0.18);
  }

  // --- click secret 1: singularity overload ---------------------------------
  // the whole bed climbs +12 semitones like a boiling reactor and the filter
  // opens with it; when it cannot take any more, the void burps
  playOverload(rise = 2.0) {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    const ctx = this.ctx;
    const t = ctx.currentTime;

    this._toneLock = 'overload';
    clearTimeout(this._toneTimer);
    const release = () => {
      if (!this.ctx) return;
      const tt = this.ctx.currentTime;
      try {
        this.droneOscs.forEach((o) => {
          o.detune.cancelScheduledValues(tt);
          o.detune.setTargetAtTime(0, tt, 0.3);
        });
        this.padOscs.forEach((o) => {
          o.detune.cancelScheduledValues(tt);
          o.detune.setTargetAtTime(0, tt, 0.3);
        });
        if (this.ambLP) this.ambLP.frequency.cancelScheduledValues(tt);
        if (this.rumbleFilter) this.rumbleFilter.frequency.cancelScheduledValues(tt);
        if (this.ambientDuck) this.ambientDuck.gain.setTargetAtTime(1, tt, 0.4);
      } catch {
        /* best effort */
      }
      if (this._toneLock === 'overload') this._toneLock = null;
    };
    this._toneTimer = setTimeout(release, (rise + 1.5) * 1000);

    const climb = (param, hot) => {
      try {
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(hot, t + rise);
      } catch {
        /* best effort */
      }
    };

    // +12 semitones on the drone and the pad: the hum starts to boil
    this.droneOscs.forEach((o) => climb(o.detune, 1200));
    this.padOscs.forEach((o) => climb(o.detune, 1200));
    if (this.ambLP) climb(this.ambLP.frequency, 1500);
    if (this.rumbleFilter) climb(this.rumbleFilter.frequency, 2800);
    if (this.ambientDuck) {
      try {
        const g = this.ambientDuck.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(1.35, t + rise * 0.8);
      } catch {
        /* best effort */
      }
    }
    this.duckMusic(0.55, rise + 1.4);

    // the reactor whine riding on top of the hum
    const w = ctx.createOscillator();
    w.type = 'sawtooth';
    w.frequency.setValueAtTime(240, t);
    w.frequency.exponentialRampToValueAtTime(480, t + rise); // +12 semitones
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + rise);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.17, t + rise * 0.7);
    wg.gain.setValueAtTime(0.17, t + rise + 0.5);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + rise + 1.0);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 9;
    const lg = ctx.createGain();
    lg.gain.value = 0.07;
    lfo.connect(lg);
    lg.connect(wg.gain);
    w.connect(bp);
    bp.connect(wg);
    wg.connect(this.master);
    if (this._reverbIn) wg.connect(this._reverbIn);
    w.start(t);
    lfo.start(t);
    w.stop(t + rise + 1.1);
    lfo.stop(t + rise + 1.1);

    // the burp: the overloaded singularity spits
    setTimeout(() => this.playBurp(), (rise + 0.7) * 1000);
  }

  // bass "отрыжка/всплеск": a fat low gulp with a formant sweep
  playBurp() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(1900, t);
    lp.frequency.exponentialRampToValueAtTime(170, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    if (this._reverbIn) g.connect(this._reverbIn);
    osc.start(t);
    osc.stop(t + 0.6);

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(90, t + 0.45);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.master);
    src.start(t);
  }

  // --- click secret 2: white hole -------------------------------------------
  // everything rewinds: filters sweep up, the drone climbs, the radio opens
  // from a murmur, and a reversed swell rises for the whole five seconds
  playReverse(dur = 5.0) {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    const ctx = this.ctx;
    const t = ctx.currentTime;

    this._toneLock = 'white';
    clearTimeout(this._toneTimer);
    const release = () => {
      if (!this.ctx) return;
      const tt = this.ctx.currentTime;
      try {
        this.droneOscs.forEach((o) => {
          o.detune.cancelScheduledValues(tt);
          o.detune.setTargetAtTime(0, tt, 0.3);
        });
        this.padOscs.forEach((o) => {
          o.detune.cancelScheduledValues(tt);
          o.detune.setTargetAtTime(0, tt, 0.3);
        });
        if (this.ambLP) this.ambLP.frequency.cancelScheduledValues(tt);
        if (this.rumbleFilter) this.rumbleFilter.frequency.cancelScheduledValues(tt);
        if (this.musicLP) {
          this.musicLP.frequency.cancelScheduledValues(tt);
          this.musicLP.frequency.setTargetAtTime(20000, tt, 0.2);
        }
      } catch {
        /* best effort */
      }
      if (this._toneLock === 'white') this._toneLock = null;
    };
    this._toneTimer = setTimeout(release, (dur + 1.1) * 1000);

    const climb = (param, hot) => {
      try {
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(hot, t + dur * 0.9);
      } catch {
        /* best effort */
      }
    };

    this.droneOscs.forEach((o) => climb(o.detune, 900));
    this.padOscs.forEach((o) => climb(o.detune, -900));
    if (this.ambLP) climb(this.ambLP.frequency, 2400);
    if (this.rumbleFilter) climb(this.rumbleFilter.frequency, 3000);
    // the radio un-muffles as if the tape were being rewound
    if (this.musicLP) {
      try {
        this.musicLP.frequency.cancelScheduledValues(t);
        this.musicLP.frequency.setValueAtTime(500, t);
        this.musicLP.frequency.exponentialRampToValueAtTime(9000, t + dur * 0.92);
      } catch {
        /* best effort */
      }
    }
    this.duckMusic(0.4, dur + 0.5);

    // reversed swell: noise that grows the whole time, then cuts dead
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(dur + 0.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + dur);
    g.gain.setValueAtTime(0.32, t + dur + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.16);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    g.connect(this._reverbIn);
    src.start(t);
    src.stop(t + dur + 0.22);

    // crystalline echo: a chord climbing an octave that never lands
    [440, 660, 880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 2, t + dur);
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.exponentialRampToValueAtTime(0.05 / (1 + i * 0.5), t + dur * 0.75);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gg);
      gg.connect(this.master);
      gg.connect(this._reverbIn);
      o.start(t);
      o.stop(t + dur + 0.05);
    });

    // the vacuum snaps shut exactly when the scene flips back
    setTimeout(() => this.playSuctionPop(), dur * 1000);
  }

  // suction pop: the white hole is gone and the dark rushes back in
  playSuctionPop() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + 0.26);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    if (this._reverbIn) g.connect(this._reverbIn);
    src.start(t);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(820, t);
    osc.frequency.exponentialRampToValueAtTime(88, t + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  // --- Big bang: sub-bass impact + golden dust ------------------------------
  playBigBang() {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    // sub-bass impact
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(72, t);
    sub.frequency.exponentialRampToValueAtTime(21, t + 2.6);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.95, t + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    sub.connect(sg); sg.connect(out);
    sub.start(t); sub.stop(t + 2.9);

    // blast of star dust
    const dur = 3.0;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7200, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.07);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(ng); ng.connect(out);
    src.start(t);

    // high shimmer of dispersing particles
    [880, 1318.5, 1760, 2637].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (1 + i * 0.0005);
      const g = ctx.createGain();
      const a = 0.09 / (1 + i * 0.7);
      g.gain.setValueAtTime(0.0001, t + 0.05);
      g.gain.exponentialRampToValueAtTime(a, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      osc.connect(g); g.connect(out);
      osc.start(t + 0.05);
      osc.stop(t + 2.7);
    });
  }

  // --- tier SFX --------------------------------------------------------------
  _noiseBuffer(dur) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // tier 1: pitched blip — pitch rises with the amount
  playTier1(amount) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = 520 + Math.min(Number(amount) || 1, 100) * 4.5;

    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + 0.24);

    [1568, 2093].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const gg = ctx.createGain();
      const a = 0.16 / (1 + i);
      const s = t + 0.03 + i * 0.05;
      gg.gain.setValueAtTime(0.0001, s);
      gg.gain.exponentialRampToValueAtTime(a, s + 0.02);
      gg.gain.exponentialRampToValueAtTime(0.0001, s + 0.28);
      o.connect(gg); gg.connect(out);
      o.start(s); o.stop(s + 0.3);
    });
  }

  // tier 2: cartoon pop + major chord stab
  playTier2() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.master);

    const pop = ctx.createOscillator();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(620, t);
    pop.frequency.exponentialRampToValueAtTime(170, t + 0.15);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    pop.connect(pg); pg.connect(out);
    pop.start(t); pop.stop(t + 0.2);

    [523.25, 659.25, 784].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = fr;
      const g = ctx.createGain();
      const s = t + 0.1 + i * 0.06;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.24, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.4);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.42);
    });
  }

  // tier 3: 8-bit "level up" arpeggio
  playTier3() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.duck(0.3, 1.6);

    const out = ctx.createGain();
    out.gain.value = 0.45;
    out.connect(this.master);

    [523.25, 659.25, 784, 1046.5].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      const g = ctx.createGain();
      const s = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.18, s + 0.008);
      g.gain.setValueAtTime(0.18, s + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.14);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.16);
    });
  }

  // tier 4: fanfare (brass-ish saws + filtered boom)
  playFanfare() {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    this.duck(0.55, 4);
    this.duckMusic(0.7, 4);
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    [392, 523.25, 659.25].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      const s = t + i * 0.12;
      lp.frequency.setValueAtTime(400, s);
      lp.frequency.linearRampToValueAtTime(2400, s + 0.18);
      lp.frequency.linearRampToValueAtTime(600, s + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.2, s + 0.06);
      g.gain.setValueAtTime(0.2, s + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.2);
      o.connect(lp); lp.connect(g); g.connect(out);
      o.start(s); o.stop(s + 1.25);
    });

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.1);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    src.connect(lp); lp.connect(ng); ng.connect(out);
    src.start(t);
  }

  // tier 5: meteor whooshes with ground thuds
  playMeteors() {
    if (!this.ctx || !this.enabled) return;
    this.duck(0.5, 5);
    this.duckMusic(0.7, 5);
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.master);

    for (let i = 0; i < 4; i++) {
      const s = t0 + i * 0.9 + Math.random() * 0.3;

      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer(0.7);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(3200, s);
      bp.frequency.exponentialRampToValueAtTime(280, s + 0.65);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.4, s + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.7);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(s);

      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(90, s + 0.6);
      thud.frequency.exponentialRampToValueAtTime(42, s + 0.85);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, s + 0.6);
      tg.gain.exponentialRampToValueAtTime(0.5, s + 0.63);
      tg.gain.exponentialRampToValueAtTime(0.0001, s + 0.95);
      thud.connect(tg); tg.connect(out);
      thud.start(s + 0.6); thud.stop(s + 1);
    }
  }

  // tier 6: bass drop + growl
  playBassDrop() {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    this.duck(0.6, 5);
    this.duckMusic(0.7, 5);
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.6;
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    const drop = ctx.createOscillator();
    drop.type = 'sine';
    drop.frequency.setValueAtTime(150, t);
    drop.frequency.exponentialRampToValueAtTime(30, t + 1.1);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, t);
    dg.gain.exponentialRampToValueAtTime(0.9, t + 0.06);
    dg.gain.setValueAtTime(0.9, t + 0.9);
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    drop.connect(dg); dg.connect(out);
    drop.start(t); drop.stop(t + 1.75);

    // minor-second growl (C3 + D#3)
    [130.81, 155.56].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.04);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(lp); lp.connect(g); g.connect(out);
      o.start(t); o.stop(t + 1.55);
    });

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 1.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
    src.connect(lp); lp.connect(ng); ng.connect(out);
    src.start(t);
  }

  // tier 7: shimmering divine choir
  playDivine() {
    if (!this.ctx || !this.enabled) return;
    this._buildReverb();
    this.duck(0.5, 6);
    this.duckMusic(0.7, 6);
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    [523.25, 659.25, 784, 1046.5].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr * (i % 2 ? 1.002 : 0.998);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.9);
      g.gain.setValueAtTime(0.14, t + 3.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.8);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 4.9);
    });

    for (let i = 0; i < 12; i++) {
      const s = t + 0.4 + i * 0.28 + Math.random() * 0.2;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2000 + Math.random() * 2000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.07, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.22);
    }
  }

  // --- secret SFX ------------------------------------------------------------
  playSecret(id) {
    if (!this.ctx || !this.enabled) return;
    if (id === 'pi') this._splat();
    else if (id === 'demon') this._laugh();
    else if (id === 'jackpot') this._jackpot();
    else if (id === 'leet') this._chiptune();
    else if (id === 'chill') this._pad();
  }

  _splat() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.6;
    out.connect(this.master);

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.3);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.55, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);
    src.connect(bp); bp.connect(ng); ng.connect(out);
    src.start(t);

    const boing = ctx.createOscillator();
    boing.type = 'triangle';
    boing.frequency.setValueAtTime(430, t + 0.05);
    boing.frequency.exponentialRampToValueAtTime(130, t + 0.42);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t + 0.05);
    bg.gain.exponentialRampToValueAtTime(0.5, t + 0.07);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    boing.connect(bg); bg.connect(out);
    boing.start(t + 0.05); boing.stop(t + 0.52);
  }

  _laugh() {
    this._buildReverb();
    this.duck(0.5, 4);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    // low ominous drone
    [55, 82.5].forEach((fr) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(lp); lp.connect(g); g.connect(out);
      o.start(t); o.stop(t + 2.7);
    });

    // descending "muahahaha" bursts
    for (let i = 0; i < 6; i++) {
      const s = t + 0.25 + i * 0.17;
      const base = 175 - i * 11;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 0.75, s + 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 720;
      bp.Q.value = 2.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.5, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.13);
      o.connect(bp); bp.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.15);
    }

    // thunder clap
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t + 0.1);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.1);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t + 0.1);
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.14);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    src.connect(lp); lp.connect(ng); ng.connect(out);
    src.start(t + 0.1);
  }

  _jackpot() {
    this.duck(0.45, 5);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);

    // bell arpeggio up
    [1046.5, 1318.5, 1568, 2093, 2637, 3136].forEach((fr, i) => {
      const s = t + i * 0.07;
      [1, 2.756].forEach((h, hi) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = fr * h;
        const g = ctx.createGain();
        const a = (hi ? 0.06 : 0.22) / (1 + i * 0.25);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(a, s + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
        o.connect(g); g.connect(out);
        o.start(s); o.stop(s + 0.52);
      });
    });

    // "win" chord
    [523.25, 659.25, 784, 1046.5].forEach((fr, i) => {
      const s = t + 0.5 + i * 0.05;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.16, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.2);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 1.25);
    });

    // coin cascade ticks
    for (let i = 0; i < 8; i++) {
      const s = t + 0.7 + i * 0.1 + Math.random() * 0.04;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2400 + Math.random() * 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.1, s + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.1);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.12);
    }
  }

  _chiptune() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.4;
    out.connect(this.master);

    const melody = [659.25, 784, 880, 1046.5, 987.77, 880, 784, 659.25];
    melody.forEach((fr, i) => {
      const s = t + i * 0.11;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.17, s + 0.005);
      g.gain.setValueAtTime(0.17, s + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.1);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.11);

      if (i % 2 === 0) {
        const hat = ctx.createBufferSource();
        hat.buffer = this._noiseBuffer(0.04);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 6000;
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.12, s);
        hg.gain.exponentialRampToValueAtTime(0.0001, s + 0.04);
        hat.connect(hp); hp.connect(hg); hg.connect(out);
        hat.start(s);
      }
    });
  }

  _pad() {
    this._buildReverb();
    this.duck(0.35, 8);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);
    if (this._reverbIn) out.connect(this._reverbIn);

    // D3 A3 F#4 C5 — lush major7
    [146.83, 220, 369.99, 523.25].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr * (i % 2 ? 1.001 : 0.999);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 1.2);
      g.gain.setValueAtTime(0.13, t + 6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 8.5);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 8.6);
    });

    // slow tremolo
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain);
    lfoGain.connect(out.gain);
    lfo.start(t); lfo.stop(t + 8.6);

    // breeze
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.07, t + 1.5);
    ng.gain.setValueAtTime(0.07, t + 6);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 8.5);
    src.connect(lp); lp.connect(ng); ng.connect(out);
    src.start(t);
  }

  // text-to-speech for big donations (privacy: only speaks what was thrown in)
  speak(text) {
    try {
      if (!this.enabled) return;
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const s = String(text || '').trim().slice(0, 200);
      if (!s) return;
      const u = new SpeechSynthesisUtterance(s);
      const lang = localStorage.getItem('void_lang') || navigator.language || 'ru';
      u.lang = lang;
      u.rate = 1;
      u.pitch = 1.05;
      u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* TTS unavailable */
    }
  }
}

export const audio = new AudioEngine();
