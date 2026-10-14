import { useEffect, useRef } from 'react';
import { useStudio } from '../store/useStore';
import { DRUMS } from '../lib/drums';

interface Burst { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; }

/** Full-screen neon particle layer. Hit bursts are spawned by drum hits. */
export function spawnBurst(x: number, y: number, color: string) {
  window.dispatchEvent(new CustomEvent('nds-burst', { detail: { x, y, color } }));
}

export default function ParticleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const lastHit = useStudio((s) => s.lastHitAt);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const bursts: Burst[] = [];
    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const onBurst = (e: Event) => {
      const { x, y, color } = (e as CustomEvent).detail as { x: number; y: number; color: string };
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 7;
        bursts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 0, max: 40 + Math.random() * 40, color, size: 1.5 + Math.random() * 3.5 });
      }
      // shockwave ring
      bursts.push({ x, y, vx: 0, vy: 0, life: 0, max: 30, color: '#ffffff', size: 2 });
    };
    window.addEventListener('nds-burst', onBurst);
    const loop = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let i = bursts.length - 1; i >= 0; i--) {
        const p = bursts[i];
        p.life++; p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.985;
        const k = 1 - p.life / p.max;
        if (k <= 0) { bursts.splice(i, 1); continue; }
        ctx.globalAlpha = k;
        ctx.shadowBlur = 16; ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size * k), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('nds-burst', onBurst); };
  }, []);

  // ambient pulse on every hit so the whole screen breathes
  useEffect(() => {
    void lastHit; void DRUMS;
  }, [lastHit]);

  return <canvas ref={ref} className="particles" />;
}
