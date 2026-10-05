import './style.css';
import { initScene, strike, setKitMode, setHitCallback, PAD_DEFS } from './kit3d.js';
import { ensureAudio, playDrum, setAudioKit, toggleMute, isMuted } from './audio.js';
import { LESSONS, drawStaff, lessonById } from './notation.js';
import { game, setLesson, start, stop, beatNow, stepNow, playerHit, playerHitTick, getQuantizer, syncEngineTempo, metroStart, metroStop, metroTap, miniStart, miniEnd } from './game.js';
import { drumSession, practiceTelemetry, ToolBridge, attachLiveModelContext, attachLiveRuntime, NoteHighway, EngineLoop, MidiClock, MidiTickSource, juiceSynth, registerSensoryTools, offsetStrip } from './engine/index.ts';
import { state, save, xpForLevel, rankFor, addXP, addCoins } from './state.js';
import { judge, confetti, buzz, toast, tapFlash, floatXP, ringBurst } from './ui.js';

const $ = (id) => document.getElementById(id);
const staff = $('staff');

// ---------- boot + scene ----------
initScene($('scene'));
setHitCallback((id) => hitDrum(id, 1));
addEventListener('pointerdown', () => ensureAudio(), { once: true });
// Phase 3 juice synth warms up on first gesture (autoplay-safe).
addEventListener('pointerdown', () => {
  try { juiceSynth.ensure(); juiceSynth.resume(); } catch { /* audio not ready */ }
}, { once: true });
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  ensureAudio();
  const k = e.key === ' ' ? 'Space' : e.key.toUpperCase();
  const pad = PAD_DEFS.find(p => p.key === k || p.key.toUpperCase() === k);
  if (pad) hitDrum(pad.id, 1);
  if (k === 'M') toggleMuteUi();
});
setTimeout(() => document.getElementById('boot').classList.add('gone'), 600);

