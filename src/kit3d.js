import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const PAD_DEFS = [
  { id: 'crash', label: 'Crash', emoji: '🌊', key: 'Q', color: '#ffd166', glow: '#ffd166' },
  { id: 'hihat', label: 'Hat', emoji: '🎩', key: 'A', color: '#38f0ff', glow: '#38f0ff' },
  { id: 'tom1', label: 'Tom 1', emoji: '🥁', key: 'S', color: '#7b5cff', glow: '#7b5cff' },
  { id: 'snare', label: 'Snare', emoji: '🥁', key: 'F', color: '#ff4ecd', glow: '#ff4ecd' },
  { id: 'tom2', label: 'Tom 2', emoji: '🥁', key: 'J', color: '#7b5cff', glow: '#9b8cff' },
  { id: 'floor', label: 'Floor', emoji: '🥁', key: 'K', color: '#b06cff', glow: '#b06cff' },
  { id: 'ride', label: 'Ride', emoji: '🛎', key: 'L', color: '#7CFF6B', glow: '#7CFF6B' },
  { id: 'kick', label: 'Kick', emoji: '🦵', key: 'Space', color: '#ff8a3d', glow: '#ff8a3d' },
  { id: 'hihatOpen', label: 'Open', emoji: '⭕', key: 'D', color: '#38f0ff', glow: '#38f0ff' },
];

let renderer, scene, camera, controls, ray, ptr;
let kitGroup, kitMode = 'acoustic';
let hitMeshes = new Map(); // id -> {group, mats, base, t}
let rings = [];
let eqBars = [];
let stickL, stickR, stickT = 0;
let onHit3D = null;
let flashT = 0;

export function setHitCallback(fn) { onHit3D = fn; }
export function getKitMode() { return kitMode; }

export function initScene(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0721, 9, 26);
  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 4.4, 8.4);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.1, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 5; controls.maxDistance = 13;
  controls.maxPolarAngle = 1.35; controls.minPolarAngle = 0.5;
  controls.enablePan = false;

  scene.add(new THREE.HemisphereLight(0xbfb3ff, 0x0b0721, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 8, 5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const p1 = new THREE.PointLight(0xff4ecd, 60, 20); p1.position.set(-5, 3, 2); scene.add(p1);
  const p2 = new THREE.PointLight(0x38f0ff, 60, 20); p2.position.set(5, 3, 2); scene.add(p2);
  const spot = new THREE.SpotLight(0xffffff, 120, 30, 0.5, 0.5);
  spot.position.set(0, 9, 2); spot.target.position.set(0, 0, 0);
  scene.add(spot, spot.target);

  // stage
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0x120c36, roughness: 0.35, metalness: 0.6 })
  );
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const ringGlow = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.55, 64),
    new THREE.MeshBasicMaterial({ color: 0x7b5cff, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  ringGlow.rotation.x = -Math.PI / 2; ringGlow.position.y = 0.01; scene.add(ringGlow);
  const ring2 = new THREE.Mesh(
    new THREE.RingGeometry(5.2, 5.28, 64),
    new THREE.MeshBasicMaterial({ color: 0xff4ecd, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.01; scene.add(ring2);

  // backdrop EQ bars
  const eqGeo = new THREE.BoxGeometry(0.35, 1, 0.35);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(eqGeo, new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.75 - i / 24 * 0.6, 0.9, 0.55),
      emissive: new THREE.Color().setHSL(0.75 - i / 24 * 0.6, 0.9, 0.3),
      roughness: 0.4
    }));
    const a = (i / 23 - 0.5) * Math.PI * 1.1;
    m.position.set(Math.sin(a) * 8.2, 1, -Math.cos(a) * 8.2 - 1);
    m.userData.phase = Math.random() * 10;
    scene.add(m); eqBars.push(m);
  }

  // sticks
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xf3d9a4, roughness: 0.6 });
  const sg = new THREE.CylinderGeometry(0.03, 0.035, 1.35, 8);
  stickL = new THREE.Mesh(sg, stickMat); stickL.castShadow = true;
  stickR = new THREE.Mesh(sg, stickMat); stickR.castShadow = true;
  stickL.position.set(-0.9, 2.9, 2.1); stickR.position.set(0.9, 2.9, 2.1);
  stickL.rotation.set(0.7, 0, 0.35); stickR.rotation.set(0.7, 0, -0.35);
  scene.add(stickL, stickR);

  kitGroup = new THREE.Group(); scene.add(kitGroup);
  buildKit('acoustic');

  ray = new THREE.Raycaster(); ptr = new THREE.Vector2();
  let downAt = 0;
  canvas.addEventListener('pointerdown', (e) => {
    downAt = performance.now();
    const r = canvas.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(kitGroup.children, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.drumId) o = o.parent;
      if (o?.userData.drumId) { strike(o.userData.drumId, 1); onHit3D?.(o.userData.drumId, 1); }
    }
  });

  resize();
  addEventListener('resize', resize);
  requestAnimationFrame(tick);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

function shellMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: kitMode === 'electric' ? 0.5 : 0.35, metalness: kitMode === 'electric' ? 0.3 : 0.15 });
}
function headMat() {
  return new THREE.MeshStandardMaterial({
    color: kitMode === 'electric' ? 0x1b1b26 : 0xf5f0e6,
    roughness: 0.85, metalness: 0.02,
    emissive: new THREE.Color(kitMode === 'electric' ? 0x223344 : 0x000000),
    emissiveIntensity: kitMode === 'electric' ? 0.7 : 0
  });
}
function cymbalMat() {
  return new THREE.MeshStandardMaterial({
    color: kitMode === 'electric' ? 0x23232e : 0xd9a441,
    roughness: kitMode === 'electric' ? 0.4 : 0.25, metalness: 0.85,
    emissive: new THREE.Color(kitMode === 'electric' ? 0x38f0ff : 0x000000),
    emissiveIntensity: kitMode === 'electric' ? 0.25 : 0
  });
}
function neonRim(color) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
}

function makeDrum(id, x, y, z, r, depth, shellColor, tiltX = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.x = tiltX;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, 28, 1, true), shellMat(shellColor));
  shell.castShadow = true;
  const head = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 28), headMat());
  head.rotation.x = -Math.PI / 2; head.position.y = depth / 2 + 0.001;
  head.userData.drumId = id;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 10, 32), kitMode === 'electric' ? neonRim(PAD_DEFS.find(p => p.id === id)?.color || '#fff') : new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = depth / 2;
  rim.userData.drumId = id;
  shell.userData.drumId = id;
  // stand
  if (y - depth / 2 > 0.4) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, y - depth / 2, 8), new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.8, roughness: 0.4 }));
    leg.position.y = -(depth / 2 + (y - depth / 2) / 2);
    g.add(leg);
  }
  g.add(shell, head, rim);
  g.userData.drumId = id;
  kitGroup.add(g);
  hitMeshes.set(id, { group: g, head, t: 0, baseY: y });
  return g;
}

function makeCymbal(id, x, y, z, r) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const geo = new THREE.LatheGeometry(
    [new THREE.Vector2(0.01, 0.16), new THREE.Vector2(r * 0.25, 0.1), new THREE.Vector2(r * 0.8, 0.02), new THREE.Vector2(r, -0.03)],
    28
  );
  const c = new THREE.Mesh(geo, cymbalMat());
  c.castShadow = true; c.userData.drumId = id;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, y, 8), new THREE.MeshStandardMaterial({ color: 0x9999aa, metalness: 0.85, roughness: 0.35 }));
  pole.position.y = -y / 2;
  g.add(c, pole);
  if (id === 'hihat') {
    const c2 = new THREE.Mesh(geo, cymbalMat()); c2.position.y = -0.09; c2.userData.drumId = 'hihat';
    g.add(c2);
  }
  g.userData.drumId = id;
  kitGroup.add(g);
  hitMeshes.set(id, { group: g, head: c, t: 0, baseY: y });
  return g;
}

