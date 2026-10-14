import { useEffect, useRef } from 'react';
import { useStudio } from '../store/useStore';
import { DRUMS } from '../lib/drums';

/** Real-time scrolling standard drum notation strip along the bottom. */
export default function NotationStrip() {
  const ref = useRef<HTMLCanvasElement>(null);
  const hits = useStudio((s) => s.hits);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      const w = (cv.width = cv.clientWidth * 2);
      const h = (cv.height = 148 * 2);
      ctx.scale(1, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, w, h);
      // staff lines (5)
      ctx.strokeStyle = 'rgba(200,180,255,0.5)';
      ctx.lineWidth = 2;
      const top = h * 0.22, gap = h * 0.12;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(0, top + i * gap); ctx.lineTo(w, top + i * gap); ctx.stroke();
      }
      // playhead
      const px = w * 0.72;
      ctx.strokeStyle = '#22e6ff'; ctx.lineWidth = 3;
      ctx.shadowBlur = 18; ctx.shadowColor = '#22e6ff';
      ctx.beginPath(); ctx.moveTo(px, 10); ctx.lineTo(px, h - 10); ctx.stroke();
      ctx.shadowBlur = 0;
      // notes scroll right→left by wall time
      const now = performance.now();
      const windowMs = 6000;
      for (const hit of hits) {
        const age = now - hit.wallTime;
        if (age < -500 || age > windowMs) continue;
        const x = px + ((windowMs - age) / windowMs - 0.72) * w * 0.9 - w * 0.0 + (age < 0 ? 0 : 0);
        // simpler: map age 0..window → px..px-windowSpan
        const span = w * 0.66;
        const nx = px - (age / windowMs) * span;
        if (nx < -20 || nx > w + 20) continue;
        const def = DRUMS.find((d) => d.id === hit.drumId);
        if (!def) continue;
        const y = top + def.notationLine * gap;
        ctx.shadowBlur = 20; ctx.shadowColor = def.color;
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.ellipse(nx, y, 14, 10, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = def.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(nx + 12, y); ctx.lineTo(nx + 12, y - 60); ctx.stroke();
        // velocity bar
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(nx - 10, h - 26, 20 * hit.velocity, 8);
      }
      // label
      ctx.fillStyle = 'rgba(200,180,255,0.9)';
      ctx.font = '22px system-ui';
      ctx.fillText('LIVE NOTATION — scrolling standard drum staff', 20, 34);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [hits]);

  return (
    <div className="notation-wrap">
      <canvas ref={ref} className="notation-canvas" />
    </div>
  );
}