// ---------- pads ----------
const padsEl = $('pads');
for (const p of PAD_DEFS) {
  const d = document.createElement('div');
  d.className = 'pad'; d.dataset.drum = p.id;
  d.style.setProperty('--glow', p.glow);
  d.innerHTML = `<div class="e">${p.emoji}</div><div class="n">${p.label}</div><div class="k">${p.key === 'Space' ? 'SPACE' : p.key}</div>`;
  const fire = (e) => { e.preventDefault(); ensureAudio(); hitDrum(p.id, 1); };
  d.addEventListener('pointerdown', fire);
  padsEl.appendChild(d);
}
function flashPad(id) {
  const el = padsEl.querySelector(`[data-drum="${id}"]`);
  if (!el) return;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
addEventListener('simon-flash', (e) => { strike(e.detail, 1); flashPad(e.detail); playDrum(e.detail); });

// ---------- lessons ----------
const sel = $('lessonSel');
for (const l of LESSONS) {
  const o = document.createElement('option');
  o.value = l.id; o.textContent = l.name;
  sel.appendChild(o);
}
sel.addEventListener('change', () => {
  setLesson(sel.value);
  $('modeSub').textContent = game.lesson.teach;
  stop();
});
setLesson('beat1');
$('modeSub').textContent = game.lesson.teach;

// ---------- Phase 1 engine: rush highway on the rAF loop ----------
// The NoteHighway holds preallocated note coordinates; one EngineLoop steps
// it every animation frame with audio-locked engine time, so note positions
// are continuous functions of the transport — never tweened, never allocated.
const RUSH_LOOPS = 4;
const RUSH_COLORS = { kick: '#ff8a3d', snare: '#ff4ecd', hihat: '#38f0ff', hihatOpen: '#38f0ff', tom1: '#7b5cff', tom2: '#9b8cff', floor: '#b06cff', crash: '#ffd166', ride: '#7CFF6B' };
let rushHighway = null, rushFrame = null, rushLoop = null, rushBuiltFor = '';
const rushKey = () => `${game.lesson.id}|${game.bpm}|${staff.clientWidth | 0}`;
function rebuildRushEngine() {
  const quant = getQuantizer();
  const W = staff.clientWidth || 700;
  rushHighway = new NoteHighway({
    maxNotes: 512,
    laneCount: game.lanes.length,
    hitS: 89,          // matches the glowing hit ring (px from the left)
    spawnS: W + 40,    // notes glide in from the right edge
    approachMs: 2000,
    missMs: quant.greatMs,
  });
  rushFrame = rushHighway.createFrame();
  const slotMs = quant.slotMs; // one 16th in the 16-slots-per-cycle grid
  for (let L = 0; L < RUSH_LOOPS; L++) {
    for (const drum of game.lanes) {
      const arr = game.lesson.steps[drum];
      if (!arr) continue;
      const lane = game.lanes.indexOf(drum);
      for (let s = 0; s < arr.length; s++) {
        if (arr[s]) rushHighway.spawn((L * 16 + s) * slotMs, lane, L * 16 + s);
      }
    }
  }
  rushLoop = new EngineLoop(rushHighway, rushFrame, { onFrame: drawRushFrame });
  rushBuiltFor = rushKey();
}
function drawRushFrame(frame) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = staff.clientWidth || 700, H = staff.clientHeight || 86;
  if (staff.width !== Math.round(W * dpr) || staff.height !== Math.round(H * dpr)) {
    staff.width = Math.round(W * dpr); staff.height = Math.round(H * dpr);
  }
  const g = staff.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const lanes = game.lanes;
  const laneH = H / lanes.length;
  g.font = '700 9px system-ui';
  lanes.forEach((drum, i) => {
    const y = i * laneH;
    g.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.09)';
    g.fillRect(0, y, W, laneH - 1);
    g.fillStyle = (RUSH_COLORS[drum] || '#fff') + 'cc';
    g.fillText(drum.toUpperCase(), 6, y + 12);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(86, y, 3, laneH - 1);
    g.fillStyle = RUSH_COLORS[drum] || '#fff';
    g.beginPath(); g.arc(87, y + laneH / 2, 9, 0, 7); g.fill();
  });
  for (let i = 0; i < frame.count; i++) {
    const x = frame.s[i];
    if (x < -20 || x > W + 20) continue;
    const drum = lanes[frame.lane[i]];
    const y = frame.lane[i] * laneH + laneH / 2;
    g.save();
    g.shadowColor = RUSH_COLORS[drum] || '#fff'; g.shadowBlur = 10;
    g.fillStyle = RUSH_COLORS[drum] || '#fff';
    g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#0b0721'; g.font = '900 9px system-ui'; g.textAlign = 'center';
    g.fillText(drum[0].toUpperCase(), x, y + 3);
    g.restore();
  }
}

// ---------- live MIDI drums → raw ticks → quantizer ----------
const midiClock = new MidiClock(90, 480, 0);
const midiSrc = new MidiTickSource(midiClock);
const GM_TO_DRUM = {
  36: 'kick', 38: 'snare', 40: 'snare', 42: 'hihat', 44: 'hihat',
  46: 'hihatOpen', 48: 'tom1', 50: 'tom2', 43: 'floor',
  49: 'crash', 51: 'ride', 53: 'ride',
};
midiSrc.onNote((tick, note, vel) => {
  const drum = GM_TO_DRUM[note];
  if (!drum) return;
  strike(drum, vel);
  flashPad(drum);
  playerHitTick(tick, drum, vel);
  updateHud();
});
midiSrc.attach().then((ok) => {
  if (ok) toast('🎹 MIDI drums connected — play!');
}).catch(() => { /* device errors stay silent; pads still work */ });

// ---------- kit toggle ----------
document.querySelectorAll('.kitBtn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.kitBtn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    setKitMode(b.dataset.kit);
    setAudioKit(b.dataset.kit);
    drumSession.configure({ mode: b.dataset.kit }).catch(() => {});
    toast(b.dataset.kit === 'electric' ? '⚡ Electric kit engaged' : '🥁 Acoustic kit engaged');
    playDrum('crash');
    strike('crash', 1);
  });
});

