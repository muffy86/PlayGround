import { ensureAudio, playDrum, click, now } from './audio.js';
import { lessonById, patternToRush } from './notation.js';
import { state, save, addXP, addCoins, bumpStreak, resetStreak } from './state.js';
import { judge, confetti, buzz, floatXP, toast } from './ui.js';
import { PolyrhythmQuantizer, createQuantizeResult, practiceTelemetry, juiceSynth, triggerHaptic, sensorySettings, cameraTrauma } from './engine/index.ts';

/**
 * Phase 3 arcade juice for one judged strike. Audio/haptics/shake must never
 * break gameplay, so every call is guarded. Combo chimes climb C4→C6 while
 * hits land; a MISS slams the low-pass dip and resets the ladder.
 */
function juiceHit(rating, offsetMs, combo) {
  try {
    const lv = sensorySettings.get();
    triggerHaptic(rating, lv.haptics);
    cameraTrauma.hit(rating, offsetMs, lv.shake);
    if (rating === 'MISS') {
      try { juiceSynth.missDip(); } catch { /* audio not ready */ }
    } else {
      try { juiceSynth.chime(Math.max(0, combo - 1)); } catch { /* audio not ready */ }
    }
  } catch { /* juice is best-effort */ }
}

// ---- Phase 1 engine: grid authority for rush judging ----
// 16 semiquaver slots per 4-quarter cycle mirrors the lesson patterns.
// One shared quantizer + one shared result object, reused forever — the
// scoring hot path allocates nothing.
const quant = new PolyrhythmQuantizer({
  bpm: 90,
  ticksPerQuarter: 480,
  slotsPerCycle: 16,
  quartersPerCycle: 4,
  perfectMs: 45,
  greatMs: 120,
  label: '4/4-16',
});
const qOut = createQuantizeResult();
export function getQuantizer() { return quant; }
/** Keep engine tempo glued to the game transport (call after any bpm change). */
export function syncEngineTempo() {
  if (quant.bpm !== game.bpm) quant.setBpm(game.bpm);
}

/** Record a measured strike offset for the latency heatmap. Never throws into gameplay. */
function logDeviation(drum, offsetMs, rating) {
  if (!Number.isFinite(offsetMs)) return;
  const safe = rating === 'PERFECT' || rating === 'GREAT' || rating === 'GOOD' || rating === 'MISS' ? rating : 'MISS';
  try {
    practiceTelemetry.push({
      timeMs: typeof performance !== 'undefined' ? performance.now() : 0,
      offsetMs,
      drum,
      rating: safe,
    });
  } catch { /* unknown drum must not break the transport */ }
}

export const game = {
  mode: 'free',
  lesson: lessonById('beat1'),
  bpm: 90,
  playing: false,
  // transport
  t0: 0, beat0: 0, timer: null,
  step: 0,
  rushNotes: [],
  lanes: ['hihat', 'snare', 'kick', 'tom1'],
  hits: 0, attempts: 0, combo: 0, maxCombo: 0, perfects: 0,
  expected: new Map(), // "loop:step:drum" -> {beat, hit}
  loops: 0,
  hitFlash: null,
  onTick: null, onEnd: null, onScore: null,
  metro: { on: false, bpm: 100, nextT: 0, beat: 0, timer: null, taps: [], streak: 0, best: 0, strict: 50, beatsFx: [] },
  mini: null,
};

function spb() { return 60 / game.bpm; }

export function setLesson(id, bpmOverride) {
  game.lesson = lessonById(id);
  if (bpmOverride) game.bpm = bpmOverride;
  else game.bpm = game.lesson.bpm;
  document.getElementById('bpm').value = game.bpm;
  document.getElementById('bpmVal').textContent = game.bpm;
  buildExpected();
  syncEngineTempo();
}
function buildExpected() {
  game.rushNotes = patternToRush(game.lesson, game.lanes);
  game.expected.clear();
  for (let loop = 0; loop < 99; loop++) {
    for (const [drum, arr] of Object.entries(game.lesson.steps)) {
      arr.forEach((v, s) => {
        if (v) game.expected.set(`${loop}:${s}:${drum}`, { beat: loop * 4 + s / 4, hit: false });
      });
    }
  }
}

export function beatNow() {
  if (!game.playing) return 0;
  return game.beat0 + (now() - game.t0) / spb();
}
export function stepNow() { return beatNow() * 4; }

