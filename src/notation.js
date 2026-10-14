// SVG drum-sheet renderer: 5-line staff, per-drum vertical slots, X vs oval heads.
import { DRUM_STAFF } from './data.js';

export function renderStaff(el, seq, opts = {}) {
  const { highlight = -1, big = false } = opts;
  const W = Math.max(320, seq.length * (big ? 64 : 52) + 70), H = 230;
  const top = 40, gap = 18;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;min-width:${W}px">`;
  // staff lines
  for (let i = 0; i < 5; i++) {
    const y = top + i * gap;
    s += `<line x1="14" y1="${y}" x2="${W - 10}" y2="${y}" stroke="#5b4b9e" stroke-width="2"/>`;
  }
  s += `<text x="18" y="${top + 44}" font-size="30" fill="#b7aee0">𝄢</text>`;
  seq.forEach((id, i) => {
    const st = DRUM_STAFF[id] || DRUM_STAFF.snare;
    const x = 62 + i * (big ? 64 : 52);
    const y = top + st.y * (gap / 2);
    const hot = i === highlight;
    if (i % 2 === 0) s += `<line x1="${x - 22}" y1="${top}" x2="${x - 22}" y2="${top + 4 * gap}" stroke="#ffffff14"/>`;
    if (hot) s += `<rect x="${x - 20}" y="6" width="40" height="${H - 12}" rx="10" fill="#22d3ee22" stroke="#22d3ee"/>`;
    // stem
    s += `<line x1="${x + 9}" y1="${y}" x2="${x + 9}" y2="${y - 44}" stroke="${hot ? '#22d3ee' : '#cfc8ff'}" stroke-width="2.5"/>`;
    if (st.x) {
      s += `<g transform="translate(${x},${y}) rotate(45)" stroke="${hot ? '#fbbf24' : '#f4f1ff'}" stroke-width="3.4" stroke-linecap="round"><line x1="-8" y1="0" x2="8" y2="0"/><line x1="0" y1="-8" x2="0" y2="8"/></g>`;
    } else {
      s += `<ellipse cx="${x}" cy="${y}" rx="10" ry="7.5" transform="rotate(-18 ${x} ${y})" fill="${hot ? '#fbbf24' : '#f4f1ff'}"/>`;
    }
    s += `<text x="${x - 9}" y="${H - 12}" font-size="11" fill="#b7aee0">${short(id)}</text>`;
  });
  s += `</svg>`;
  el.innerHTML = s;
  if (highlight >= 0) {
    const target = 62 + highlight * (big ? 64 : 52);
    el.scrollLeft = Math.max(0, target - el.clientWidth / 2);
  }
}
function short(id) { return { kick: 'KICK', snare: 'SNR', hihat: 'HAT', openhat: 'O-HAT', tom1: 'T1', tom2: 'T2', tom3: 'FLR', crash: 'CRS', ride: 'RDE' }[id] || id; }

export function legendHTML() {
  return Object.entries(DRUM_STAFF).map(([id, st]) =>
    `<span>${st.x ? '✕' : '●'} ${id} — ${st.label}</span>`).join('');
}
