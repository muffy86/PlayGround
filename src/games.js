// Timing-highway engine + all mini-games + metronome challenges.
import { synth, Metronome } from './audio.js';
import { award, fx, store } from './rewards.js';

// ---------- TIMING FALL (notes scroll down canvas lanes, hit on line) ----------
export class TimingFall {
  constructor(canvas, kit, hud) {
    this.cv = canvas; this.kit = kit; this.hud = hud;
    this.playing = false; this.notes = []; this.startAt = 0;
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.acc = { perfect: 0, great: 0, miss: 0 };
    this.song = null; this.onEnd = null;
  }
  load(song) {
    this.song = song;
    const beat = 60 / song.bpm;
    this.notes = song.notes.flatMap((tok, i) => {
      const id = song.map[tok];
      if (!id) return [];
      // some 8th slots: alternate spacing for feel
      return [{ id, t: i * beat * 0.5, hit: false, judged: false }];
    });
    this.dur = this.notes[this.notes.length - 1].t + 2;
  }
  start() {
    synth.ensure();
    // count-in: 4 clicks then notes
    const beat = 60 / this.song.bpm;
    for (let i = 0; i < 4; i++) synth.play(i === 0 ? 'clickAcc' : 'click', synth.now() + i * beat * 0.5, 0.9);
    this.startAt = synth.now() + 4 * beat * 0.5;
    this.notes.forEach(n => { n.audioT = this.startAt + n.t; n.hit = false; n.judged = false; });
    this.playing = true; this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.acc = { perfect: 0, great: 0, miss: 0 };
    this.hud.show(this.song.title);
  }
  stop(silent) {
    this.playing = false; this.hud.hide();
    if (!silent) this.finish();
  }
  strike(id) {
    if (!this.playing) return;
    const t = synth.now() - this.startAt;
    // nearest unjudged note of that drum within window
    let best = null, bd = 1e9;
    for (const n of this.notes) {
      if (n.judged || n.id !== id) continue;
      const d = Math.abs(n.t - t);
      if (d < bd) { bd = d; best = n; }
    }
    const judge = (kind, pts) => {
      this.combo = kind === 'miss' ? 0 : this.combo + 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += pts + Math.min(50, this.combo * 2);
      this.acc[kind === 'perfect' ? 'perfect' : kind === 'great' ? 'great' : 'miss']++;
      this.hud.judge(kind, this.combo);
      award({ xp: kind === 'perfect' ? 6 : kind === 'great' ? 3 : 0, coins: kind === 'perfect' && this.combo % 10 === 0 ? 2 : 0, combo: this.combo });
      if (this.combo === 10) { award({ badge: 'combo10' }); fx.toast('⚡ Combo x10!'); }
      if (this.combo === 50) { award({ badge: 'combo50' }); fx.confetti(200); }
      if (this.combo % 10 === 0 && store.data.owned.includes('confetti')) fx.confetti(70);
      this.hud.score(this.score, this.combo, this.acc);
    };
    if (best && bd < 0.28) {
      best.judged = true; best.hit = true;
      award({ timingMs: Math.round(bd * 1000) });
      judge(bd < 0.09 ? 'perfect' : 'great', bd < 0.09 ? 100 : 60);
    } else {
      // ghost tap: small penalty-free feedback
      this.hud.judge('miss', this.combo, true);
    }
  }
  frame() {
    if (!this.playing) return;
    const g = this.cv.getContext('2d');
    const r = this.cv.parentElement.getBoundingClientRect();
    if (this.cv.width !== r.width | 0) { this.cv.width = r.width; this.cv.height = r.height; }
    const W = this.cv.width, H = this.cv.height;
    g.clearRect(0, 0, W, H);
    const lanes = this.song.lanes, lw = W / lanes.length;
    const t = synth.now() - this.startAt;
    const hitY = H * 0.78, lead = 1.6; // seconds visible ahead
    g.font = '700 11px system-ui'; g.textAlign = 'center';
    lanes.forEach((id, i) => {
      const x = i * lw + lw / 2;
      g.fillStyle = '#ffffff10'; g.fillRect(i * lw + 4, 0, lw - 8, H);
      g.fillStyle = '#b7aee0'; g.fillText(short(id), x, hitY + 34);
    });
    // hit line
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
    g.fillStyle = `rgba(34,211,238,${0.5 + pulse * 0.4})`;
    g.fillRect(0, hitY, W, 4);
    for (const n of this.notes) {
      const dt = n.t - t;
      if (dt < -0.35) {
        if (!n.judged) {
          n.judged = true; this.combo = 0; this.acc.miss++;
          this.hud.judge('miss', 0); this.hud.score(this.score, 0, this.acc);
        }
        continue;
      }
      if (dt > lead || n.judged) continue;
      const y = hitY - (dt / lead) * (hitY - 20);
      const li = lanes.indexOf(n.id);
      const x = (li < 0 ? lanes.length / 2 : li) * lw + lw / 2;
      const col = laneColor(n.id);
      g.beginPath(); g.arc(x, y, 17, 0, 7); g.fillStyle = col; g.globalAlpha = 0.92; g.fill();
      g.globalAlpha = 1; g.fillStyle = '#0b0620'; g.font = '900 11px system-ui';
      g.fillText(short(n.id), x, y + 4);
    }
    if (t > this.dur) this.finish();
  }
  finish() {
    if (!this.playing && this._done) return;
    this.playing = false; this._done = false;
    const total = this.notes.length || 1;
    const rate = (this.acc.perfect + this.acc.great) / total;
    const xp = Math.round(40 + rate * 120 + this.maxCombo);
    award({ xp, coins: 5 + Math.round(rate * 20) + (rate > 0.9 ? 10 : 0) });
    fx.toast(rate > 0.9 ? `🏆 Smashed it! +${xp} XP` : rate > 0.6 ? `🔥 Nice groove! +${xp} XP` : `💪 Keep practicing! +${xp} XP`);
    if (rate > 0.5) fx.confetti(120);
    this.hud.hide(); this.onEnd?.({ ...this.acc, score: this.score, maxCombo: this.maxCombo, rate });
    this._done = true;
  }
}
function laneColor(id) { return { kick: '#34d399', snare: '#a855f7', hihat: '#22d3ee', openhat: '#67e8f9', tom1: '#fb7185', tom2: '#f472b6', tom3: '#c084fc', crash: '#fbbf24', ride: '#f59e0b' }[id] || '#fff'; }
function short(id) { return { kick: 'KICK', snare: 'SNR', hihat: 'HAT', openhat: 'OHT', tom1: 'T1', tom2: 'T2', tom3: 'FLR', crash: 'CRS', ride: 'RIDE' }[id] || id; }