export function start() {
  ensureAudio();
  stop();
  game.playing = true;
  game.t0 = now() + 0.15;
  game.beat0 = 0;
  lastClickBeat = -1; lastLoopCount = 0;
  game.hits = 0; game.attempts = 0; game.combo = 0; game.maxCombo = 0; game.perfects = 0;
  game.loops = 0;
  for (const v of game.expected.values()) v.hit = false;
  for (const n of game.rushNotes) n.judged = false;
  // schedule clicks + miss detection
  game.timer = setInterval(scheduler, 40);
  document.getElementById('btnPlay').textContent = '⏹ STOP';
}
export function stop() {
  game.playing = false;
  if (game.timer) clearInterval(game.timer);
  game.timer = null;
  const b = document.getElementById('btnPlay');
  if (b) b.textContent = '▶ START';
}

let lastClickBeat = -1, lastLoopCount = 0;
function scheduler() {
  if (!game.playing) return;
  const b = beatNow();
  // metronome clicks for next 0.15s
  const ahead = b + 0.2;
  for (let bi = Math.max(0, Math.ceil(lastClickBeat + 0.001)); bi <= Math.floor(ahead); bi++) {
    if (bi > lastClickBeat) {
      const t = game.t0 + (bi - game.beat0) * spb();
      if (t >= now() - 0.05) {
        const bar16 = bi % 4 === 0;
        if (game.mode === 'free') { /* silent-ish shaker */ if (bi % 2 === 0) playDrum('shaker', t, 0.4); }
        else click(bi % 4 === 0, t);
        if (game.mode === 'metro') pushMetroFx(bi % 4 === 0);
      }
      lastClickBeat = bi;
    }
  }
  if (game.mode === 'read' || game.mode === 'rush') {
    // miss detection: any expected beat older than 0.22s unhit -> miss
    const missWindowBeats = 0.22 / spb();
    const loop = Math.floor(b / 4);
    if (loop !== lastLoopCount) {
      lastLoopCount = loop;
      scoreRound(loop - 1);
    }
    // rush individual note miss marking for display
    for (const n of game.rushNotes) {
      if (!n.judged && b - n.beat > missWindowBeats && n.beat < b) {
        if (n.beat > 0 && n.beat < 16) { /* judged as miss lazily on next hit check */ }
      }
    }
  }
  game.onTick?.(b);
}

function scoreRound(loop) {
  if (loop < 0 || game.mode === 'free') return;
  // count expected in that loop
  let exp = 0, got = 0;
  for (const [k, v] of game.expected) {
    const [l] = k.split(':');
    if (+l !== loop) continue;
    // only count drums in lesson
    exp++;
    if (v.hit) got++;
  }
  if (exp === 0) return;
  const acc = got / exp;
  if (acc >= 0.9 && exp >= 6) {
    bumpStreak();
    const xp = 25 + game.lesson ? 10 : 0;
    const ups = addXP(30);
    addCoins(8);
    confetti(60);
    buzz(40);
    judge('LOOP CLEAR!', 'perfect', `${Math.round(acc * 100)}% · +30 XP`);
    floatXP(30);
    if (ups) levelUpFx();
  } else if (acc >= 0.6) {
    const ups = addXP(12);
    addCoins(3);
    judge('NICE GROOVE', 'great', `${Math.round(acc * 100)}% · +12 XP`);
    floatXP(12);
    if (ups) levelUpFx();
  }
  game.onScore?.();
}

// ---- player hits ----
export function playerHit(drum, vel = 1) {
  ensureAudio();
  playDrum(drum, null, vel);
  state.totalHits++; save();
  if (game.mini) { miniHit(drum); return { judged: false }; }
  if (!game.playing || game.mode === 'free') {
    if (game.playing && game.mode === 'metro') return { judged: false };
    // free play juice
    game.combo = 0;
    return { judged: false };
  }
  const b = beatNow();
  if (game.mode === 'read') return judgeRead(drum, b);
  if (game.mode === 'rush') return judgeRush(drum, b);
  return { judged: false };
}

