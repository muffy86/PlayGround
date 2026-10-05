// Drum lessons: 16-step 1-bar patterns. drums: kick/snare/hihat/...
export const LESSONS = [
  {
    id: 'beat1', name: '🥁 Level 1 · Backbeat (K S H)', bpm: 80,
    teach: 'KICK on 1 & 3 · SNARE on 2 & 4 · HAT every 8th',
    steps: {
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    }
  },
  {
    id: 'beat2', name: '🥁 Level 2 · Four on Floor', bpm: 95,
    teach: 'KICK every quarter · SNARE 2 & 4 · HAT 8ths',
    steps: {
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
    }
  },
  {
    id: 'beat3', name: '🥁 Level 3 · Toms Enter', bpm: 100,
    teach: 'adds TOM 1 + FLOOR · watch the staff lines',
    steps: {
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,0,0],
      tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      floor: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
    }
  },
  {
    id: 'beat4', name: '🌊 Level 4 · Crash Course', bpm: 105,
    teach: 'CRASH on 1 · RIDE groove · OPEN HAT sizzle',
    steps: {
      crash: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      kick:  [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
      ride:  [0,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      hihatOpen: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
    }
  },
  {
    id: 'beat5', name: '🔥 Level 5 · 16th Funk', bpm: 92,
    teach: '16th HATS · ghost SNARE · syncopated KICK',
    steps: {
      kick:  [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
      snare: [0,0,0,0, 1,0,0,1, 0,0,1,0, 0,0,0,0],
      hihat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,0],
      tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,1],
    }
  },
  {
    id: 'beat6', name: '🌪 Level 6 · Fill Bar', bpm: 110,
    teach: 'groove + 1-beat fill: S T1 T2 F round the kit',
    steps: {
      crash: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 0,0,0,0],
      tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0],
      tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      floor: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
    }
  },
];

// staff line Y for each drum (0 = top line). 5 lines spaced 14px.
const POS = {
  crash: -1.6, ride: -0.9, hihat: -0.35, hihatOpen: -0.35,
  tom1: 0.6, tom2: 1.6, snare: 2.5, floor: 3.4, kick: 4.5,
};
const COLORS = {
  kick: '#ff8a3d', snare: '#ff4ecd', hihat: '#38f0ff', hihatOpen: '#38f0ff',
  tom1: '#7b5cff', tom2: '#9b8cff', floor: '#b06cff', crash: '#ffd166', ride: '#7CFF6B'
};
const CYM = new Set(['hihat', 'hihatOpen', 'crash', 'ride']);

export function lessonById(id) { return LESSONS.find(l => l.id === id) || LESSONS[0]; }

export function drawStaff(canvas, lesson, cursorStep, opts = {}) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || 700, H = canvas.clientHeight || 86;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const mode = opts.mode || 'read';
  if (mode === 'rush') { drawRush(g, W, H, opts); return; }
  if (mode === 'metro') { drawMetroIdle(g, W, H, opts); return; }

  const top = H / 2 - 28, gap = 14, left = 44, right = W - 14;
  const slotW = (right - left) / 16;
  // bg beats
  for (let b = 0; b < 4; b++) {
    g.fillStyle = b % 2 ? 'rgba(123,92,255,.10)' : 'rgba(56,240,255,.08)';
    g.fillRect(left + b * slotW * 4, top - 26, slotW * 4, gap * 4 + 52);
  }
  // staff lines
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    g.beginPath(); g.moveTo(left - 30, top + i * gap); g.lineTo(right, top + i * gap); g.stroke();
  }
  // clef-ish drum label
  g.fillStyle = '#ffd166'; g.font = '900 15px system-ui'; g.fillText('🥁', 8, top + gap * 2 + 5);
  g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '700 9px system-ui';
  ['1', '2', '3', '4'].forEach((n, i) => g.fillText(n, left + i * slotW * 4 + 2, top - 12));
  // bar line
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(right, top - 6); g.lineTo(right, top + gap * 4 + 6); g.stroke();

  const yOf = (drum) => top + POS[drum] * gap;
  const hit = opts.hitFlash || null; // {drum, step}
  for (const [drum, arr] of Object.entries(lesson.steps)) {
    arr.forEach((v, s) => {
      if (!v) return;
      const x = left + s * slotW + slotW / 2;
      const y = yOf(drum);
      const isCursor = Math.floor(cursorStep) === s && opts.playing;
      const isHit = hit && hit.drum === drum && hit.step === s;
      g.save();
      g.shadowColor = COLORS[drum]; g.shadowBlur = isCursor || isHit ? 12 : 4;
      g.fillStyle = isHit ? '#fff' : COLORS[drum];
      g.strokeStyle = isHit ? '#fff' : COLORS[drum];
      g.lineWidth = 2;
      if (CYM.has(drum)) {
        // X head
        const r = 6;
        g.beginPath();
        g.moveTo(x - r, y - r); g.lineTo(x + r, y + r);
        g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
        g.stroke();
        if (drum === 'hihatOpen') { g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); }
      } else {
        g.beginPath(); g.ellipse(x, y, 7, 5, -0.25, 0, 7);
        g.fill();
        // stem
        g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x + 7, y); g.lineTo(x + 7, y - 26); g.stroke();
      }
      g.restore();
    });
  }
  // cursor
  if (opts.playing) {
    const cx = left + Math.min(Math.max(cursorStep, 0), 16) * slotW;
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.shadowColor = '#38f0ff'; g.shadowBlur = 10;
    g.beginPath(); g.moveTo(cx, top - 26); g.lineTo(cx, top + gap * 4 + 26); g.stroke();
    g.shadowBlur = 0;
  }
  // teach line
  if (opts.teach) {
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 10px system-ui';
    g.fillText(lesson.teach.slice(0, 90), left, H - 4);
  }
}

