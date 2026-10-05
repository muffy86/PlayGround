import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToInputSchema } from '../schema.js';
import { DrumSession } from '../session.js';
import {
  BridgeError,
  ToolBridge,
  attachModelContext,
  bridgeEnvelopeSchema,
  isSafeActionName,
  padTriggerSchema,
  readModelContext,
} from '../webmcp.js';
import { attachContainerRuntime, isExecuteRequest, type RuntimeMessageEvent, type RuntimePort } from '../runtime.js';
import { DRUM_IDS } from '../drums.js';

function bridge(now = () => 1000): { session: DrumSession; bridge: ToolBridge; pads: string[]; kits: string[] } {
  const session = new DrumSession();
  const pads: string[] = [];
  const kits: string[] = [];
  const tool = new ToolBridge(
    session,
    {
      onPad: (pad) => pads.push(pad),
      onKit: (kit) => kits.push(kit.mode),
    },
    now,
  );
  return { session, bridge: tool, pads, kits };
}

describe('zod input schema', () => {
  it('converts pad_trigger into a closed JSON schema with defaults', () => {
    const schema = zodToInputSchema(padTriggerSchema);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['pad']);
    expect(schema.properties?.pad).toMatchObject({ type: 'string', enum: [...DRUM_IDS] });
    expect(schema.properties?.velocity).toMatchObject({ type: 'number', minimum: 0, maximum: 1, default: 1 });
    expect(schema.properties?.offsetMs).toMatchObject({ type: 'number' });
    expect(schema.properties?.timeMs?.description).toMatch(/timestamp/i);
  });

  it('converts the bridge envelope and rejects unsupported nodes', () => {
    const schema = zodToInputSchema(bridgeEnvelopeSchema);
    expect(schema.required).toEqual(['action']);
    expect(schema.properties?.action).toMatchObject({ type: 'string', minLength: 1 });
    expect(schema.properties?.args).toMatchObject({ type: 'object' });
    expect(() => zodToInputSchema(z.string().email())).not.toThrow();
    expect(() => zodToInputSchema(z.date())).toThrow(/unsupported/);
  });
});