function judgeRead(drum, b) {
  const loop = Math.floor(b / 4);
  const sFloat = (b - loop * 4) * 4;
  // find nearest expected step with this drum in this loop
  const arr = game.lesson.steps[drum];
  let best = null, bestDist = 99;
  if (arr) {
    for (let s = 0; s < 16; s++) {
      if (!arr[s]) continue;
      // distance in steps, wrap
      let d = Math.abs(s - sFloat);
      d = Math.min(d, 16 - d);
      if (d < bestDist) { bestDist = d; best = s; }
    }
  }
  game.attempts++;
  const tolSteps = 1.6; // ~ generous
  let signedMs = null;
  if (best !== null) {
    let signedSteps = sFloat - best;
    if (signedSteps > 8) signedSteps -= 16;
    if (signedSteps < -8) signedSteps += 16;
    signedMs = signedSteps * spb() * 1000 / 4;
  }
  if (best !== null && bestDist <= tolSteps) {
    const key = `${loop}:${best}:${drum}`;
    const rec = game.expected.get(key);
    const msOff = bestDist * spb() * 1000 / 4;
    if (rec && !rec.hit) {
      rec.hit = true;
      game.hits++; game.combo++; game.maxCombo = Math.max(game.maxCombo, game.combo);
      game.hitFlash = { drum, step: best };
      setTimeout(() => game.hitFlash = null, 180);
      const ms = Math.round(msOff);
      const rating = ms < 45 ? 'PERFECT' : ms < 90 ? 'GREAT' : 'GOOD';
      logDeviation(drum, signedMs, rating);
      if (ms < 45) { game.perfects++; addXP(5); judge('PERFECT', 'perfect', `${drum} · ${ms}ms · +5XP`); confetti(24); juiceHit('PERFECT', signedMs, game.combo); }
      else if (ms < 90) { addXP(3); judge('GREAT', 'great', `${drum} · ${ms}ms · +3XP`); juiceHit('GREAT', signedMs, game.combo); }
      else { addXP(2); judge('GOOD', 'good', `${drum} · ${ms}ms · +2XP`); juiceHit('GOOD', signedMs, game.combo); }
      bumpStreakLite();
      game.onScore?.();
      return { judged: true, ok: true };
    } else if (rec?.hit) {
      return { judged: true, ok: true, dup: true };
    }
  }
  // wrong drum / timing
  game.combo = 0; resetStreak();
  logDeviation(drum, signedMs ?? 200, 'MISS');
  judge('MISS', 'miss', drum);
  playDrum('bad', null, 0.4);
  juiceHit('MISS', signedMs ?? 200, 0);
  game.onScore?.();
  return { judged: true, ok: false };
}

function judgeRush(drum, b) {
  void b;
  game.attempts++;
  // Audio-locked engine time: ms since transport start, scored against the
  // 16-slot grid by the zero-allocation quantizer (millisecond accuracy).
  const msSinceStart = (now() - game.t0) * 1000;
  quant.scoreMs(msSinceStart, qOut);
  return applyGridHit(drum, qOut.slot, qOut.cycle, qOut.rating, qOut.offsetMs);
}

/**
 * Score a raw MIDI tick (e.g. from an e-drum kit via MidiTickSource)
 * against the same grid. Shared outcome path with `judgeRush` so pads,
 * touchscreen, and MIDI hardware judge identically.
 */
export function playerHitTick(tick, drum, vel = 1) {
  ensureAudio();
  playDrum(drum, null, vel);
  state.totalHits++; save();
  if (game.mini) { miniHit(drum); return { judged: false }; }
  if (!game.playing || (game.mode !== 'read' && game.mode !== 'rush')) return { judged: false };
  game.attempts++;
  quant.scoreTick(Math.round(tick), qOut);
  return applyGridHit(drum, qOut.slot, qOut.cycle, qOut.rating, qOut.offsetMs);
}

/**
 * Shared grid-hit outcome: the pattern must actually call for `drum` on
 * this cycle/slot (and not already be claimed); the quantizer rating then
 * decides PERFECT / GREAT / MISS with the standard XP and combo effects.
 */
