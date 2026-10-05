import { describe, expect, it } from 'vitest';
import { DrumSession } from '../session.js';
import { ToolBridge } from '../webmcp.js';
import { registerSensoryTools, feedbackIntensitySchema, exportHeatmapSchema } from '../sensory.js';
import { sensorySettings } from '../haptics.js';

function rig() {
  const session = new DrumSession();
  const bridge = new ToolBridge(session, {}, () => 0);
  registerSensoryTools(bridge);
  return { session, bridge };
}

describe('sensory tools', () => {
  it('registers both tools as modelContext-ready definitions', () => {
    const { bridge } = rig();
    const defs = bridge.toolDefinitions().filter((d) => d.name === 'setFeedbackIntensity' || d.name === 'exportTelemetryHeatmap');
    expect(defs.length).toBe(2);
    const names = bridge.actionsNames();
    expect(names).toContain('setFeedbackIntensity');
    expect(names).toContain('exportTelemetryHeatmap');
    const fb = defs.find((d) => d.name === 'setFeedbackIntensity');
    expect(fb?.inputSchema.properties?.bloom).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
    expect(fb?.annotations.readOnlyHint).toBe(false);
    const ex = defs.find((d) => d.name === 'exportTelemetryHeatmap');
    expect(ex?.annotations.readOnlyHint).toBe(true);
    expect(feedbackIntensitySchema.parse({})).toEqual({}); // emptiness rejected by the handler, not the schema
    expect(exportHeatmapSchema.parse({})).toMatchObject({ binMs: 10 });
  });

  it('setFeedbackIntensity clamps, patches partially, and fans out to the synth', async () => {
    sensorySettings.reset();
    const { bridge } = rig();
    let mastered = -1;
    const fakeSynth = { setMaster: (v: number) => void (mastered = v) };
    const { registerSensoryTools: reg2 } = await import('../sensory.js');
    void reg2;
    // Re-register fan-out on a fresh bridge with the fake synth.
    const { ToolBridge: TB } = await import('../webmcp.js');
    const { DrumSession: DS } = await import('../session.js');
    const bridge2 = new TB(new DS(), {}, () => 0);
    (await import('../sensory.js')).registerSensoryTools(bridge2, { synth: fakeSynth as never });
    const levels = await bridge2.execute('setFeedbackIntensity', { shake: 0.25, bloom: 0.9 });
    expect(levels).toMatchObject({ shake: 0.25, bloom: 0.9 });
    // Out-of-range input is rejected loudly at the schema boundary…
    await expect(bridge2.execute('setFeedbackIntensity', { bloom: 2 })).rejects.toThrow();
    // …while direct settings writes clamp defensively.
    const { sensorySettings: live } = await import('../haptics.js');
    expect(live.set({ haptics: 9 })).toMatchObject({ haptics: 1 });
    expect(mastered).toBe(1); // synth re-synced to current master on every patch
    const levels2 = await bridge2.execute('setFeedbackIntensity', { master: 0.4 });
    expect(levels2).toMatchObject({ master: 0.4 });
    expect(mastered).toBe(0.4);
    await expect(bridge.execute('setFeedbackIntensity', {})).rejects.toThrow(/at least one/);
    await expect(bridge.execute('setFeedbackIntensity', { haptics: 9 })).rejects.toThrow();
    sensorySettings.reset();
  });

  it('exportTelemetryHeatmap reads the live deviation buffer', async () => {
    const { session, bridge } = rig();
    await session.strike('kick', 1, 0, { offsetMs: -12, rating: 'PERFECT' });
    await session.strike('snare', 1, 10, { offsetMs: 60, rating: 'GREAT' });
    const out = (await bridge.execute('exportTelemetryHeatmap', {})) as {
      heatmap: { total: number; meanMs: number };
      summary: { samples: number; perfect: number; great: number; onTimeRate: number };
    };
    expect(out.heatmap.total).toBe(2);
    expect(out.summary.samples).toBe(2);
    expect(out.summary.perfect).toBe(1);
    expect(out.summary.great).toBe(1);
    expect(out.summary.onTimeRate).toBeCloseTo(0.5, 6);
    expect(out.heatmap.meanMs).toBeCloseTo(24, 6);
    // Dispatchable through the generic bridge too.
    const via = (await bridge.execute('terminal_bridge_execute', {
      action: 'exportTelemetryHeatmap',
      args: {},
    })) as typeof out;
    expect(via.summary.samples).toBe(2);
  });

  it('rejects duplicate registration', () => {
    const { bridge } = rig();
    expect(() => registerSensoryTools(bridge)).toThrow(/already registered/);
  });
});