// ---------- MINI-GAMES ----------
export class Minis {
  constructor(kit, ui) { this.kit = kit; this.ui = ui; this.active = null; this.state = {}; }
  stop() { this.active = null; clearInterval(this.state.timer); clearTimeout(this.state.to); }

  start(kind) {
    this.stop(); this.active = kind; this.state = { score: 0 };
    synth.ensure();
    const feed = (m) => this.ui.feed(m);
    if (kind === 'ear') this.ear(feed);
    if (kind === 'fill') this.fill(feed);
    if (kind === 'limb') this.limb(feed);
    if (kind === 'burst') this.burst(feed);
    if (kind === 'offbeat') this.offbeat(feed);
    if (kind === 'timing') this.ui.toast('Use ▶ Play track on the Play tab for Timing Fall!');
  }
  tap(id) {
    const s = this.state; if (!this.active) return;
    if (this.active === 'ear') this.earTap(id);
    if (this.active === 'fill') this.fillTap(id);
    if (this.active === 'limb') this.limbTap(id);
    if (this.active === 'burst') this.burstTap(id);
    if (this.active === 'offbeat') this.offbeatTap(id);
  }
  // --- Ear Copy (Simon) ---
  ear(feed) {
    const pool = ['snare', 'kick', 'hihat', 'tom1'];
    this.state.seq = [pool[Math.random() * 4 | 0]];
    this.state.round = 1; this.state.idx = 0; this.state.lock = true;
    feed(`👂 Round 1 — watch & listen...`);
    this.earPlay();
  }
  earPlay() {
    const s = this.state; s.lock = true; s.idx = 0;
    this.ui.feed(`👂 Round ${s.round} — watch...`);
    s.seq.forEach((id, i) => setTimeout(() => { this.kit.hit(id, 0.9); this.ui.flashPad(id); }, 600 + i * 520));
    setTimeout(() => { s.lock = false; this.ui.feed(`👂 Your turn! Repeat ${s.seq.length} hits`); }, 600 + s.seq.length * 520);
  }
  earTap(id) {
    const s = this.state; if (s.lock) return;
    const want = s.seq[s.idx];
    if (id !== want) {
      this.ui.feed(`❌ Nope! It was ${want}. Score: round ${s.round}.`);
      award({ xp: s.round * 8, coins: s.round });
      this.stop(); return;
    }
    s.idx++;
    if (s.idx >= s.seq.length) {
      s.score = s.round; this.ui.score(s.score * 100); this.ui.feed(`✅ Round ${s.round} cleared!`);
      award({ xp: 12, coins: 2 });
      if (s.round >= 5) award({ badge: 'ear5' });
      if (s.round >= 8) { this.ui.feed(`🏆 Ear master! 8 rounds. +bonus`); award({ xp: 100, coins: 20 }); this.stop(); return; }
      const pool = ['snare', 'kick', 'hihat', 'tom1', 'tom2', 'crash'];
      s.seq.push(pool[Math.random() * pool.length | 0]); s.round++;
      this.state.to = setTimeout(() => this.earPlay(), 800);
    }
  }
  // --- Fill Frenzy: 30s, random target shown, hit it ---
  fill(feed) {
    const opts = ['snare', 'tom1', 'tom2', 'tom3', 'crash'];
    const s = this.state; s.left = 30; s.hits = 0;
    const next = () => { s.target = opts[Math.random() * opts.length | 0]; feed(`🌊 Hit the <b>${s.target.toUpperCase()}</b>! (${s.left}s)`); this.ui.flashPad(s.target, true); };
    next();
    s.timer = setInterval(() => {
      s.left--; this.ui.timer(s.left + 's'); this.ui.score(s.hits * 50);
      if (s.left <= 0) { clearInterval(s.timer); feed(`⏱️ Time! ${s.hits} fills smashed.`); award({ xp: s.hits * 6, coins: Math.round(s.hits / 2) }); fx.confetti(100); this.stop(); }
    }, 1000);
    this.ui.timer('30s');
  }
  fillTap(id) {
    const s = this.state;
    if (id === s.target) {
      s.hits++; award({ xp: 4 }); fx.floater('+1', innerWidth / 2, innerHeight / 2);
      const opts = ['snare', 'tom1', 'tom2', 'tom3', 'crash', 'kick', 'hihat'];
      s.target = opts[Math.random() * opts.length | 0];
      this.ui.feed(`🌊 Hit the <b>${s.target.toUpperCase()}</b>! (${s.left}s)`);
      this.ui.score(s.hits * 50);
    }
  }
  // --- Limb Split: alternate kick / snare strictly ---
  limb(feed) {
    const s = this.state; s.want = 'kick'; s.count = 0; s.left = 30;
    feed(`🦵 Alternate: KICK → SNARE → KICK... Start with <b>KICK</b> (${s.left}s)`);
    s.timer = setInterval(() => {
      s.left--; this.ui.timer(s.left + 's');
      if (s.left <= 0) { clearInterval(s.timer); feed(`🦵 Done! ${s.count} clean alternations.`); award({ xp: s.count * 4, coins: Math.round(s.count / 4) }); this.stop(); }
    }, 1000);
  }
  limbTap(id) {
    const s = this.state;
    if (id === s.want) { s.count++; s.want = s.want === 'kick' ? 'snare' : 'kick'; this.ui.score(s.count * 25); this.ui.feed(`🦵 Good! Now <b>${s.want.toUpperCase()}</b> (${s.count})`); award({ xp: 2 }); }
    else { this.ui.feed(`❌ Wanted ${s.want.toUpperCase()}! Reset.`); s.count = 0; s.want = 'kick'; this.ui.score(0); }
  }
  // --- Speed Burst: 10s, hit snare as fast as possible ---
  burst(feed) {
    const s = this.state; s.hits = 0; s.left = 10; s.go = false;
    feed('💥 Get ready... hit SNARE when GO!');
    s.to = setTimeout(() => { s.go = true; feed('💥 GO! Smash SNARE!'); }, 1500);
    s.timer = setInterval(() => {
      if (!s.go) return;
      s.left -= 0.1; this.ui.timer(s.left.toFixed(1) + 's');
      if (s.left <= 0) {
        clearInterval(s.timer);
        feed(`💥 ${s.hits} hits! ${s.hits >= 40 ? 'SPEED DEMON 🏆' : s.hits >= 25 ? 'Blazing! 🔥' : 'Warm hands! 💪'}`);
        award({ xp: s.hits * 3, coins: Math.round(s.hits / 5) });
        if (s.hits >= 40) { award({ badge: 'burst' }); fx.confetti(150); }
        this.stop();
      }
    }, 100);
  }
  burstTap(id) { if (this.state.go && id === 'snare') { this.state.hits++; this.ui.score(this.state.hits * 10); } }
  // --- Offbeat Ninja: metronome 16ths, only hit snare on "e" and "a" ---
  offbeat(feed) {
    const s = this.state; s.step = 0; s.score = 0; s.metro = new Metronome((tk) => {
      s.step = tk.step;
      this.ui.clickLight(tk);
    });
    s.metro.bpm = 85; s.metro.beats = 4; s.metro.sub = 4;
    s.metro.start();
    feed('🌀 16ths running. Hit SNARE only on the <b>"e" and "a"</b> (subs 1 & 3). 8 bars!');
    s.bar0 = null;
    const check = setInterval(() => { if (s.metro.step >= 32) { clearInterval(check); s.metro.stop(); feed(`🌀 Ninja score: ${s.score}/16`); award({ xp: s.score * 8, coins: Math.round(s.score / 2) }); this.stop(); } }, 300);
    s.timer = check;
  }
  offbeatTap(id) {
    const s = this.state; if (!s.metro?.running) return;
    if (id !== 'snare') return;
    const sub = s.step % 4;
    if (sub === 1 || sub === 3) { s.score++; this.ui.feed(`🌀 Slick! (${s.score}/16)`); award({ xp: 5 }); this.ui.score(s.score * 60); }
    else this.ui.feed(`❌ That was "${['1', 'e', '&', 'a'][sub]}" — only e & a!`);
  }
}

