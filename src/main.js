import './style.css';
import * as THREE from 'three';
import { PADS, synth, Metronome } from './audio.js';
import { Kit3D } from './kit3d.js';
import { SONGS, LESSONS, BADGES, SHOP, DRUM_STAFF } from './data.js';
import { renderStaff, legendHTML } from './notation.js';
import { TimingFall, Minis, ClickChallenges } from './games.js';
import { store, award, fx, refreshHUD, touchDaily, level } from './rewards.js';

window.__three = THREE; // ensure bundling
const $ = (s) => document.querySelector(s);

/* ---------- BOOT ---------- */
const boot = $('#boot');
$('#bootBtn').onclick = () => {
  synth.ensure();
  synth.play('crash'); synth.play('kick');
  boot.style.transition = 'opacity .5s'; boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 500);
  if (touchDaily()) fx.toast(`🔥 Day ${store.data.streak} streak! +coins`);
  fx.toast('🥁 Tap the 3D drums to play!');
  award({ badge: 'first' });
};

/* ---------- TABS ---------- */
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  synth.ensure();
  document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('#screen-' + b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'play') setTimeout(() => kit.resize(), 50);
});

/* ---------- KIT + PADS ---------- */
const kit = new Kit3D($('#stage'), (name) => onDrumHit(name, 'kit'));
window.__kit = kit;
setTimeout(() => kit.resize(), 300);

const padsEl = $('#pads');
for (const p of PADS) {
  const d = document.createElement('div');
  d.className = 'pad'; d.dataset.pad = p.id;
  d.innerHTML = `<span class="key">${p.key}</span>${p.label}<small>tap</small>`;
  d.style.borderBottom = `3px solid ${p.color}`;
  const fire = (e) => { e.preventDefault(); kit.hit(p.id, 1); };
  d.addEventListener('pointerdown', fire);
  padsEl.appendChild(d);
}
function flashPad(id) {
  document.querySelectorAll(`[data-pad="${id}"]`).forEach(el => {
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  });
  const f = $('#hitFlash'); f.style.opacity = '1'; setTimeout(() => f.style.opacity = '0', 90);
}

// kit toggle acoustic/electric
$('#kitToggle').onclick = (e) => {
  const next = kit.mode === 'acoustic' ? 'electric' : 'acoustic';
  kit.setMode(next);
  e.target.textContent = next === 'acoustic' ? '🥁 Acoustic' : '⚡ Electric';
  fx.toast(next === 'electric' ? '⚡ Electric kit: neon + punchy!' : '🥁 Acoustic kit: warm wood!');
};

// keyboard
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const p = PADS.find(p => p.key.toLowerCase() === e.key.toLowerCase() || (p.id === 'kick' && e.key === ' '));
  if (p) { e.preventDefault(); kit.hit(p.id, 1); }
  if (e.key === ' ') e.preventDefault();
});

/* ---------- SCORING HOOK (every hit) ---------- */
let clickCh = null, minis = null;
function onDrumHit(name, src) {
  flashPad(name);
  award({ xp: 1, coins: 0 });
  fx.floater('+1', innerWidth / 2 + (Math.random() * 120 - 60), innerHeight * 0.4);
  song?.playing && song.strike(name);
  // metronome stability tracking
  metroTrackHit(name);
  // minis + challenges
  minis?.tap(name);
  // lesson try mode
  lessonTap(name);
  // click challenges: compute err vs last click for steady display
  clickCh?.tap(name);
}