describe('terminal_bridge_execute and pad triggers', () => {
  it('rejects unknown, shell-like, and invalid actions before mutating', async () => {
    const { session, bridge: tool } = bridge();
    expect(isSafeActionName('pad_trigger')).toBe(true);
    expect(isSafeActionName('bash')).toBe(false);
    expect(isSafeActionName('rm -rf')).toBe(false);
    await expect(tool.execute('terminal_bridge_execute', { action: 'bash', args: {} })).rejects.toBeInstanceOf(BridgeError);
    await expect(tool.execute('terminal_bridge_execute', { action: 'nope' })).rejects.toMatchObject({ code: 'unknown_action' });
    await expect(tool.execute('pad_trigger', { pad: 'piano' })).rejects.toThrow();
    await expect(tool.execute('kit_configure', { bpm: 999 })).rejects.toThrow();
    expect(session.snapshot().pads.kick.strikes).toBe(0);
    expect(session.snapshot().kit.bpm).toBe(90);
    expect(session.gate.pending).toBe(0);
    expect(() =>
      tool.registerAction('exec', z.object({}), () => 1, { title: 'no', description: 'no' }),
    ).toThrow(BridgeError);
  });

  it('serializes concurrent bridge calls during a frame and logs deviations', async () => {
    const { session, bridge: tool, pads, kits } = bridge();
    session.beginFrame();
    const pending = Promise.all([
      tool.execute('terminal_bridge_execute', {
        action: 'pad_trigger',
        args: { pad: 'kick', velocity: 1, offsetMs: -10, timeMs: 1 },
      }),
      tool.execute('terminal_bridge_execute', {
        action: 'kit_configure',
        args: { mode: 'electric', bpm: 132 },
      }),
      tool.execute('pad_trigger', { pad: 'snare', velocity: 0.4, offsetMs: 30, timeMs: 2 }),
      tool.execute('telemetry_heatmap', { binMs: 10, minMs: -50, maxMs: 50 }),
    ]);
    expect(session.snapshot().pads.kick.strikes).toBe(0);
    expect(session.snapshot().kit.mode).toBe('acoustic');
    expect(session.deviations.length).toBe(0);
    expect(pads).toEqual([]);
    expect(session.commit()).toBe(4);
    const [strike, kit, snare, heat] = await pending;
    expect(strike).toMatchObject({ pad: 'kick', strikes: 1, revision: 1 });
    expect(kit).toMatchObject({ mode: 'electric', bpm: 132 });
    expect(snare).toMatchObject({ pad: 'snare', strikes: 1 });
    expect(heat).toMatchObject({ total: 2, byRating: { PERFECT: 2, GREAT: 0, GOOD: 0, MISS: 0 } });
    expect((heat as { meanMs: number }).meanMs).toBeCloseTo(10, 5);
    expect(session.snapshot().revision).toBe(3);
    expect(session.snapshot().pads.kick.velocity).toBe(1);
    expect(session.snapshot().pads.snare.velocity).toBe(0.4);
    expect(pads).toEqual(['kick', 'snare']);
    expect(kits).toEqual(['electric']);
  });

  it('defaults velocity, rates an explicit offset, and exposes a registered action', async () => {
    const { session, bridge: tool } = bridge(() => 50);
    const result = await tool.execute('pad_trigger', { pad: 'ride', offsetMs: 80 });
    expect(result).toMatchObject({ pad: 'ride', velocity: 1, lastStrikeMs: 50 });
    expect(session.deviations.at(0)).toMatchObject({ rating: 'GREAT', drum: 'ride' });
    tool.registerAction(
      'count_strikes',
      z.object({ pad: z.enum(['kick', 'snare', 'hihat', 'hihatOpen', 'tom1', 'tom2', 'floor', 'crash', 'ride']) }),
      (args, live) => live.session.snapshot().pads[args.pad].strikes,
      { title: 'Count strikes', description: 'Read one pad counter.', readOnly: true },
    );
    await expect(tool.execute('terminal_bridge_execute', { action: 'count_strikes', args: { pad: 'ride' } })).resolves.toBe(1);
    expect(tool.actionsNames()).toContain('count_strikes');
    const defs = tool.toolDefinitions();
    const bridgeTool = defs.find((d) => d.name === 'terminal_bridge_execute');
    expect(bridgeTool?.description).toContain('count_strikes');
    expect(bridgeTool?.description).toMatch(/shell/i);
    expect(bridgeTool?.inputSchema.type).toBe('object');
  });

  it('returns a consistent snapshot and an empty heatmap before any strikes', async () => {
    const { bridge: tool } = bridge();
    const snap = await tool.execute('session_snapshot', {});
    expect(snap).toMatchObject({ revision: 0, kit: { mode: 'acoustic', bpm: 90 } });
    const heat = await tool.execute('telemetry_heatmap', {});
    expect(heat).toMatchObject({ total: 0, meanMs: 0, binMs: 10, minMs: -120, maxMs: 120 });
  });
});

