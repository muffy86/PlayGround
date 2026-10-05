/**
 * Type-safe WebMCP tool bridge.
 *
 * Tools are Zod schemas. `attachModelContext` converts them to JSON Schema
 * and registers them on `document.modelContext` (WebMCP imperative API) when
 * a context is supplied. `terminal_bridge_execute` is the extensible entry
 * the container runtime calls: it dispatches a *registered action name* plus
 * validated args. It never spawns a shell and rejects shell-like names.
 *
 * Every built-in action runs through the session gate, so concurrent tool
 * calls during a frame serialize and publish together.
 */
import { z, type ZodTypeAny } from 'zod';
import { zodToInputSchema, type JsonSchema } from './schema.js';
import { DrumSession, type DrumState, type KitPatch, type KitSnapshot, type StrikeResult } from './session.js';
import { rateOffset, type LatencyHeatmap } from './deviation.js';
import { DRUM_IDS, KIT_MODES, type DrumId } from './drums.js';
import { DEVIATION_RATINGS } from './deviation.js';

export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

export interface WebMcpAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ModelContextTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: WebMcpAnnotations;
  execute: (input: unknown) => Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void>;
}

export interface BridgeHost {
  onPad?: (pad: DrumId, velocity: number, timeMs: number) => void;
  onKit?: (kit: KitSnapshot) => void;
}

const ACTION_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const BLOCKED_ACTIONS = new Set(['sh', 'bash', 'zsh', 'exec', 'spawn', 'eval', 'system', 'shell']);

/** Action names the bridge will dispatch. Shell-shaped names are refused. */
export function isSafeActionName(name: string): boolean {
  return ACTION_NAME.test(name) && !BLOCKED_ACTIONS.has(name);
}

export const padTriggerSchema = z
  .object({
    pad: z.enum(DRUM_IDS).describe('Drum pad to strike.'),
    velocity: z.number().min(0).max(1).default(1).describe('Strike velocity, 0..1.'),
    timeMs: z.number().finite().optional().describe('Engine timestamp in milliseconds.'),
    offsetMs: z.number().finite().optional().describe('Signed timing deviation in milliseconds.'),
    rating: z.enum(DEVIATION_RATINGS).optional().describe('Accuracy rating paired with offsetMs.'),
  })
  .strict();

export const kitConfigureSchema = z
  .object({
    mode: z.enum(KIT_MODES).optional().describe('acoustic or electric kit.'),
    bpm: z.number().finite().min(40).max(240).optional().describe('Tempo, 40..240.'),
    volume: z.number().finite().min(0).max(1).optional().describe('Master volume, 0..1.'),
    muted: z.boolean().optional().describe('Mute the kit without changing volume.'),
  })
  .strict();

export const heatmapSchema = z
  .object({
    binMs: z.number().int().min(1).max(100).default(10).describe('Histogram bin width in ms.'),
    minMs: z.number().finite().default(-120).describe('Inclusive lower edge, ms.'),
    maxMs: z.number().finite().default(120).describe('Exclusive upper edge, ms.'),
    onTimeMs: z.number().finite().min(0).default(45).describe('On-time window, absolute ms.'),
    drum: z.enum(DRUM_IDS).optional().describe('Restrict the heatmap to one pad.'),
  })
  .strict();

export const snapshotSchema = z.object({}).strict();

export const bridgeEnvelopeSchema = z
  .object({
    action: z.string().min(1).describe('Registered bridge action. Never a shell command.'),
    args: z.record(z.string(), z.unknown()).optional().describe('Arguments for that action.'),
  })
  .strict();

interface ActionDef {
  name: string;
  title: string;
  description: string;
  schema: ZodTypeAny;
  annotations: WebMcpAnnotations;
  /** When false, the action is dispatcher-only and not a direct tool. */
  expose: boolean;
  run: (args: unknown, bridge: ToolBridge) => Promise<unknown>;
}

function annotations(partial: Partial<WebMcpAnnotations> & Pick<WebMcpAnnotations, 'readOnlyHint'>): WebMcpAnnotations {
  return {
    readOnlyHint: partial.readOnlyHint,
    destructiveHint: partial.destructiveHint ?? false,
    idempotentHint: partial.idempotentHint ?? false,
    openWorldHint: false,
  };
}