/* ---------- TIMING FALL SONG MODE ---------- */
const songSel = $('#songSelect');
SONGS.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.title; songSel.appendChild(o); });
const hud = {
  show(title) { $('#songHUD').classList.remove('hidden'); $('#songTitle').textContent = title; this.score(0, 0, { perfect: 0, great: 0, miss: 0 }); },
  hide() { $('#songHUD').classList.add('hidden'); $('#comboPop').style.opacity = 0; },
  score(s, c, acc) { $('#songScore').textContent = s; $('#songCombo').textContent = 'combo x' + c; $('#songAcc').textContent = `PERFECT ${acc.perfect} • GREAT ${acc.great} • MISS ${acc.miss}`; },
  judge(kind, combo, ghost) {
    const el = $('#judgePop');
    const map = { perfect: ['PERFECT! ⚡', 'judge-perfect'], great: ['GREAT!', 'judge-great'], miss: ['MISS', 'judge-miss'] };
    const [txt, cls] = map[kind] || map.miss;
    el.className = cls; el.textContent = ghost ? '' : txt;
    clearTimeout(this._t); this._t = setTimeout(() => el.textContent = '', 450);
    const cp = $('#comboPop');
    if (combo >= 5) { cp.textContent = `x${combo} COMBO 🔥`; cp.style.opacity = 1; cp.style.transform = `scale(${1 + Math.min(0.6, combo / 60)})`; }
    else cp.style.opacity = 0;
    if (combo > 0 && combo % 25 === 0) fx.confetti(80);
  }
};
const song = new TimingFall($('#highway'), kit, hud);
song.onEnd = () => { $('#playSongBtn').textContent = '▶ Play track'; };
$('#playSongBtn').onclick = () => {
  const s = SONGS.find(s => s.id === songSel.value);
  song.load(s); song._done = false; song.start();
  $('#playSongBtn').textContent = '⏸ Restart';
  fx.toast('⚡ Hit the falling notes on the glowing line!');
};
$('#stopSongBtn').onclick = () => { song.stop(true); $('#playSongBtn').textContent = '▶ Play track'; };
(function raf() { requestAnimationFrame(raf); song.frame(); })();