function applyGridHit(drum, slot, cycle, rating, offsetMs) {
  logDeviation(drum, offsetMs, rating);
  const steps = game.lesson.steps[drum];
  const expectedHere = !!steps && steps[slot % steps.length] === 1;
  const key = `${cycle}:${slot}:${drum}`;
  const rec = game.expected.get(key);
  if (expectedHere && (!rec || !rec.hit)) {
    if (rec) rec.hit = true;
    markRushNoteJudged(drum, cycle, slot);
    game.hits++; game.combo++; game.maxCombo = Math.max(game.maxCombo, game.combo);
    const ms = Math.round(Math.abs(offsetMs));
    if (rating === 'PERFECT') { game.perfects++; addXP(6); judge('PERFECT', 'perfect', `+6XP · x${game.combo} · ${ms}ms`); confetti(30); juiceHit('PERFECT', offsetMs, game.combo); }
    else if (rating === 'GREAT') { addXP(4); judge('GREAT', 'great', `+4XP · x${game.combo} · ${ms}ms`); juiceHit('GREAT', offsetMs, game.combo); }
    else { addXP(2); judge('GOOD', 'good', `+2XP · x${game.combo} · ${ms}ms`); juiceHit('GOOD', offsetMs, game.combo); }
    // combo bonus every 10
    if (game.combo % 10 === 0) { addCoins(5); addXP(10); toast(`🔥 ${game.combo} COMBO! +10 XP +5🪙`); confetti(70); }
    bumpStreakLite();
    game.onScore?.();
    return { judged: true, ok: true };
  }
  game.combo = 0; resetStreak();
  judge('MISS', 'miss', drum);
  juiceHit('MISS', offsetMs, 0);
  game.onScore?.();
  return { judged: true, ok: false };
}

/** Mirror a grid hit onto the display-note list so the highway clears it. */
function markRushNoteJudged(drum, cycle, slot) {
  const targetBeat = cycle * 4 + slot / 4;
  for (const n of game.rushNotes) {
    if (!n.judged && n.drum === drum && Math.abs(n.beat - targetBeat) < 0.01) {
      n.judged = true;
      break;
    }
  }
}
function bumpStreakLite() { state.streak++; state.bestStreak = Math.max(state.bestStreak, state.streak); save(); }

// ---- metronome dojo ----
function pushMetroFx(accent) {
  game.metro.beatsFx.push({ t: 0, accent });
  if (game.metro.beatsFx.length > 6) game.metro.beatsFx.shift();
}
export function metroStart(bpm, strict) {
  ensureAudio();
  metroStop(true);
  game.metro.on = true; game.metro.bpm = bpm; game.metro.strict = strict;
  game.metro.beat = 0; game.metro.taps = []; game.metro.streak = 0;
  game.metro.nextT = now() + 0.2;
  game.metro.timer = setInterval(() => {
    const m = game.metro;
    while (m.nextT < now() + 0.25) {
      const accent = m.beat % 4 === 0;
      click(accent, m.nextT);
      m.nextT += 60 / m.bpm;
      m.beat++;
      m.beatsFx.push({ t: 0, accent });
    }
  }, 30);
}
export function metroStop(silent) {
  game.metro.on = false;
  if (game.metro.timer) clearInterval(game.metro.timer);
  game.metro.timer = null;
  if (!silent) { /* keep scores */ }
}
export function metroTap() {
  const m = game.metro;
  if (!m.on) { toast('Press START CLICK first ⏱'); return null; }
  ensureAudio();
  const t = now();
  // nearest click time
  const beatFloat = (t - (m.nextT - m.beat * (60 / m.bpm))) / (60 / m.bpm);
  // simpler: compute phase from nextT
  const interval = 60 / m.bpm;
  const prevClick = m.nextT - interval * Math.round((m.nextT - t) / interval);
  // find closest click among prev/next
  let best = 1e9;
  for (let k = -1; k <= 1; k++) {
    const c = m.nextT + k * interval;
    // actually nextT is future click; past clicks = nextT - n*interval
  }
  // reconstruct: last scheduled beat time
  const off = ((t - m.nextT) % interval + interval * 1.5) % interval - interval / 2;
  const ms = Math.round(off * 1000);
  const abs = Math.abs(ms);
  playDrum('kick', null, 1);
  m.taps.push(ms);
  if (m.taps.length > 40) m.taps.shift();
  const tol = m.strict;
  let res;
  if (abs <= tol * 0.5) { res = 'PERFECT'; addXP(4); m.streak++; judge('PERFECT', 'perfect', `${ms}ms · +4XP`); confetti(20); juiceHit('PERFECT', ms, m.streak); }
  else if (abs <= tol) { res = 'GREAT'; addXP(2); m.streak++; judge('GREAT', 'great', `${ms}ms · +2XP`); juiceHit('GREAT', ms, m.streak); }
  else if (abs <= tol * 2) { res = 'EARLY/LATE'; m.streak = 0; judge(abs > 0 ? 'LATE' : 'EARLY', 'good', `${ms}ms`); juiceHit('GOOD', ms, 0); }
  else { res = 'MISS'; m.streak = 0; resetStreak(); judge('MISS', 'miss', `${ms}ms`); juiceHit('MISS', ms, 0); }
  logDeviation('kick', ms, res === 'EARLY/LATE' ? 'GOOD' : res);
  m.best = Math.max(m.best, m.streak);
  if (m.streak > 0 && m.streak % 8 === 0) { addCoins(4); addXP(8); toast(`⏱ Pocket streak ${m.streak}! +8XP`); confetti(50); }
  save();
  return { ms, res, streak: m.streak };
}