function buildKit(mode) {
  kitMode = mode;
  while (kitGroup.children.length) {
    const c = kitGroup.children.pop();
    c.traverse?.(o => { o.geometry?.dispose?.(); });
  }
  hitMeshes.clear();
  const shell = mode === 'electric' ? 0x17171f : 0x8f1d2c;
  const shell2 = mode === 'electric' ? 0x101018 : 0xc23b4e;
  // kick (facing camera)
  const kick = makeDrum('kick', 0, 0.85, 0.6, 0.85, 0.9, shell);
  kick.rotation.x = Math.PI / 2 - 0.12;
  makeDrum('snare', -1.35, 1.15, 1.5, 0.52, 0.42, shell2, -0.1);
  makeDrum('tom1', -0.55, 1.75, 0.35, 0.44, 0.42, shell2, -0.35);
  makeDrum('tom2', 0.55, 1.75, 0.35, 0.48, 0.46, shell2, -0.35);
  makeDrum('floor', 1.55, 0.95, 0.9, 0.58, 0.7, shell, 0);
  makeCymbal('hihat', -2.25, 1.7, 0.9, 0.55);
  makeCymbal('crash', -1.15, 2.25, -0.35, 0.68);
  makeCymbal('ride', 1.5, 2.15, -0.2, 0.75);
  // open-hat shares hihat mesh but separate trigger handled in pads
  if (!hitMeshes.has('hihatOpen')) {
    hitMeshes.set('hihatOpen', hitMeshes.get('hihat'));
  }
}

export function setKitMode(mode) {
  if (mode === kitMode) return;
  buildKit(mode);
}

export function strike(id, vel = 1) {
  const key = id === 'hihatOpen' ? 'hihat' : id;
  const h = hitMeshes.get(key) || hitMeshes.get(id);
  if (h) h.t = 1;
  // sticks snap
  stickT = 1;
  const target = id === 'kick' ? { x: 0, y: 1.4, z: 1.2 } : h ? { x: h.group.position.x, y: h.group.position.y + 0.7, z: h.group.position.z + 0.5 } : null;
  if (target) {
    const s = Math.random() < 0.5 ? stickL : stickR;
    s.position.set(target.x + (Math.random() - 0.5) * 0.3, target.y + 0.9, target.z + 0.6);
  }
  // shockwave ring
  if (h) {
    const geo = new THREE.RingGeometry(0.3, 0.42, 32);
    const col = new THREE.Color(PAD_DEFS.find(p => p.id === id)?.color || '#ffffff');
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    m.position.copy(h.group.position); m.position.y += 0.35;
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    rings.push({ m, t: 0 });
  }
  flashT = 1;
}

let camT = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = 0.016;
  camT += dt;
  controls.update();
  // subtle camera sway + flash zoom punch
  flashT = Math.max(0, flashT - dt * 3);
  // kit hit squash
  for (const [, h] of hitMeshes) {
    if (h.t > 0) {
      h.t = Math.max(0, h.t - dt * 5);
      const s = 1 - Math.sin(h.t * Math.PI) * 0.18;
      h.group.scale.set(1 + (1 - s) * 0.8, s, 1 + (1 - s) * 0.8);
      if (h.head.material.emissive) {
        h.head.material.emissive.setHex(0xffffff);
        h.head.material.emissiveIntensity = h.t * 0.55;
      }
    } else {
      h.group.scale.lerp(new THREE.Vector3(1, 1, 1), 0.3);
      if (h.head.material.emissiveIntensity) h.head.material.emissiveIntensity *= 0.85;
    }
  }
  // rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt * 2.4;
    r.m.scale.setScalar(1 + r.t * 3.2);
    r.m.material.opacity = 0.9 * (1 - r.t);
    if (r.t >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); }
  }
  // eq bars dance
  const beat = 1 + flashT * 1.6;
  for (const b of eqBars) {
    b.scale.y = (0.4 + Math.abs(Math.sin(camT * 1.7 + b.userData.phase)) * 2.2) * beat;
    b.position.y = b.scale.y / 2;
  }
  // sticks recover
  stickT = Math.max(0, stickT - dt * 6);
  stickL.rotation.x = 0.9 - stickT * 0.7; stickR.rotation.x = 0.9 - stickT * 0.7;
  renderer.render(scene, camera);
}