/* ---------- LEARN ---------- */
$('#staffLegend').innerHTML = legendHTML();
let lessonIdx = 0, lessonState = null;
function drawPath() {
  const el = $('#lessonPath'); el.innerHTML = '';
  LESSONS.forEach((l, i) => {
    const d = document.createElement('div');
    d.className = 'lesson-node' + (store.data.lessonsDone.includes(l.id) ? ' done' : '') + (i === lessonIdx ? ' now' : '');
    d.textContent = (store.data.lessonsDone.includes(l.id) ? '✅ ' : '') + l.id;
    d.title = l.title;
    d.onclick = () => { lessonIdx = i; showLesson(); drawPath(); };
    el.appendChild(d);
  });
}
function showLesson() {
  const l = LESSONS[lessonIdx];
  $('#lessonTitle').textContent = l.title + ` · ${l.bpm} BPM`;
  $('#lessonText').textContent = l.text;
  renderStaff($('#staffBox'), l.seq, { big: true });
  $('#lessonFeedback').textContent = '';
  lessonState = null;
}
drawPath(); showLesson();
$('#demoLessonBtn').onclick = () => {
  const l = LESSONS[lessonIdx]; synth.ensure();
  const spb = 60 / l.bpm / 2;
  const t0 = synth.now() + 0.1;
  l.seq.forEach((id, i) => synth.play(id, t0 + i * spb, 0.95));
  l.seq.forEach((id, i) => setTimeout(() => renderStaff($('#staffBox'), l.seq, { highlight: i, big: true }), 150 + i * spb * 1000));
  setTimeout(() => renderStaff($('#staffBox'), l.seq, { big: true }), 150 + l.seq.length * spb * 1000);
};
$('#tryLessonBtn').onclick = () => {
  const l = LESSONS[lessonIdx];
  lessonState = { seq: [...l.seq], idx: 0, ok: 0 };
  // play demo first, then user repeats
  $('#demoLessonBtn').click();
  const spb = 60 / l.bpm / 2;
  setTimeout(() => {
    $('#lessonFeedback').innerHTML = `🥁 Your turn! Hit <b>${lessonState.seq[0].toUpperCase()}</b> on the kit (0/${lessonState.seq.length})`;
    renderStaff($('#staffBox'), l.seq, { highlight: 0, big: true });
  }, 300 + l.seq.length * spb * 1000);
};
function lessonTap(name) {
  if (!lessonState) return;
  const want = lessonState.seq[lessonState.idx];
  if (name === want || (want === 'hihat' && name === 'openhat')) {
    lessonState.idx++; lessonState.ok++;
    award({ xp: 3 });
    const l = LESSONS[lessonIdx];
    if (lessonState.idx >= lessonState.seq.length) {
      $('#lessonFeedback').innerHTML = `✅ Nailed it! You just read drum sheet music! +${20 + l.id * 5} XP`;
      award({ xp: 20 + l.id * 5, coins: 5 + l.id });
      if (!store.data.lessonsDone.includes(l.id)) store.data.lessonsDone.push(l.id);
      store.save(); drawPath(); renderRewards();
      if (l.id === 5) award({ badge: 'reader1' });
      if (store.data.lessonsDone.length >= 12) award({ badge: 'grad' });
      if (l.id < 12) { lessonIdx++; setTimeout(() => { showLesson(); drawPath(); }, 1600); }
      else fx.confetti(220);
      lessonState = null;
    } else {
      $('#lessonFeedback').innerHTML = `✅ Good! Next: <b>${lessonState.seq[lessonState.idx].toUpperCase()}</b> (${lessonState.idx}/${lessonState.seq.length})`;
      renderStaff($('#staffBox'), l.seq, { highlight: lessonState.idx, big: true });
    }
  } else if (lessonState.idx > 0 || true) {
    // gentle: only hint, don't reset harshly
    $('#lessonFeedback').innerHTML = `🤏 That was ${name.toUpperCase()} — want <b>${want.toUpperCase()}</b>. Watch the highlight!`;
  }
}
$('#quizLessonBtn').onclick = () => {
  const ids = Object.keys(DRUM_STAFF);
  const pick = ids[Math.random() * ids.length | 0];
  renderStaff($('#staffBox'), [pick], { big: true });
  const guess = prompt(`❓ Which drum is this note?\nOptions: ${ids.join(', ')}`);
  if (!guess) return;
  if (guess.trim().toLowerCase() === pick) { $('#lessonFeedback').textContent = `✅ Correct! ${pick} ${DRUM_STAFF[pick].label}`; award({ xp: 15, coins: 3 }); }
  else { $('#lessonFeedback').textContent = `❌ It was ${pick} (${DRUM_STAFF[pick].label}). Try again!`; }
};

/* ---------- GROOVE MINI-GAMES ---------- */
minis = new Minis(kit, {
  feed: (m) => $('#miniFeed').innerHTML = m,
  score: (s) => $('#miniScore').textContent = 'score ' + s,
  timer: (t) => $('#miniTimer').textContent = t,
  toast: (m) => fx.toast(m),
  flashPad: (id, hint) => { if (hint) flashPad(id); },
  clickLight: () => { },
});
let miniKind = null;
const MINI_INFO = {
  timing: ['⚡ Timing Fall', 'Falling notes synced to music. Go to Play tab → pick a track → ▶ Play.'],
  ear: ['👂 Ear Copy', 'Watch the kit flash, then repeat the pattern. Grows every round.'],
  fill: ['🌊 Fill Frenzy', '30 seconds. Hit whatever drum is called out, as fast as you can.'],
  limb: ['🦵 Limb Split', 'Alternate KICK ↔ SNARE for 30s. Independence training!'],
  burst: ['💥 Speed Burst', '10 seconds. Mash SNARE as fast as physically possible.'],
  offbeat: ['🌀 Offbeat Ninja', '16th click at 85 BPM. Snare ONLY on "e" and "a".'],
};
document.querySelectorAll('[data-game]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-game]').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel');
  miniKind = b.dataset.game;
  const [t, d] = MINI_INFO[miniKind];
  $('#miniTitle').textContent = t; $('#miniDesc').textContent = d;
  $('#miniScore').textContent = 'score 0'; $('#miniTimer').textContent = '--'; $('#miniFeed').textContent = '';
});
$('#miniStart').onclick = () => {
  if (!miniKind) return fx.toast('Pick a game card first 👆');
  if (miniKind === 'timing') { document.querySelector('[data-tab="play"]').click(); $('#playSongBtn').click(); return; }
  synth.ensure();
  $('#miniScore').textContent = 'score 0';
  minis.start(miniKind);
  fx.toast('GO! 🎮');
};
// tappable mini pads mirror main pads
for (const p of PADS.slice(3)) {
  const d = document.createElement('div');
  d.className = 'pad'; d.dataset.pad = p.id; d.innerHTML = `${p.label}`;
  d.style.borderBottom = `3px solid ${p.color}`;
  d.addEventListener('pointerdown', (e) => { e.preventDefault(); kit.hit(p.id, 1); });
  $('#miniPads').appendChild(d);
}

