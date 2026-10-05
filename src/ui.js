// 2D dopamine FX: confetti particles, floating text, toasts, judge popups, haptics.
const fx = document.getElementById('fx');
const fctx = fx.getContext('2d');
let parts = [];
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
  if (!parts.length) { fctx.clearRect(0, 0, innerWidth, innerHeight); return; }
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
})();

const judgeLayer = document.getElementById('judgeLayer');
export function judge(text, cls, sub = '') {
  const d = document.createElement('div');
  d.className = 'judge ' + cls;
  d.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  judgeLayer.appendChild(d);
  setTimeout(() => d.remove(), 650);
  while (judgeLayer.children.length > 3) judgeLayer.firstChild.remove();
}

const toastLayer = document.getElementById('toastLayer');
export function toast(msg, ms = 2200) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  toastLayer.appendChild(d);
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 300); }, ms);
}

export function floatXP(n, x = innerWidth / 2, y = innerHeight * 0.4) {
  const d = document.createElement('div');
  d.className = 'judge great';
  d.style.position = 'fixed'; d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.zIndex = 70;
  d.textContent = `+${n} XP`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 650);
}