// ---------- transport ----------
$('btnPlay').addEventListener('click', () => {
  ensureAudio();
  if (game.playing) { stop(); if (game.mode === 'rush') rebuildRushEngine(); }
  else {
    if (game.mode === 'metro') { toast('Use START CLICK in the Dojo ⏱'); return; }
    if (game.mode === 'minis') { toast('Pick a mini game below 🎁'); return; }
    start();
    midiClock.setBpm(game.bpm);
    // Transport t0 is audio-clock; performance.now() runs the same rate, so
    // anchoring the MIDI tick origin here keeps e-drum ticks within a few ms
    // of the grid (well inside the GREAT window).
    midiClock.setOrigin(performance.now() + 150);
    if (game.mode === 'rush') rebuildRushEngine();
    toast(`${game.lesson.name} · ${game.bpm} BPM — follow the cursor!`);
  }
});
$('bpm').addEventListener('input', (e) => {
  game.bpm = +e.target.value;
  $('bpmVal').textContent = game.bpm;
  syncEngineTempo();
  midiClock.setBpm(game.bpm);
  drumSession.configure({ bpm: game.bpm }).catch(() => {});
});
$('btnSound').addEventListener('click', toggleMuteUi);
function toggleMuteUi() {
  ensureAudio();
  const m = toggleMute();
  $('btnSound').textContent = m ? '🔇' : '🔊';
  drumSession.configure({ muted: m }).catch(() => {});
}

// ---------- modes ----------
const titles = {
  free: ['FREE PLAY', 'tap the drums · drag to orbit'],
  read: ['READ & GROOVE 🎼', 'hit the right drum when the cursor arrives'],
  rush: ['RHYTHM RUSH ⚡', 'notes fly at the glowing ring — strike in time'],
  metro: ['METRONOME DOJO ⏱', 'tap IN the pocket · build streaks'],
  minis: ['REWARD ARCADE 🎁', 'tiny games · ear, limbs, chops, loot'],
};
document.querySelectorAll('.modeBtn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.modeBtn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    game.mode = b.dataset.mode;
    stop(); metroStop(true); miniEnd(); hideMiniStage();
    $('modeTitle').textContent = titles[game.mode][0];
    $('modeSub').textContent = game.mode === 'read' || game.mode === 'rush' || game.mode === 'free' ? game.lesson.teach : titles[game.mode][1];
    $('sheetPanel').classList.toggle('hidden', game.mode === 'metro' || game.mode === 'minis');
    $('metroPanel').classList.toggle('hidden', game.mode !== 'metro');
    $('miniPanel').classList.toggle('hidden', game.mode !== 'minis');
    if (game.mode === 'rush') { rebuildRushEngine(); toast('⚡ Rush: strike each glowing note as it crosses the ring!'); }
    if (game.mode === 'read') { setLesson(sel.value); toast('🎼 Read the staff — colors match the drums!'); }
  });
});

// ---------- core hit path ----------
function hitDrum(id, vel = 1, fromBridge = false) {
  if (!fromBridge) drumSession.strike(id, vel, performance.now()).catch(() => {});
  strike(id, vel);
  flashPad(id);
  tapFlash();
  buzz(12);
  const res = playerHit(id, vel);
  ringBurst(innerWidth / 2 + (Math.random() - 0.5) * 200, innerHeight * 0.45, PAD_DEFS.find(p => p.id === id)?.glow);
  updateHud();
  return res;
}

// WebMCP + container runtime. Pad/kit actions share drumSession's gate, so a
// tool call during this frame publishes with the rAF commit, never mid-render.
const toolBridge = new ToolBridge(drumSession, {
  onPad: (pad, velocity) => hitDrum(pad, velocity, true),
  onKit: (kit) => {
    setKitMode(kit.mode);
    setAudioKit(kit.mode);
    document.querySelectorAll('.kitBtn').forEach((x) => x.classList.toggle('active', x.dataset.kit === kit.mode));
  },
});
try { registerSensoryTools(toolBridge, { synth: juiceSynth }); } catch { /* already registered */ }
attachLiveModelContext(toolBridge)?.catch(() => {});
attachLiveRuntime(toolBridge);