/* ---------- METRONOME LAB ---------- */
const metro = new Metronome((tk) => {
  const box = $('#metroLights');
  if (!box.children.length) return;
  [...box.children].forEach((el, i) => el.classList.toggle('on', i === (tk.beat - 1)));
  $('#metroBeat').textContent = `bar ${tk.bar} • beat ${tk.beat}`;
});
function drawMetroLights(n) {
  const box = $('#metroLights'); box.innerHTML = '';
  for (let i = 0; i < n; i++) { const d = document.createElement('div'); if (i === 0) d.classList.add('acc'); box.appendChild(d); }
}
drawMetroLights(4);
let metroOn = false, metroHits = [];
$('#metroToggle').onclick = (e) => {
  synth.ensure();
  if (!metroOn) {
    metro.bpm = +$('#bpmSlider').value; metro.beats = +$('#beatsSel').value; metro.sub = +$('#subSel').value;
    metro.start(); metroOn = true; metroHits = [];
    e.target.textContent = '⏸ Stop click';
  } else { metro.stop(); metroOn = false; e.target.textContent = '▶ Start click'; reportStability(); }
};
function reportStability() {
  if (metroHits.length < 4) { $('#metroStats').textContent = 'Play kick/snare along with the click to get a stability score.'; return; }
  const avg = metroHits.reduce((a, b) => a + b, 0) / metroHits.length;
  $('#metroStats').innerHTML = `Your avg timing error: <b>${Math.round(avg)}ms</b> over ${metroHits.length} hits. ${avg < 45 ? '⚡ Studio tight!' : avg < 100 ? '🔥 Solid!' : '💪 Keep locking in!'}`;
}
function metroTrackHit(name) {
  if (!metroOn || !['kick', 'snare', 'hihat'].includes(name)) return;
  // error vs nearest scheduled tick
  const t = synth.now();
  const d = Math.abs(((t - metro.nextT) % metro.stepDur + metro.stepDur) % metro.stepDur);
  const err = Math.min(d, metro.stepDur - d) * 1000;
  if (err < 300) { metroHits.push(err); award({ xp: 2, timingMs: Math.round(err) }); }
}
$('#bpmSlider').oninput = (e) => {
  $('#bpmNum').textContent = e.target.value;
  if (metroOn) { metro.stop(); metro.bpm = +e.target.value; metro.start(); }
};
$('#bpmDown').onclick = () => { $('#bpmSlider').value = Math.max(40, +$('#bpmSlider').value - 5); $('#bpmSlider').oninput({ target: $('#bpmSlider') }); };
$('#bpmUp').onclick = () => { $('#bpmSlider').value = Math.min(220, +$('#bpmSlider').value + 5); $('#bpmSlider').oninput({ target: $('#bpmSlider') }); };
$('#beatsSel').onchange = (e) => { drawMetroLights(+e.target.value); if (metroOn) { metro.beats = +e.target.value; } };
$('#subSel').onchange = (e) => { if (metroOn) metro.sub = +e.target.value; };
$('#tapTempo').onclick = () => {
  const b = metro.tap();
  if (b) { $('#bpmSlider').value = Math.min(220, Math.max(40, b)); $('#bpmNum').textContent = $('#bpmSlider').value; fx.toast(`👆 ~${b} BPM`); }
  else fx.toast('👆 Keep tapping...');
};
// click light bridge for challenges
window.__clickLight = () => { const box = $('#metroLights'); [...box.children].forEach((el, i) => { el.classList.toggle('on', Math.random() > 0.5); setTimeout(() => el.classList.remove('on'), 150); }); };

