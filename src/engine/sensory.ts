/**
 * Phase 3 — sensory control tools for `document.modelContext`.
 *
 * - `setFeedbackIntensity`: calibrate vibration, camera shake, bloom, and
 *   master gain (all clamped 0..1). Writes go through `SensorySettings`;
 *   master gain additionally fans out to the live `ProceduralSynth`.
 * - `exportTelemetryHeatmap`: read the Phase 2 deviation buffer and return
 *   the latency heatmap plus a compact telemetry summary (count, mean,
 *   on-time rate, per-rating totals). Read-only.
 *
 * Both are registered on the shared `ToolBridge` (so `terminal_bridge_execute`
 * can dispatch them too) and attach to `document.modelContext` like every
 * other tool. Schemas are Zod; JSON Schema conversion is handled by the
 * bridge.
 */
import { z } from 'zod';
import type { ToolBridge } from './webmcp.js';
import { sensorySettings, type SensoryLevels } from './haptics.js';
import type { ProceduralSynth } from './synth.js';

export const feedbackIntensitySchema = z
  .object({
    haptics: z.number().finite().min(0).max(1).optional().describe('Vibration strength, 0..1. 0 silences haptics.'),
    shake: z.number().finite().min(0).max(1).optional().describe('Camera trauma shake strength, 0..1.'),
    bloom: z.number().finite().min(0).max(1).optional().describe('Spark/ring bloom threshold, 0..1.'),
    master: z.number().finite().min(0).max(1).optional().describe('Synth master gain, 0..1.'),
  })
  .strict();

export const exportHeatmapSchema = z
  .object({
    binMs: z.number().int().min(1).max(100).default(10).describe('Histogram bin width in ms.'),
    minMs: z.number().finite().default(-120).describe('Inclusive lower edge, ms.'),
    maxMs: z.number().finite().default(120).describe('Exclusive upper edge, ms.'),
    onTimeMs: z.number().finite().min(0).default(45).describe('On-time window, absolute ms.'),
  })
  .strict();

export interface TelemetryExport {
  heatmap: {
    binMs: number;
    minMs: number;
    maxMs: number;
    onTimeMs: number;
    bins: number[];
    total: number;
    inRange: number;
    underflow: number;
    overflow: number;
    meanMs: number;
    stdevMs: number;
  };
  summary: {
    samples: number;
    meanMs: number;
    onTimeRate: number;
    perfect: number;
    great: number;
    good: number;
    miss: number;
  };
}

export interface SensoryHooks {
  synth?: ProceduralSynth | null | undefined;
}

function requireOneField(args: Record<string, unknown>): void {
  if (args['haptics'] === undefined && args['shake'] === undefined && args['bloom'] === undefined && args['master'] === undefined) {
    throw new TypeError('setFeedbackIntensity: at least one of haptics/shake/bloom/master is required');
  }
}

/**
 * Register `setFeedbackIntensity` + `exportTelemetryHeatmap` on the bridge.
 * Idempotent per bridge instance (re-registering throws `duplicate_action`
 * from the bridge — call once at startup).
 */
export function registerSensoryTools(bridge: ToolBridge, hooks: SensoryHooks = {}): string[] {
  bridge.registerAction(
    'setFeedbackIntensity',
    feedbackIntensitySchema,
    (args) => {
      requireOneField(args as Record<string, unknown>);
      const patch: Partial<SensoryLevels> = {};
      if (args.haptics !== undefined) patch.haptics = args.haptics;
      if (args.shake !== undefined) patch.shake = args.shake;
      if (args.bloom !== undefined) patch.bloom = args.bloom;
      if (args.master !== undefined) patch.master = args.master;
      const levels = sensorySettings.set(patch);
      try {
        hooks.synth?.setMaster(levels.master);
      } catch {
        /* audio must never break the tool call */
      }
      return levels;
    },
    {
      title: 'Set feedback intensity',
      description:
        'Calibrate arcade feedback: vibration, camera shake, bloom threshold, master gain. At least one field required; values clamp to 0..1.',
    },
  );

  bridge.registerAction(
    'exportTelemetryHeatmap',
    exportHeatmapSchema,
    async (args, live) => {
      const heat = await live.session.gate.mutate(() =>
        live.session.deviations.heatmap({
          binMs: args.binMs,
          minMs: args.minMs,
          maxMs: args.maxMs,
          onTimeMs: args.onTimeMs,
        }),
      );
      const total = heat.total;
      const out: TelemetryExport = {
        heatmap: {
          binMs: heat.binMs,
          minMs: heat.minMs,
          maxMs: heat.maxMs,
          onTimeMs: heat.onTimeMs,
          bins: heat.bins,
          total: heat.total,
          inRange: heat.inRange,
          underflow: heat.underflow,
          overflow: heat.overflow,
          meanMs: heat.meanMs,
          stdevMs: heat.stdevMs,
        },
        summary: {
          samples: total,
          meanMs: heat.meanMs,
          onTimeRate: total > 0 ? heat.onTime / total : 0,
          perfect: heat.byRating.PERFECT,
          great: heat.byRating.GREAT,
          good: heat.byRating.GOOD,
          miss: heat.byRating.MISS,
        },
      };
      return out;
    },
    {
      title: 'Export telemetry heatmap',
      description:
        'Read the live timing-deviation buffer and return the millisecond accuracy latency heatmap plus summary. Read-only.',
      readOnly: true,
    },
  );

  return ['setFeedbackIntensity', 'exportTelemetryHeatmap'];
}