// ---------- HUD ----------
function updateHud() {
  $('levelNum').textContent = state.level;
  $('playerName').textContent = rankFor(state.level).toUpperCase();
  const need = xpForLevel(state.level);
  $('xpFill').style.width = Math.min(100, state.xp / need * 100) + '%';
  $('xpText').textContent = `${state.xp}/${need} XP`;
  $('coins').textContent = state.coins;
  $('streak').textContent = state.streak;
  const acc = game.attempts ? Math.round(game.hits / game.attempts * 100) + '%' : '—';
  $('acc').textContent = acc;
  if (practiceTelemetry.length > 0) {
    const heat = practiceTelemetry.heatmap();
    $('accPill').title = `mean ${heat.meanMs.toFixed(1)}ms · n=${heat.total} · on-time ${heat.onTime}`;
  }
  const cb = $('comboBadge');
  if (game.combo >= 3) { cb.classList.remove('hidden'); $('comboNum').textContent = '×' + game.combo; }
  else cb.classList.add('hidden');
  $('bestSimon').textContent = 'best ' + state.bestSimon;
  $('bestLimb').textContent = 'best ' + state.bestLimb;
  $('bestFill').textContent = 'best ' + state.bestFill;
}
game.onScore = updateHud;
game.onTick = () => updateHud();
updateHud();
$('levelUpOk').addEventListener('click', () => $('levelUp').classList.add('hidden'));
// also auto-refresh HUD for XP earned in minis/metro
setInterval(updateHud, 800);

// ---------- render loop: staff / highway ----------
function frame() {
  requestAnimationFrame(frame);
  // Open only for this callback. External pad/WebMCP calls between frames
  // apply immediately; anything this frame queues publishes before we yield,
  // so a hidden tab cannot stall the gate.
  drumSession.beginFrame();
  const b = game.playing ? beatNow() : 0;
  const s = game.playing ? stepNow() % 16 : -1;
  if (game.mode === 'rush') {
    // Engine-driven highway: audio-locked ms → continuous coordinates.
    if (!rushHighway || rushBuiltFor !== rushKey()) rebuildRushEngine();
    if (game.playing) {
      rushLoop.step(beatNow() * (60000 / game.bpm));
    } else {
      rushHighway.update(0, rushFrame);
      drawRushFrame(rushFrame);
    }
  } else if (game.mode === 'metro') {
    // drawn in metro loop; keep staff hidden anyway
  } else {
    drawStaff(staff, game.lesson, s, { mode: 'read', playing: game.playing, hitFlash: game.hitFlash, teach: true });
  }
  drawOffsetStrip();
  drumSession.commit();
}

// Phase 3: millisecond timing-offset strip, fed live by the Phase 2 buffer.
const strip = $('strip');
const STRIP_COLORS = { PERFECT: '#38f0ff', GREAT: '#7CFF6B', GOOD: '#ffd166', MISS: '#ff5d5d' };
function drawOffsetStrip() {
  if (!strip || strip.clientWidth === 0) return;
  try {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = strip.clientWidth, H = strip.clientHeight || 30;
    if (strip.width !== Math.round(W * dpr)) { strip.width = Math.round(W * dpr); strip.height = Math.round(H * dpr); }
    const g = strip.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const midY = H / 2;
    // perfect window band (±45 ms of the ±150 ms window)
    g.fillStyle = 'rgba(56,240,255,.10)';
    const bandH = (45 / 150) * (H / 2);
    g.fillRect(0, midY - bandH, W, bandH * 2);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, midY); g.lineTo(W, midY); g.stroke();
    const n = practiceTelemetry.length;
    if (!n) {
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.font = '700 10px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('timing strip — strike a drum', W / 2, midY + 3);
      return;
    }
    const samples = [];
    for (let i = Math.max(0, n - 48); i < n; i++) {
      try { samples.push(practiceTelemetry.at(i)); } catch { /* ignore */ }
    }
    const pts = offsetStrip(samples, { windowMs: 150, maxPoints: 48 });
    // trail
    g.strokeStyle = 'rgba(123,92,255,.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    pts.forEach((p, i) => {
      const x = 8 + p.u * (W - 16);
      const y = midY - p.v * (H / 2 - 4);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    // dots, newest last (on top)
    pts.forEach((p, i) => {
      const x = 8 + p.u * (W - 16);
      const y = midY - p.v * (H / 2 - 4);
      const isNew = i === pts.length - 1;
      g.fillStyle = STRIP_COLORS[p.rating] || '#fff';
      g.shadowColor = g.fillStyle;
      g.shadowBlur = isNew ? 8 : 0;
      g.beginPath();
      g.arc(x, y, isNew ? 4 : 2.5, 0, 7);
      g.fill();
    });
    g.shadowBlur = 0;
  } catch { /* strip must never break the frame */ }
}
frame();