// ---- RUSH highway ----
function drawRush(g, W, H, opts) {
  const lanes = opts.lanes || ['hihat', 'snare', 'kick', 'tom1'];
  const notes = opts.rushNotes || []; // {beat, drum, judged}
  const beatNow = opts.beatNow || 0;
  const laneH = H / lanes.length;
  g.font = '700 9px system-ui';
  lanes.forEach((drum, i) => {
    const y = i * laneH;
    g.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.09)';
    g.fillRect(0, y, W, laneH - 1);
    g.fillStyle = COLORS[drum] + 'cc';
    g.fillText(drum.toUpperCase(), 6, y + 12);
    // hit line
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(86, y, 3, laneH - 1);
    g.fillStyle = COLORS[drum];
    g.beginPath(); g.arc(87, y + laneH / 2, 9, 0, 7); g.fill();
  });
  const pxPerBeat = (W - 110) / 4; // 4 beats visible
  for (const n of notes) {
    const dBeat = n.beat - beatNow;
    if (dBeat < -0.5 || dBeat > 4.2) continue;
    const x = 89 + dBeat * pxPerBeat;
    const li = lanes.indexOf(n.drum);
    if (li < 0) continue;
    const y = li * laneH + laneH / 2;
    if (n.judged) continue;
    g.save();
    g.shadowColor = COLORS[n.drum]; g.shadowBlur = 10;
    g.fillStyle = COLORS[n.drum];
    g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill();
    g.fillStyle = '#0b0721'; g.font = '900 9px system-ui'; g.textAlign = 'center';
    g.fillText(n.drum[0].toUpperCase(), x, y + 3);
    g.restore();
  }
}

function drawMetroIdle(g, W, H, opts) {
  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fillRect(0, 0, W, H);
  const beats = opts.metroBeats || [];
  const cx = W / 2, cy = H / 2;
  beats.forEach((b, i) => {
    const a = b.t; // 0..1 age
    g.save();
    g.globalAlpha = Math.max(0, 1 - a);
    g.strokeStyle = b.accent ? '#ffd166' : '#38f0ff';
    g.lineWidth = 3; g.shadowColor = g.strokeStyle; g.shadowBlur = 14;
    g.beginPath(); g.arc(cx, cy, 12 + a * 90, 0, 7); g.stroke();
    g.restore();
  });
  g.fillStyle = '#fff'; g.font = '900 13px system-ui'; g.textAlign = 'center';
  g.fillText(opts.metroMsg || 'METRONOME DOJO — press START CLICK', cx, cy + 4);
}

export function patternToRush(lesson, lanes) {
  const out = [];
  for (const [drum, arr] of Object.entries(lesson.steps)) {
    if (!lanes.includes(drum)) continue;
    arr.forEach((v, s) => { if (v) out.push({ beat: s / 4, drum, judged: false }); });
  }
  // loop 4x with slight variation? keep 2 loops for a round
  const looped = [];
  for (let loop = 0; loop < 4; loop++) {
    for (const n of out) looped.push({ beat: n.beat + loop * 4, drum: n.drum, judged: false });
  }
  return looped.sort((a, b) => a.beat - b.beat);
}