// ---- minis ----
export function miniStart(kind) {
  ensureAudio();
  game.mini = { kind, step: 0, score: 0, seq: [], pos: 0, accept: false, t0: 0, hits: new Set(), count: 0, timer: null };
  const M = game.mini;
  if (kind === 'simon') {
    M.seq = [randDrum(), randDrum(), randDrum()];
    playSimon();
  } else if (kind === 'limb') {
    M.pattern = ['snare', 'kick', 'snare', 'kick', 'snare', 'kick', 'snare', 'kick'];
    M.pos = 0; M.accept = true; M.score = 0;
  } else if (kind === 'fill') {
    M.t0 = performance.now(); M.count = 0; M.hits = new Set();
    M.timer = setTimeout(() => miniEndFill(), 30000);
  }
  return M;
}
function randDrum() {
  const pool = ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'floor', 'crash'];
  return pool[Math.floor(Math.random() * pool.length)];
}
function playSimon() {
  const M = game.mini;
  M.accept = false; M.pos = 0;
  M.seq.forEach((d, i) => {
    setTimeout(() => {
      playDrum(d);
      window.dispatchEvent(new CustomEvent('simon-flash', { detail: d }));
      if (i === M.seq.length - 1) setTimeout(() => { M.accept = true; }, 450);
    }, 500 + i * 550);
  });
}
function miniHit(drum) {
  const M = game.mini;
  if (!M) return;
  if (M.kind === 'simon' && M.accept) {
    if (drum === M.seq[M.pos]) {
      M.pos++;
      addXP(2);
      if (M.pos >= M.seq.length) {
        M.score = M.seq.length;
        judge('NICE EARS!', 'great', `round ${M.score}`);
        confetti(30);
        M.seq.push(randDrum());
        state.bestSimon = Math.max(state.bestSimon, M.score); save();
        setTimeout(playSimon, 700);
      }
    } else {
      judge('WRONG!', 'miss', `reached ${M.seq.length}`);
      playDrum('bad');
      M.accept = false;
      const sc = M.seq.length;
      state.bestSimon = Math.max(state.bestSimon, sc - 1); save();
      addXP(sc); addCoins(Math.floor(sc / 2));
      toast(`👂 Ear Copy: ${sc - 1} rounds · +${sc} XP`);
      miniEnd();
    }
  } else if (M.kind === 'limb') {
    const want = M.pattern[M.pos % M.pattern.length];
    if (drum === want) {
      M.pos++; M.score++; addXP(1);
      if (M.score % 8 === 0) { judge('LIMBS LOCKED', 'perfect', `${M.score}`); confetti(25); addCoins(2); }
    } else {
      judge('SWAP!', 'miss', `want ${want}`);
      M.score = Math.max(0, M.score - 1);
    }
    state.bestLimb = Math.max(state.bestLimb, M.score); save();
  } else if (M.kind === 'fill') {
    M.count++; M.hits.add(drum);
  }
}
function miniEndFill() {
  const M = game.mini;
  if (!M || M.kind !== 'fill') return;
  const variety = M.hits.size;
  const score = M.count + variety * 5;
  state.bestFill = Math.max(state.bestFill, score); save();
  addXP(Math.min(80, 10 + score)); addCoins(5 + Math.floor(variety / 2));
  confetti(120);
  judge('FILL FRENZY!', 'perfect', `${M.count} hits · ${variety} drums · +XP`);
  toast(`🌪 Fill Frenzy: ${M.count} hits, ${variety} drums`);
  playDrum('win');
  miniEnd();
}
export function miniEnd() {
  if (game.mini?.timer) clearTimeout(game.mini.timer);
  game.mini = null;
}
function levelUpFx() {
  const el = document.getElementById('levelUp');
  document.getElementById('levelUpSub').textContent = `Level ${state.level} · ${rankName()} · keep grooving!`;
  el.classList.remove('hidden');
  playDrum('win');
  confetti(160);
  buzz([30, 50, 30]);
}
import { rankFor } from './state.js';
function rankName() { return rankFor(state.level); }
export function levelUpCheck(ups) { if (ups > 0) levelUpFx(); }