// ---------- metro dojo ----------
const pocket = $('pocket');
$('metroBpm').addEventListener('input', (e) => {
  $('metroBpmVal').textContent = e.target.value;
  if (game.metro.on) metroStart(+e.target.value, +$('strictSel').value);
});
$('metroStart').addEventListener('click', () => {
  ensureAudio();
  if (game.metro.on) { metroStop(); $('metroStart').textContent = 'START CLICK'; $('pocketMsg').textContent = 'paused. press START to groove again.'; }
  else {
    metroStart(+$('metroBpm').value, +$('strictSel').value);
    $('metroStart').textContent = 'STOP';
    $('pocketMsg').textContent = `grooving @ ${$('metroBpm').value} BPM — tap KICK (or TAP) exactly on the click`;
  }
});
const doTap = (e) => { e?.preventDefault?.(); ensureAudio(); strike('kick', 1); flashPad('kick'); const r = metroTap(); if (r) $('metroScore').textContent = `last ${r.ms}ms · ${r.res} · streak ${r.streak} · best ${game.metro.best}`; updateHud(); };
$('tapBtn').addEventListener('pointerdown', doTap);
// metro canvas anim
(function metroFrame() {
  requestAnimationFrame(metroFrame);
  if ($('metroPanel').classList.contains('hidden')) return;
  const g = pocket.getContext('2d');
  const W = pocket.clientWidth || 300, H = 90;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (pocket.width !== W * dpr) { pocket.width = W * dpr; pocket.height = H * dpr; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  // pocket zone
  const tol = +$('strictSel').value;
  const pxPerMs = (W / 2 - 10) / (tol * 2.2);
  g.fillStyle = 'rgba(124,255,107,.15)';
  g.fillRect(W / 2 - tol * pxPerMs, 0, tol * 2 * pxPerMs, H);
  g.fillStyle = 'rgba(56,240,255,.18)';
  g.fillRect(W / 2 - tol * 0.5 * pxPerMs, 0, tol * pxPerMs, H);
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '700 9px system-ui'; g.textAlign = 'center';
  g.fillText('EARLY', 30, 12); g.fillText('LATE', W - 30, 12);
  // taps
  const taps = game.metro.taps.slice(-24);
  taps.forEach((ms, i) => {
    const x = W / 2 + Math.max(-1, Math.min(1, ms / (tol * 2.2))) * (W / 2 - 10);
    const y = H - 8 - (taps.length - 1 - i) * 2.4;
    const good = Math.abs(ms) <= tol;
    g.fillStyle = good ? '#7CFF6B' : '#ff5d5d';
    g.shadowColor = g.fillStyle; g.shadowBlur = 6;
    g.beginPath(); g.arc(x, Math.max(10, y), 4, 0, 7); g.fill(); g.shadowBlur = 0;
  });
  // pulse rings
  game.metro.beatsFx.forEach(fx => fx.t += 0.03);
  game.metro.beatsFx = game.metro.beatsFx.filter(f => f.t < 1);
})();

// ---------- minis ----------
document.querySelectorAll('.miniCard').forEach(c => {
  c.addEventListener('click', () => {
    ensureAudio();
    const kind = c.dataset.mini;
    if (kind === 'chest') return openChest();
    const M = miniStart(kind);
    showMiniStage(kind, M);
  });
});
function showMiniStage(kind, M) {
  $('miniStage').classList.remove('hidden');
  const msg = $('miniMsg'), btns = $('miniBtns');
  btns.innerHTML = '';
  if (kind === 'simon') {
    msg.textContent = '👂 Watch the kit… then repeat the groove!';
    toast('Simon: repeat what you hear — each round +1 note');
  } else if (kind === 'limb') {
    msg.innerHTML = '🦵 Independence: alternate <b style="color:#ff4ecd">LEFT=snare</b> / <b style="color:#ff8a3d">RIGHT=kick</b> — steady!';
    const mk = (label, drum, color) => {
      const b = document.createElement('button');
      b.className = 'btn'; b.style.background = color; b.style.color = '#111'; b.textContent = label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); hitDrum(drum, 1); limbProgress(); });
      btns.appendChild(b);
    };
    mk('◀ LEFT', 'snare', 'linear-gradient(90deg,#ff4ecd,#ff8ac2)');
    mk('RIGHT ▶', 'kick', 'linear-gradient(90deg,#ffd166,#ff8a3d)');
    limbProgress();
  } else if (kind === 'fill') {
    msg.textContent = '🌪 30 seconds — hit EVERYTHING! variety = bonus!';
    const fin = document.createElement('button');
    fin.className = 'btn primary'; fin.textContent = 'FINISH EARLY';
    fin.addEventListener('click', () => finishFillEarly());
    btns.appendChild(fin);
    const tick = setInterval(() => {
      if (!game.mini || game.mini.kind !== 'fill') { clearInterval(tick); return; }
      const el = Math.max(0, 30 - (performance.now() - game.mini.t0) / 1000);
      msg.textContent = `🌪 ${el.toFixed(0)}s — ${game.mini.count} hits · ${game.mini.hits.size} drums!`;
      if (el <= 0) clearInterval(tick);
    }, 300);
  }
}
function limbProgress() {
  const M = game.mini;
  if (!M || M.kind !== 'limb') return;
  const want = M.pattern[M.pos % M.pattern.length];
  $('miniMsg').innerHTML = `🦵 score <b>${M.score}</b> · next: <b style="color:${want === 'snare' ? '#ff4ecd' : '#ff8a3d'}">${want.toUpperCase()}</b> ${'●'.repeat(Math.min(8, M.pos % 8 + 1))}`;
}
function finishFillEarly() {
  const M = game.mini;
  if (!M || M.kind !== 'fill') return;
  M.count = M.count || 0;
  // force end
  const variety = M.hits.size;
  const score = M.count + variety * 5;
  state.bestFill = Math.max(state.bestFill, score); save();
  addXP(Math.min(80, 10 + score)); addCoins(5 + Math.floor(variety / 2));
  confetti(120);
  judge('FILL FRENZY!', 'perfect', `${M.count} hits · ${variety} drums`);
  miniEnd(); hideMiniStage(); updateHud();
}
function hideMiniStage() { $('miniStage')?.classList.add('hidden'); }
$('miniExit').addEventListener('click', () => { miniEnd(); hideMiniStage(); });
function openChest() {
  const nowMs = Date.now();
  const left = nowMs - state.lastChest;
  if (left < 20 * 3600 * 1000 && state.lastChest !== 0) {
    const h = Math.ceil((20 * 3600 * 1000 - left) / 3600000);
    toast(`🎁 Next chest in ~${h}h — keep practicing!`);
    return;
  }
  state.lastChest = nowMs;
  const coins = 15 + Math.floor(Math.random() * 25);
  const xp = 20 + Math.floor(Math.random() * 30);
  addCoins(coins);
  const ups = addXP(xp);
  save(); updateHud();
  confetti(140);
  playDrum('win');
  buzz([40, 60, 40]);
  $('chestInfo').textContent = `+${coins}🪙 +${xp}XP — come back tomorrow!`;
  toast(`🎁 Chest opened: +${coins} coins +${xp} XP!`);
  if (ups) document.getElementById('levelUp').classList.remove('hidden');
}

// first-run hint
setTimeout(() => {
  if (!localStorage.getItem('stickstar-seen')) {
    localStorage.setItem('stickstar-seen', '1');
    toast('👋 Tap drums, or use keys A S F J K L · drag to orbit · try READ mode!');
    confetti(60);
  }
}, 1200);