export class ToolBridge {
  readonly session: DrumSession;
  private host: BridgeHost;
  private readonly nowFn: () => number;
  private readonly actions = new Map<string, ActionDef>();

  constructor(session: DrumSession, host: BridgeHost = {}, now: () => number = defaultNow) {
    this.session = session;
    this.host = host;
    this.nowFn = now;
    this.installBuiltins();
  }

  setHost(host: BridgeHost): void {
    this.host = host;
  }

  now(): number {
    return this.nowFn();
  }

  /** Names `terminal_bridge_execute` will dispatch, in registration order. */
  actionsNames(): string[] {
    return [...this.actions.keys()].filter((name) => name !== 'terminal_bridge_execute');
  }

  /**
   * Register an additional action. Available immediately to
   * `terminal_bridge_execute` (lookup is at call time). `expose: true` also
   * lists it as its own WebMCP tool on the next `toolDefinitions()` call.
   */
  registerAction<S extends ZodTypeAny>(
    name: string,
    schema: S,
    run: (args: z.infer<S>, bridge: ToolBridge) => unknown | Promise<unknown>,
    meta: { title: string; description: string; readOnly?: boolean; expose?: boolean },
  ): void {
    if (!isSafeActionName(name) || name === 'terminal_bridge_execute') {
      throw new BridgeError('bad_action', `refusing action name "${name}"`);
    }
    if (this.actions.has(name)) {
      throw new BridgeError('duplicate_action', `action "${name}" is already registered`);
    }
    const readOnly = meta.readOnly ?? false;
    this.actions.set(name, {
      name,
      title: meta.title,
      description: meta.description,
      schema,
      annotations: annotations({ readOnlyHint: readOnly, idempotentHint: readOnly }),
      expose: meta.expose ?? true,
      run: async (args) => run(args as z.infer<S>, this),
    });
  }

  /** Execute a tool or bridge action. Invalid input rejects before any mutation. */
  async execute(name: string, raw: unknown = {}): Promise<unknown> {
    if (name === 'terminal_bridge_execute') {
      const env = bridgeEnvelopeSchema.parse(raw ?? {});
      if (!isSafeActionName(env.action) || env.action === 'terminal_bridge_execute' || !this.actions.has(env.action)) {
        throw new BridgeError('unknown_action', `unknown bridge action "${env.action}"`);
      }
      return this.execute(env.action, env.args ?? {});
    }
    const action = this.actions.get(name);
    if (!action || name === 'terminal_bridge_execute') {
      throw new BridgeError('unknown_tool', `unknown tool "${name}"`);
    }
    const args = action.schema.parse(raw ?? {});
    return action.run(args, this);
  }

  /** Tool descriptors, JSON Schema included, ready for `registerTool`. */
  toolDefinitions(): ModelContextTool[] {
    const out: ModelContextTool[] = [];
    for (const action of this.actions.values()) {
      if (!action.expose && action.name !== 'terminal_bridge_execute') continue;
      out.push(this.toTool(action));
    }
    return out;
  }

  async attachModelContext(ctx: ModelContextLike, signal?: AbortSignal): Promise<string[]> {
    const names: string[] = [];
    for (const tool of this.toolDefinitions()) {
      if (signal) await ctx.registerTool(tool, { signal });
      else await ctx.registerTool(tool);
      names.push(tool.name);
    }
    return names;
  }

  private toTool(action: ActionDef): ModelContextTool {
    const description =
      action.name === 'terminal_bridge_execute'
        ? `${action.description} Actions: ${this.actionsNames().join(', ') || '(none)'}.`
        : action.description;
    return {
      name: action.name,
      title: action.title,
      description,
      inputSchema: zodToInputSchema(action.schema),
      annotations: action.annotations,
      execute: (input) => this.execute(action.name, input),
    };
  }