/* challenges */
clickCh = new ClickChallenges(kit, (m) => $('#clickFeed').innerHTML = m);
let clickKind = 'steady';
document.querySelectorAll('[data-click]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-click]').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel'); clickKind = b.dataset.click;
  $('#clickFeed').textContent = b.querySelector('span').textContent + ' — press START CHALLENGE, play on the 3D kit (Play tab works too).';
});
$('#clickStart').onclick = () => { synth.ensure(); clickCh.start(clickKind); };

/* ---------- REWARDS PAGE ---------- */
function renderRewards() {
  refreshHUD();
  const d = store.data;
  const today = new Date().toISOString().slice(0, 10);
  $('#dailyBox').innerHTML = d.lastDay === today
    ? `✅ Daily check-in done! Streak: <b>🔥 ${d.streak} day(s)</b>. Come back tomorrow!`
    : `🎁 Daily reward available! <button class="btn primary" id="claimBtn">Claim +${10 + (d.streak + 1) * 5} coins</button>`;
  $('#claimBtn')?.addEventListener('click', () => { touchDaily(); renderRewards(); fx.confetti(120); });
  const bg = $('#badgeGrid'); bg.innerHTML = '';
  for (const b of BADGES) {
    const has = d.badges.includes(b.id);
    const el = document.createElement('div');
    el.className = 'badge' + (has ? '' : ' locked');
    el.innerHTML = `<b>${b.icon}</b>${b.name}<br><span class="muted">${b.desc}</span>`;
    bg.appendChild(el);
  }
  const sg = $('#shopGrid'); sg.innerHTML = '';
  for (const s of SHOP) {
    const owned = d.owned.includes(s.id);
    const el = document.createElement('div');
    el.className = 'shop' + (owned ? ' owned' : '');
    el.innerHTML = `<b>${s.icon} ${s.name}</b> — ${s.desc}<br><span class="muted">🪙 ${s.cost}</span> ${owned ? '✅' : `<br><button class="btn" data-buy="${s.id}">Buy</button>`}`;
    sg.appendChild(el);
  }
  sg.querySelectorAll('[data-buy]').forEach(btn => btn.onclick = () => {
    const item = SHOP.find(s => s.id === btn.dataset.buy);
    if (store.data.coins < item.cost) return fx.toast('Not enough coins — go play! 🥁');
    store.data.coins -= item.cost; store.data.owned.push(item.id); store.save();
    applyOwned(); renderRewards(); fx.toast(`${item.icon} ${item.name} unlocked!`); fx.confetti(140);
  });
}
function applyOwned() {
  if (store.data.owned.includes('goldkit') && kit.ring) kit.ring.material.color.set(0xfbbf24);
}
$('#resetBtn').onclick = () => { if (confirm('Reset all progress?')) { localStorage.clear(); location.reload(); } };
document.querySelector('[data-tab="rewards"]').addEventListener('click', renderRewards);
renderRewards(); refreshHUD(); applyOwned();

/* PWA + misc */
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
addEventListener('resize', () => kit.resize());
document.addEventListener('gesturestart', (e) => e.preventDefault());
