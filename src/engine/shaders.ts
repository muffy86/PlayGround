/**
 * Phase 3 — WebGPU-ready shader sources.
 *
 * Strategy: ship the same visual in two dialects from one uniform contract.
 * - `SPARK_WGSL`: native WebGPU render-pipeline snippet (points → quads).
 * - `SPARK_GLSL`: three.js `ShaderMaterial` chunk with identical uniforms,
 *   used live today on WebGL.
 * - `RING_WGSL` / `RING_GLSL`: expanding hit shockwave ring.
 *
 * `sparkUniforms()` builds the shared uniform payload (bloom threshold
 * included, agent-calibrated). `validateShaderSources()` asserts the
 * contract in unit tests so a dialect can never drift from the uniforms.
 */
export interface SparkUniformValues {
  uTime: number;
  uBloom: number;
  uIntensity: number;
  uPixelRatio: number;
}

export function sparkUniforms(time: number, intensity: number, bloom: number, pixelRatio: number): SparkUniformValues {
  const b = Number.isFinite(bloom) ? Math.max(0, Math.min(1, bloom)) : 0.8;
  return {
    uTime: Number.isFinite(time) ? time : 0,
    uBloom: b,
    uIntensity: Number.isFinite(intensity) ? Math.max(0, intensity) : 0,
    uPixelRatio: Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1,
  };
}

export const SPARK_WGSL = /* wgsl */ `
struct SparkUniforms {
  uTime : f32,
  uBloom : f32,
  uIntensity : f32,
  uPixelRatio : f32,
};
@group(0) @binding(0) var<uniform> u : SparkUniforms;

struct VSIn {
  @location(0) aPos : vec3<f32>,
  @location(1) aData : vec2<f32>, // freshness, size
};
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vFresh : f32,
  @location(1) vSize : f32,
};

@vertex
fn vsMain(in : VSIn) -> VSOut {
  var out : VSOut;
  out.pos = vec4<f32>(in.aPos, 1.0);
  out.vFresh = in.aData.x;
  out.vSize = in.aData.y * u.uPixelRatio;
  return out;
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let heat = clamp(in.vFresh + u.uIntensity * 0.15, 0.0, 1.0);
  let core = vec3<f32>(1.0, 0.98, 0.94) * heat;
  let glow = vec3<f32>(1.0, 0.31, 0.80) * (1.0 - heat) * (0.5 + u.uBloom);
  return vec4<f32>(core + glow, heat);
}
`.trim();

export const SPARK_GLSL = /* glsl */ `
uniform float uTime;
uniform float uBloom;
uniform float uIntensity;
uniform float uPixelRatio;
attribute vec2 aData; // freshness, size
varying float vFresh;
void main() {
  vFresh = clamp(aData.x + uIntensity * 0.15, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = aData.y * uPixelRatio * (140.0 / max(1.0, -mv.z));
  gl_PointSize = clamp(px, 1.0, 22.0);
  gl_Position = projectionMatrix * mv;
}
`.trim();

export const SPARK_GLSL_FRAG = /* glsl */ `
precision mediump float;
uniform float uBloom;
varying float vFresh;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float d = length(pc);
  if (d > 0.5) discard;
  float heat = clamp(vFresh, 0.0, 1.0);
  vec3 core = vec3(1.0, 0.98, 0.94) * heat;
  vec3 glow = vec3(1.0, 0.31, 0.80) * (1.0 - heat) * (0.5 + uBloom);
  gl_FragColor = vec4(core + glow, heat * smoothstep(0.5, 0.12, d));
}
`.trim();

export const RING_WGSL = /* wgsl */ `
struct RingUniforms {
  uTime : f32,
  uBloom : f32,
  uIntensity : f32,
  uPixelRatio : f32,
};
@group(0) @binding(0) var<uniform> u : RingUniforms;

@fragment
fn fsRing(@location(0) vUv : vec2<f32>) -> @location(0) vec4<f32> {
  let d = length(vUv - vec2<f32>(0.5));
  let band = smoothstep(0.06, 0.0, abs(d - fract(u.uTime) * 0.5));
  let a = band * (0.4 + u.uBloom * 0.6) * u.uIntensity;
  return vec4<f32>(0.35, 0.94, 1.0, a);
}
`.trim();

export const RING_GLSL = /* glsl */ `
uniform float uTime;
uniform float uBloom;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float d = length(vUv - vec2(0.5));
  float band = smoothstep(0.06, 0.0, abs(d - fract(uTime) * 0.5));
  float a = band * (0.4 + uBloom * 0.6) * uIntensity;
  gl_FragColor = vec4(0.35, 0.94, 1.0, a);
}
`.trim();

const REQUIRED_UNIFORMS = ['uTime', 'uBloom', 'uIntensity', 'uPixelRatio'] as const;

/** Assert every dialect declares the shared uniform contract. Throws on drift. */
export function validateShaderSources(): string[] {
  const checked: string[] = [];
  const pairs: Array<[string, string]> = [
    ['SPARK_WGSL', SPARK_WGSL],
    ['SPARK_GLSL', SPARK_GLSL],
    ['SPARK_GLSL_FRAG', SPARK_GLSL_FRAG],
    ['RING_WGSL', RING_WGSL],
    ['RING_GLSL', RING_GLSL],
  ];
  for (const [name, src] of pairs) {
    if (!src || src.length < 32) throw new Error(`validateShaderSources: ${name} is empty`);
    checked.push(name);
  }
  for (const uniform of REQUIRED_UNIFORMS) {
    if (!SPARK_WGSL.includes(uniform)) throw new Error(`SPARK_WGSL missing ${uniform}`);
    if (!SPARK_GLSL.includes(uniform)) throw new Error(`SPARK_GLSL missing ${uniform}`);
  }
  if (!SPARK_GLSL_FRAG.includes('uBloom')) throw new Error('SPARK_GLSL_FRAG missing uBloom');
  if (!RING_WGSL.includes('uBloom') || !RING_GLSL.includes('uBloom')) {
    throw new Error('ring shaders missing uBloom');
  }
  return checked;
}