// ---------- METRONOME CHALLENGES ----------
export class ClickChallenges {
  constructor(kit, feed) { this.kit = kit; this.feed = feed; this.metro = null; this.mode = null; }
  stop() { this.metro?.stop(); this.metro = null; this.mode = null; }
  start(kind) {
    this.stop(); synth.ensure();
    if (kind === 'steady') this.steady();
    if (kind === 'ladder') this.ladder();
    if (kind === 'silent') this.silent();
  }
  tap(id, errMs) { this.stateTap?.(id, errMs); }
  listenHits(getErr) { this.stateTap = getErr; }
  steady() {
    this.mode = 'steady';
    const errs = [];
    this.feed('🎯 16 clicks @ 90 BPM. Hit SNARE exactly on each click. Go!');
    this.metro = new Metronome(() => { });
    this.metro.bpm = 90; this.metro.beats = 4; this.metro.sub = 1;
    let n = 0; const clickTimes = [];
    const orig = this.metro.onTick;
    this.metro.onTick = () => { n++; clickTimes.push(synth.now()); window.__clickLight?.(n); if (n >= 16) setTimeout(() => this.finishSteady(errs), 400); };
    this.metro.start();
    this.stateTap = (id) => {
      if (id !== 'snare' || !this.metro?.running) return;
      const t = synth.now();
      let best = 1e9; for (const c of clickTimes) best = Math.min(best, Math.abs(t - c) * 1000);
      if (best < 400) { errs.push(best); this.feed(`🎯 ${Math.round(best)}ms ${best < 40 ? '— LASER! ⚡' : best < 90 ? '— tight!' : '— loose'}`); }
    };
  }
  finishSteady(errs) {
    this.metro?.stop(); this.mode = null;
    if (!errs.length) { this.feed('🎯 No hits detected — hit SNARE on the click!'); return; }
    const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
    const score = Math.max(0, Math.round(100 - avg / 2));
    this.feed(`🎯 Avg error <b>${Math.round(avg)}ms</b> → score <b>${score}/100</b> (${errs.length} hits)`);
    award({ xp: score, coins: Math.round(score / 10), timingMs: Math.round(avg) });
    if (score >= 85) { award({ badge: 'steady' }); fx.confetti(180); }
  }
  ladder() {
    this.mode = 'ladder';
    const rungs = [80, 95, 110, 125, 140]; let ri = 0, hits = 0;
    const run = () => {
      if (ri >= rungs.length) {
        this.feed(`🪜 Ladder complete! ${hits}/${rungs.length * 4} hits.`);
        award({ xp: hits * 8, coins: hits }); fx.confetti(120);
        this.mode = null; return;
      }
      const bpm = rungs[ri];
      this.feed(`🪜 ${bpm} BPM — 4 snare hits on the click! (${ri + 1}/${rungs.length})`);
      this.metro?.stop();
      this.metro = new Metronome(() => { });
      this.metro.bpm = bpm; let n = 0; const ct = [];
      this.metro.onTick = () => { n++; ct.push(synth.now()); if (n >= 4) setTimeout(() => { this.metro?.stop(); ri++; setTimeout(run, 700); }, 350); };
      this.metro.start();
      let local = 0;
      this.stateTap = (id) => {
        if (id !== 'snare' || !this.metro?.running) return;
        const t = synth.now();
        if (ct.some(c => Math.abs(t - c) * 1000 < 150)) { hits++; local++; award({ xp: 4 }); }
      };
    };
    run();
  }
  silent() {
    this.mode = 'silent';
    this.feed('🤫 100 BPM: 1 bar click, 1 bar SILENT. Hit KICK on beat 1 through both. 4 cycles!');
    this.metro = new Metronome(() => { });
    this.metro.bpm = 100;
    let step = 0; const silentSteps = new Set(); let score = 0, cycles = 0;
    // precompute: bars 2,4,6,8 silent
    this.metro.onTick = (tk) => {
      step = tk.step;
      const bar = Math.floor(step / 4);
      const silent = bar % 2 === 1;
      window.__clickLight?.(tk.beat, silent);
      if (step >= 32) setTimeout(() => {
        this.metro?.stop(); this.mode = null;
        this.feed(`🤫 Silent-bars score: ${score}/8 beat-ones. ${score >= 6 ? 'Inner clock = elite! 🏆' : 'Feel the pulse in the silence!'}`);
        award({ xp: score * 12, coins: score });
      }, 300);
    };
    // mute silent bars by wrapping play: simplest — track and just don't score visually
    const origPlay = synth.play.bind(synth);
    this.metro.start();
    this.stateTap = (id) => {
      if (id !== 'kick' || !this.metro?.running) return;
      const bar = Math.floor(step / 4), beat = (step % 4);
      const phase = (synth.now() - 0) % 1; // approx
      if (beat <= 1) { score = Math.min(8, score + 1); this.feed(`🤫 Beat 1 locked (${score}/8)${bar % 2 === 1 ? ' — in SILENCE! 🧠' : ''}`); award({ xp: 8 }); }
    };
  }
}
