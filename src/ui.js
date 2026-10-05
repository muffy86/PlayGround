// 2D dopamine FX: confetti particles, floating text, toasts, judge popups, haptics.
import { FloatTextPool } from './engine/index.ts';
const fx = document.getElementById('fx');
const fctx = fx.getContext('2d');
let parts = [];
// Phase 3: spring-physics floating rating/combo text (preallocated pool).
const floatPool = new FloatTextPool(12);
const RATING_COLORS = { perfect: '#38f0ff', great: '#7CFF6B', good: '#ffd166', miss: '#ff5d5d' };
let lastFxT = typeof performance !== 'undefined' ? performance.now() : 0;
function sizeFx() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  fx.width = innerWidth * dpr; fx.height = innerHeight * dpr;
  fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', sizeFx); sizeFx();

export function buzz(ms = 20) { try { navigator.vibrate?.(ms); } catch {} }
export function tapFlash() {
  const el = document.getElementById('tapFlash');
  el.style.opacity = 1; setTimeout(() => el.style.opacity = 0, 90);
}
export function confetti(n = 80, x = innerWidth / 2, y = innerHeight * 0.3) {
  const colors = ['#ff4ecd', '#7b5cff', '#38f0ff', '#ffd166', '#7CFF6B', '#fff'];
  for (let i = 0; i < n; i++) {
    parts.push({
      x, y, vx: (Math.random() - 0.5) * 9, vy: Math.random() * -8 - 2,
      s: Math.random() * 7 + 3, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: colors[i % colors.length], life: 1
    });
  }
}
export function ringBurst(x, y, color = '#38f0ff') {
  for (let i = 0; i < 10; i++) {
    parts.push({ x, y, vx: Math.cos(i / 10 * 6.28) * 3, vy: Math.sin(i / 10 * 6.28) * 3, s: 3, r: 0, vr: 0, c: color, life: 0.7, dot: true });
  }
}
(function loop() {
  requestAnimationFrame(loop);
  const nowT = typeof performance !== 'undefined' ? performance.now() : 0;
  const dt = Math.min(0.05, Math.max(0, (nowT - lastFxT) / 1000));
  lastFxT = nowT;
  try { floatPool.update(dt); } catch { /* ignore */ }
  if (!parts.length && !floatPool.alive) { fctx.clearRect(0, 0, innerWidth, innerHeight); return; }
  fctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.life > 0);
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.r += p.vr; p.life -= 0.012;
    fctx.save(); fctx.globalAlpha = Math.max(0, p.life);
    fctx.translate(p.x, p.y); fctx.rotate(p.r); fctx.fillStyle = p.c;
    if (p.dot) { fctx.beginPath(); fctx.arc(0, 0, p.s, 0, 7); fctx.fill(); }
    else fctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
    fctx.restore();
  }
  try {
    const W = innerWidth, H = innerHeight;
    fctx.save();
    fctx.textAlign = 'center';
    for (const s of floatPool.all) {
      if (!s.alive) continue;
      const baseY = s.kind === 'xp' ? H * 0.42 : s.kind === 'combo' ? H * 0.31 : H * 0.24;
      const y = baseY + s.rise.value;
      const size = Math.round((s.kind === 'combo' ? 30 : 26) * s.pop.value);
      fctx.globalAlpha = Math.max(0, Math.min(1, s.alpha));
      fctx.font = `900 ${size}px system-ui, sans-serif`;
      fctx.shadowColor = s.color;
      fctx.shadowBlur = 16;
      fctx.fillStyle = s.color;
      fctx.fillText(s.text, s.x * W, y);
      if (s.sub) {
        fctx.font = '700 12px system-ui, sans-serif';
        fctx.shadowBlur = 8;
        fctx.fillStyle = '#fff';
        fctx.fillText(s.sub, s.x * W, y + 20);
      }
    }
    fctx.restore();
  } catch { /* ignore */ }
})();
export function judge(text, cls, sub = '') {
  try {
    floatPool.spawn({ text, sub, kind: 'rating', color: RATING_COLORS[cls] || '#fff', x: 0.5 });
  } catch { /* ignore */ }
}

const toastLayer = document.getElementById('toastLayer');
export function toast(msg, ms = 2200) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  toastLayer.appendChild(d);
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 300); }, ms);
}

export function floatXP(n, x = innerWidth / 2, y = innerHeight * 0.4) {
  try {
    floatPool.spawn({ text: `+${n} XP`, kind: 'xp', color: '#7CFF6B', x: Math.max(0, Math.min(1, x / innerWidth)) });
  } catch { /* ignore */ }
  void y;
}