describe('WebMCP model context', () => {
  it('registers JSON-schema tools and routes execute through the gate', async () => {
    const { session, bridge: tool } = bridge();
    const registered: Array<{ name: string; schema: unknown; signal?: AbortSignal }> = [];
    const ctx = {
      async registerTool(
        spec: { name: string; inputSchema: unknown; execute: (input: unknown) => Promise<unknown> },
        options?: { signal?: AbortSignal },
      ): Promise<void> {
        const entry: { name: string; schema: unknown; signal?: AbortSignal } = { name: spec.name, schema: spec.inputSchema };
        if (options?.signal) entry.signal = options.signal;
        registered.push(entry);
        if (spec.name === 'pad_trigger') {
          await spec.execute({ pad: 'tom1', velocity: 0.25 });
        }
      },
    };
    const ac = new AbortController();
    const names = await attachModelContext(tool, ctx, ac.signal);
    expect(names).toContain('terminal_bridge_execute');
    expect(names).toContain('pad_trigger');
    expect(registered.every((r) => r.signal === ac.signal)).toBe(true);
    const pad = registered.find((r) => r.name === 'pad_trigger');
    expect(pad?.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(session.snapshot().pads.tom1.strikes).toBe(1);
    expect(session.snapshot().pads.tom1.velocity).toBe(0.25);
  });

  it('feature-detects a missing model context', () => {
    expect(readModelContext({})).toBeNull();
    expect(readModelContext({ document: {} })).toBeNull();
  });
});

describe('container runtime bridge', () => {
  function fakePort(): RuntimePort & { messages: unknown[]; listeners: Array<(e: RuntimeMessageEvent) => void> } {
    const listeners: Array<(e: RuntimeMessageEvent) => void> = [];
    const messages: unknown[] = [];
    return {
      messages,
      listeners,
      postMessage(message) {
        messages.push(message);
      },
      addEventListener(_type, listener) {
        listeners.push(listener);
      },
      removeEventListener(_type, listener) {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
  }

  it('accepts same-origin execute requests and ignores everything else', async () => {
    const { session, bridge: tool } = bridge();
    const port = fakePort();
    expect(() => attachContainerRuntime(tool, port, '*')).toThrow(RangeError);
    const detach = attachContainerRuntime(tool, port, 'https://play.example');
    expect(isExecuteRequest({ source: 'stickstar.runtime', type: 'execute', id: 'a', tool: 'pad_trigger' })).toBe(true);
    expect(isExecuteRequest({ source: 'other', type: 'execute', id: 'a', tool: 'pad_trigger' })).toBe(false);
    port.listeners[0]?.({
      origin: 'https://evil.example',
      data: { source: 'stickstar.runtime', type: 'execute', id: '1', tool: 'pad_trigger', args: { pad: 'kick' } },
    });
    port.listeners[0]?.({ origin: 'https://play.example', data: { hello: 'nope' } });
    expect(port.messages).toEqual([]);
    expect(session.snapshot().pads.kick.strikes).toBe(0);
    port.listeners[0]?.({
      origin: 'https://play.example',
      data: { source: 'stickstar.runtime', type: 'execute', id: '2', tool: 'pad_trigger', args: { pad: 'kick', velocity: 0.7 } },
    });
    port.listeners[0]?.({
      origin: 'https://play.example',
      data: { source: 'stickstar.runtime', type: 'execute', id: '3', tool: 'not_a_tool', args: {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.messages).toHaveLength(2);
    const byId = Object.fromEntries(port.messages.map((m) => [(m as { id: string }).id, m]));
    expect(byId['2']).toMatchObject({ source: 'stickstar.engine', id: '2', ok: true, tool: 'pad_trigger' });
    expect(byId['3']).toMatchObject({ id: '3', ok: false, code: 'unknown_tool' });
    expect(session.snapshot().pads.kick.strikes).toBe(1);
    detach();
    expect(port.listeners).toHaveLength(0);
  });

  it('answers concurrent runtime calls in request order after one commit', async () => {
    const { session, bridge: tool } = bridge();
    session.beginFrame();
    const port = fakePort();
    attachContainerRuntime(tool, port, 'https://play.example');
    const send = (id: string, pad: string) =>
      port.listeners[0]?.({
        origin: 'https://play.example',
        data: { source: 'stickstar.runtime', type: 'execute', id, tool: 'pad_trigger', args: { pad, timeMs: 1 } },
      });
    send('a', 'kick');
    send('b', 'snare');
    send('c', 'floor');
    expect(port.messages).toEqual([]);
    expect(session.gate.pending).toBe(3);
    session.commit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.messages.map((m) => (m as { id: string }).id)).toEqual(['a', 'b', 'c']);
    expect(port.messages.every((m) => (m as { ok: boolean }).ok)).toBe(true);
    expect(session.snapshot().pads.kick.strikes).toBe(1);
    expect(session.snapshot().pads.snare.strikes).toBe(1);
    expect(session.snapshot().pads.floor.strikes).toBe(1);
  });
});
