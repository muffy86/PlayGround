import * as THREE from 'three';
import { synth } from './audio.js';

// Procedural 3D drum kit. No external models — acoustic wood vs electric neon.
export class Kit3D {
  constructor(canvas, onHit) {
    this.canvas = canvas; this.onHit = onHit;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0b0620, 0.028);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camAng = 0; this.camR = 11; this.camY = 5.2; this.autoOrbit = true;
    this.mode = 'acoustic';
    this.drums = {}; this.particles = [];
    this.trailOn = false;
    this.buildLights(); this.buildStage(); this.buildKit();
    this.bindInput(); this.resize(); this.loop();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = this.canvas.parentElement;
    const r = w.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
  }
  buildLights() {
    this.scene.add(new THREE.AmbientLight(0x8877ff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(5, 9, 6); this.scene.add(key);
    this.purple = new THREE.PointLight(0xa855f7, 60, 40); this.purple.position.set(-6, 6, -3); this.scene.add(this.purple);
    this.cyan = new THREE.PointLight(0x22d3ee, 60, 40); this.cyan.position.set(6, 5, -2); this.scene.add(this.cyan);
    this.spot = new THREE.SpotLight(0xffffff, 120, 30, 0.6, 0.5); this.spot.position.set(0, 12, 2);
    this.spot.target.position.set(0, 0, 0); this.scene.add(this.spot, this.spot.target);
  }
  buildStage() {
    const g = new THREE.CylinderGeometry(8.4, 8.8, 0.3, 48);
    const m = new THREE.MeshStandardMaterial({ color: 0x151032, roughness: 0.35, metalness: 0.6 });
    const disc = new THREE.Mesh(g, m); disc.position.y = -0.55; this.scene.add(disc);
    const ringG = new THREE.TorusGeometry(8.2, 0.06, 12, 90);
    this.ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
    this.ring.rotation.x = Math.PI / 2; this.ring.position.y = -0.38; this.scene.add(this.ring);
    const grid = new THREE.GridHelper(40, 40, 0x3b2a7a, 0x1c1440);
    grid.position.y = -0.72; this.scene.add(grid);
  }
  matShell(color) {
    if (this.mode === 'electric')
      return new THREE.MeshStandardMaterial({ color: 0x0d0d18, roughness: 0.25, metalness: 0.9, emissive: new THREE.Color(color), emissiveIntensity: 0.35 });
    return new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 });
  }
  drum(name, x, y, z, r, depth, color, opts = {}) {
    const grp = new THREE.Group(); grp.position.set(x, y, z);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, 28), this.matShell(color));
    const headMat = new THREE.MeshStandardMaterial({ color: this.mode === 'electric' ? 0x111122 : 0xf5f0e6, roughness: 0.7, emissive: new THREE.Color(color), emissiveIntensity: 0 });
    const head = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.06, 28), headMat);
    head.position.y = depth / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 10, 32), new THREE.MeshStandardMaterial({ color: 0xccccdd, metalness: 0.95, roughness: 0.2 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = depth / 2 + 0.02;
    grp.add(shell, head, rim);
    if (opts.tilt) grp.rotation.x = opts.tilt;
    if (opts.ry) grp.rotation.y = opts.ry;
    // stand
    if (opts.stand !== false) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, y + 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.9, roughness: 0.3 }));
      leg.position.y = -(y / 2) - 0.15; grp.add(leg);
    }
    grp.userData = { name, headMat, baseY: y, squash: 0, color };
    this.scene.add(grp); this.drums[name] = grp;
    return grp;
  }
  cymbal(name, x, y, z, r, color) {
    const grp = new THREE.Group(); grp.position.set(x, y, z);
    const mat = new THREE.MeshStandardMaterial({ color: this.mode === 'electric' ? 0x222233 : 0xd9a441, metalness: 0.9, roughness: 0.3, emissive: new THREE.Color(color), emissiveIntensity: this.mode === 'electric' ? 0.4 : 0 });
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r, 0.12, 28), mat);
    c.rotation.z = 0.09; grp.add(c);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 12, 8), mat); bell.position.y = 0.1; grp.add(bell);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, y + 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x9999aa, metalness: 0.9, roughness: 0.3 }));
    pole.position.y = -(y / 2); grp.add(pole);
    grp.userData = { name, headMat: mat, baseY: y, squash: 0, color, cymbal: true };
    this.scene.add(grp); this.drums[name] = grp;
    return grp;
  }
  buildKit() {
    for (const k of Object.values(this.drums)) this.scene.remove(k);
    this.drums = {};
    if (this.mode === 'acoustic') {
      this.drum('kick', 0, 1.05, 0.6, 1.15, 1.1, 0x7c2d12, { tilt: Math.PI / 2.4, stand: false });
      this.drum('snare', -1.7, 1.55, 1.5, 0.72, 0.5, 0xb91c1c, {});
      this.drum('tom1', -0.85, 2.15, 0.1, 0.6, 0.6, 0x9a3412, { tilt: 0.5 });
      this.drum('tom2', 0.85, 2.15, 0.1, 0.65, 0.65, 0x9a3412, { tilt: 0.5 });
      this.drum('tom3', 2.6, 1.3, 0.9, 0.8, 1.0, 0x7c2d12, {});
      this.cymbal('hihat', -3.1, 2.2, 1.1, 0.75, 0x22d3ee);
      this.cymbal('crash', -2.3, 3.0, -0.9, 0.95, 0xfbbf24);
      this.cymbal('ride', 2.3, 2.9, -0.9, 1.05, 0xf59e0b);
      this.cymbal('openhat', -3.1, 2.75, 1.1, 0.75, 0x67e8f9);
      this.drums['openhat'].visible = false; // shares hat stand visually
    } else {
      // electric: hexagonal compact neon pads
      this.drum('kick', 0, 0.9, 0.6, 1.0, 0.5, 0x34d399, { tilt: Math.PI / 2.4, stand: false });
      this.drum('snare', -1.7, 1.55, 1.5, 0.66, 0.3, 0xa855f7, {});
      this.drum('tom1', -0.85, 2.15, 0.1, 0.55, 0.35, 0xfb7185, { tilt: 0.5 });
      this.drum('tom2', 0.85, 2.15, 0.1, 0.58, 0.35, 0xf472b6, { tilt: 0.5 });
      this.drum('tom3', 2.6, 1.3, 0.9, 0.7, 0.4, 0xc084fc, {});
      this.cymbal('hihat', -3.1, 2.2, 1.1, 0.7, 0x22d3ee);
      this.cymbal('crash', -2.3, 3.0, -0.9, 0.85, 0xfbbf24);
      this.cymbal('ride', 2.3, 2.9, -0.9, 0.9, 0xf59e0b);
      this.cymbal('openhat', -3.1, 2.75, 1.1, 0.7, 0x67e8f9);
      this.drums['openhat'].visible = false;
    }
  }
  setMode(m) { this.mode = m; synth.bank = m; this.buildKit(); }
  burst(pos, color, n = 22) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), v = [];
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y + 0.5; p[i * 3 + 2] = pos.z;
      v.push(new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 6 + 2, (Math.random() - 0.5) * 7));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(color), size: 0.14, transparent: true, opacity: 1 });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.particles.push({ pts, v, life: 1 });
  }
  ringShock(pos, color) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9 }));
    m.position.copy(pos); m.position.y += 0.7; m.rotation.x = Math.PI / 2;
    this.scene.add(m); this.particles.push({ ring: m, life: 1, v: [] });
  }
  hit(name, vel = 1) {
    const g = this.drums[name]; if (!g) return;
    const vis = name === 'openhat' ? 'hihat' : name;
    const vg = this.drums[vis] || g;
    vg.userData.squash = 1;
    vg.userData.headMat.emissiveIntensity = 1.4;
    const wp = new THREE.Vector3(); vg.getWorldPosition(wp);
    this.burst(wp, vg.userData.color, 14 + (vel * 16 | 0));
    this.ringShock(wp, vg.userData.color);
    this.purple.intensity = 90; this.cyan.intensity = 90;
    setTimeout(() => { this.purple.intensity = 60; this.cyan.intensity = 60; }, 90);
    synth.play(name);
    this.onHit?.(name, vel);
  }
  bindInput() {
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let downAt = 0, orbiting = false, px = 0, pinch = 0;
    const pick = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const cx = (e.touches?.[0]?.clientX ?? e.clientX), cy = (e.touches?.[0]?.clientY ?? e.clientY);
      ptr.x = ((cx - r.left) / r.width) * 2 - 1; ptr.y = -((cy - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ptr, this.camera);
      const hits = ray.intersectObjects(Object.values(this.drums).filter(d => d.visible), true);
      if (hits.length) {
        let o = hits[0].object;
        while (o && !o.userData.name) o = o.parent;
        return o?.userData.name;
      }
      return null;
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      downAt = performance.now(); px = e.clientX; orbiting = false;
      this.canvas.setPointerCapture?.(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons) {
        const dx = e.clientX - px; px = e.clientX;
        if (Math.abs(dx) > 2 || performance.now() - downAt > 220) { orbiting = true; this.camAng += dx * 0.008; this.autoOrbit = false; }
      }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!orbiting) {
        const n = pick(e);
        if (n) { this.hit(n === 'openhat' ? 'openhat' : n, 1); navigator.vibrate?.(12); }
      }
    });
    this.canvas.addEventListener('wheel', (e) => { this.camR = Math.min(17, Math.max(6, this.camR + e.deltaY * 0.01)); }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinch) this.camR = Math.min(17, Math.max(6, this.camR - (d - pinch) * 0.02));
        pinch = d;
      }
    }, { passive: true });
    this.canvas.addEventListener('touchend', () => pinch = 0);
  }
  loop() {
    requestAnimationFrame(() => this.loop());
    const t = performance.now() / 1000;
    if (this.autoOrbit) this.camAng = Math.sin(t * 0.12) * 0.35;
    this.camera.position.set(Math.sin(this.camAng) * this.camR, this.camY, Math.cos(this.camAng) * this.camR);
    this.camera.lookAt(0, 1.6, 0);
    for (const g of Object.values(this.drums)) {
      const u = g.userData;
      if (u.squash > 0) {
        u.squash = Math.max(0, u.squash - 0.09);
        const s = 1 + Math.sin(u.squash * Math.PI) * 0.22;
        g.scale.set(s, 2 - s > 0.4 ? 2 - s : 0.6, s);
        g.position.y = u.baseY - Math.sin(u.squash * Math.PI) * 0.18;
        u.headMat.emissiveIntensity = u.squash * 1.4;
      } else g.scale.set(1, 1, 1);
      if (u.cymbal) g.rotation.y += 0.15 * (u.squash + 0.02);
    }
    this.ring.rotation.z = t * 0.2;
    this.particles = this.particles.filter(p => {
      p.life -= 0.03;
      if (p.ring) { p.ring.scale.multiplyScalar(1.12); p.ring.material.opacity = p.life; }
      else {
        const pos = p.pts.geometry.attributes.position;
        for (let i = 0; i < p.v.length; i++) {
          p.v[i].y -= 0.22;
          pos.array[i * 3] += p.v[i].x * 0.03; pos.array[i * 3 + 1] += p.v[i].y * 0.03; pos.array[i * 3 + 2] += p.v[i].z * 0.03;
        }
        pos.needsUpdate = true; p.pts.material.opacity = p.life;
      }
      if (p.life <= 0) { this.scene.remove(p.pts || p.ring); return false; }
      return true;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
