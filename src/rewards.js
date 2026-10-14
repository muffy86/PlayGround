// XP / coins / streak / badges / unlocks — localStorage persisted.
import { BADGES } from './data.js';

const KEY = 'groovelab3d_v1';
const def = () => ({ xp: 0, coins: 0, bestCombo: 0, streak: 0, lastDay: '', lessonsDone: [], badges: [], owned: [], timings: [] });

export const store = {
  data: load(),
  save() { localStorage.setItem(KEY, JSON.stringify(this.data)); },
};
function load() {
  try { return { ...def(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return def(); }
}
export function level() { return Math.floor(Math.sqrt(store.data.xp / 100)) + 1; }
export function xpForLevel(l) { return (l - 1) * (l - 1) * 100; }

export const fx = {
  toast(msg, ms = 2200) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, ms);
  },
  floater(txt, x = innerWidth / 2, y = innerHeight / 2) {
    const f = document.createElement('div'); f.className = 'floater'; f.textContent = txt;
    f.style.left = (x + (Math.random() * 60 - 30)) + 'px'; f.style.top = y + 'px';
    document.getElementById('floaters').appendChild(f);
    setTimeout(() => f.remove(), 1000);
  },
  confetti(n = 120) {
    const c = document.getElementById('confetti');
    c.width = innerWidth; c.height = innerHeight;
    const g = c.getContext('2d');
    const cols = ['#a855f7', '#22d3ee', '#fbbf24', '#34d399', '#fb7185'];
    const ps = Array.from({ length: n }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * 100, vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4, s: 4 + Math.random() * 6, col: cols[Math.random() * cols.length | 0], r: Math.random() * 6 }));
    let frames = 0;
    (function tick() {
      g.clearRect(0, 0, c.width, c.height);
      for (const p of ps) { p.x += p.vx; p.y += p.vy; p.r += 0.1; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.col; g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); g.restore(); }
      if (++frames < 140) requestAnimationFrame(tick); else g.clearRect(0, 0, c.width, c.height);
    })();
  }
};

export function award({ xp = 0, coins = 0, combo = 0, timingMs = null, badge = null } = {}) {
  const d = store.data;
  const before = level();
  d.xp += xp; d.coins += coins;
  if (combo > d.bestCombo) d.bestCombo = combo;
  if (timingMs != null) { d.timings.push(timingMs); d.timings = d.timings.slice(-60); }
  if (badge && !d.badges.includes(badge)) {
    d.badges.push(badge);
    const b = BADGES.find(b => b.id === badge);
    fx.toast(`${b?.icon || '🏅'} Badge unlocked: ${b?.name || badge}!`);
    fx.confetti(160);
  }
  if (d.coins >= 500 && !d.badges.includes('rich')) { d.badges.push('rich'); fx.toast('💰 Badge: Groove Tycoon!'); }
  store.save(); refreshHUD();
  const after = level();
  if (after > before) { fx.toast(`🚀 LEVEL UP! You are now Lv ${after}`); fx.confetti(200); navigator.vibrate?.([40, 40, 60]); }
  return d;
}

export function touchDaily() {
  const d = store.data;
  const today = new Date().toISOString().slice(0, 10);
  if (d.lastDay === today) return false;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  d.streak = d.lastDay === y ? d.streak + 1 : 1;
  d.lastDay = today;
  d.coins += 10 + d.streak * 5; d.xp += 25;
  store.save(); refreshHUD();
  return true;
}

export function refreshHUD() {
  const d = store.data, l = level();
  document.getElementById('lvlNum').textContent = 'Lv ' + l;
  document.getElementById('xpTxt').textContent = `${d.xp} XP`;
  const cur = xpForLevel(l), nxt = xpForLevel(l + 1);
  document.getElementById('xpFill').style.width = (((d.xp - cur) / Math.max(1, nxt - cur)) * 100).toFixed(1) + '%';
  document.getElementById('coinNum').textContent = d.coins;
  document.getElementById('streakNum').textContent = d.streak;
  document.getElementById('stXP') && (document.getElementById('stXP').textContent = d.xp);
  document.getElementById('stCoins') && (document.getElementById('stCoins').textContent = d.coins);
  document.getElementById('stBest') && (document.getElementById('stBest').textContent = 'x' + d.bestCombo);
  document.getElementById('stAcc') && (document.getElementById('stAcc').textContent = d.timings.length ? Math.round(d.timings.reduce((a, b) => a + b, 0) / d.timings.length) + 'ms' : '—');
}