  private installBuiltins(): void {
    this.actions.set('pad_trigger', {
      name: 'pad_trigger',
      title: 'Trigger pad',
      description: 'Strike one drum pad. Serialized with kit changes on the frame gate. Optionally logs a timing deviation.',
      schema: padTriggerSchema,
      annotations: annotations({ readOnlyHint: false }),
      expose: true,
      run: (args) => this.runPad(padTriggerSchema.parse(args)),
    });
    this.actions.set('kit_configure', {
      name: 'kit_configure',
      title: 'Configure kit',
      description: 'Atomically update kit mode, tempo, volume, or mute. Applied with any queued pad strikes at the next frame commit.',
      schema: kitConfigureSchema,
      annotations: annotations({ readOnlyHint: false }),
      expose: true,
      run: (args) => this.runKit(kitConfigureSchema.parse(args)),
    });
    this.actions.set('telemetry_heatmap', {
      name: 'telemetry_heatmap',
      title: 'Latency heatmap',
      description: 'Accuracy latency heatmap of signed millisecond strike offsets. Read-only.',
      schema: heatmapSchema,
      annotations: annotations({ readOnlyHint: true, idempotentHint: true }),
      expose: true,
      run: (args) => this.runHeatmap(heatmapSchema.parse(args)),
    });
    this.actions.set('session_snapshot', {
      name: 'session_snapshot',
      title: 'Session snapshot',
      description: 'Published drum-session snapshot (revision, kit, pad counters). Read-only.',
      schema: snapshotSchema,
      annotations: annotations({ readOnlyHint: true, idempotentHint: true }),
      expose: true,
      run: () => this.runSnapshot(),
    });
    this.actions.set('terminal_bridge_execute', {
      name: 'terminal_bridge_execute',
      title: 'Bridge execute',
      description:
        'Dispatch a registered in-page bridge action by name. Does not execute shell commands, spawn processes, or leave the page.',
      schema: bridgeEnvelopeSchema,
      annotations: annotations({ readOnlyHint: false }),
      expose: true,
      run: () => Promise.reject(new BridgeError('internal', 'terminal_bridge_execute is dispatched by execute()')),
    });
  }

  private async runPad(args: z.infer<typeof padTriggerSchema>): Promise<StrikeResult> {
    const timeMs = args.timeMs ?? this.now();
    const deviation =
      args.offsetMs === undefined
        ? undefined
        : { offsetMs: args.offsetMs, rating: args.rating ?? rateOffset(args.offsetMs) };
    const result = await this.session.strike(args.pad, args.velocity, timeMs, deviation);
    this.host.onPad?.(args.pad, args.velocity, timeMs);
    return result;
  }

  private async runKit(args: z.infer<typeof kitConfigureSchema>): Promise<KitSnapshot> {
    const patch: KitPatch = {};
    if (args.mode !== undefined) patch.mode = args.mode;
    if (args.bpm !== undefined) patch.bpm = args.bpm;
    if (args.volume !== undefined) patch.volume = args.volume;
    if (args.muted !== undefined) patch.muted = args.muted;
    const kit = await this.session.configure(patch);
    this.host.onKit?.(kit);
    return kit;
  }

  private async runHeatmap(args: z.infer<typeof heatmapSchema>): Promise<LatencyHeatmap> {
    return this.session.gate.mutate(() =>
      this.session.deviations.heatmap({
        binMs: args.binMs,
        minMs: args.minMs,
        maxMs: args.maxMs,
        onTimeMs: args.onTimeMs,
        ...(args.drum !== undefined ? { drum: args.drum } : {}),
      }),
    );
  }

  private async runSnapshot(): Promise<DrumState> {
    return this.session.gate.mutate((draft) => structuredClone(draft));
  }
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

/** Register every exposed tool. Feature-detect before calling. */
export async function attachModelContext(
  bridge: ToolBridge,
  ctx: ModelContextLike,
  signal?: AbortSignal,
): Promise<string[]> {
  return bridge.attachModelContext(ctx, signal);
}

export function readModelContext(
  root: { document?: { modelContext?: ModelContextLike } | undefined } = globalThis as {
    document?: { modelContext?: ModelContextLike };
  },
): ModelContextLike | null {
  const ctx = root.document?.modelContext;
  if (!ctx || typeof ctx.registerTool !== 'function') return null;
  return ctx;
}

/** Attach to `document.modelContext` when the host browser provides WebMCP. */
export function attachLiveModelContext(bridge: ToolBridge): Promise<string[]> | null {
  const ctx = readModelContext();
  if (!ctx) return null;
  return attachModelContext(bridge, ctx);
}
