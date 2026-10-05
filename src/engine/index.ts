/**
 * Drum engine public surface.
 *
 * Phase 1 — timing and the note highway:
 * - `PolyrhythmQuantizer`: zero-allocation tick/ms grid scorer with
 *   millisecond PERFECT/GREAT/MISS ratings, odd-meter and N-against-M grids.
 * - `NoteHighway` + `HighwayFrame`: preallocated note coordinates.
 * - `EngineLoop`: requestAnimationFrame driver. Pass a `gate` to commit
 *   queued mutations at the start of every frame.
 * - `MidiClock` + `MidiTickSource`: live MIDI tick input.
 *
 * Phase 2 — serialization, WebMCP, practice telemetry:
 * - `AsyncStateGate` + `DrumSession`: atomic pad/kit mutations around the rAF loop.
 * - `DeviationBuffer`: real-time millisecond-offset ring and latency heatmap.
 * - `ToolBridge`: Zod-typed WebMCP tools, including `terminal_bridge_execute`
 *   and `pad_trigger`. Dispatches registered actions only — never a shell.
 * - `attachContainerRuntime`: same-origin container-runtime message bridge.
 */
export { HitRating, createQuantizeResult, createHitTestResult } from './types.js';
export type { MeterSig, QuantizeResult, HitTestResult } from './types.js';
export { PolyrhythmQuantizer, meterGrid, polyrhythm } from './quantizer.js';
export type { QuantizerOptions, MeterGridOptions } from './quantizer.js';
export { NoteHighway, NOTE_PENDING, NOTE_HIT, NOTE_MISSED } from './highway.js';
export type { HighwayOptions, HighwayFrame } from './highway.js';
export { EngineLoop } from './loop.js';
export type { EngineLoopOptions, FrameGate } from './loop.js';
export { MidiClock, MidiTickSource, defaultDrumLane } from './midi.js';
export type { MidiNoteHandler, MidiAccessLike, MidiInputLike, MidiMessageLike } from './midi.js';
export { AsyncStateGate, GateError } from './gate.js';
export { DeviationBuffer, rateOffset, DEVIATION_RATINGS } from './deviation.js';
export type { DeviationSample, DeviationRating, HeatmapOptions, LatencyHeatmap, RatingCounts } from './deviation.js';
export { DRUM_IDS, KIT_MODES, isDrumId, isKitMode } from './drums.js';
export type { DrumId, KitMode } from './drums.js';
export { DrumSession, createDrumState, drumSession, practiceTelemetry, isDeviationRating } from './session.js';
export type { DrumState, KitSnapshot, KitPatch, PadSnapshot, StrikeResult, SessionOptions } from './session.js';
export { zodToInputSchema } from './schema.js';
export type { JsonSchema } from './schema.js';
export {
  ToolBridge,
  BridgeError,
  attachModelContext,
  attachLiveModelContext,
  readModelContext,
  isSafeActionName,
  padTriggerSchema,
  kitConfigureSchema,
  heatmapSchema,
  snapshotSchema,
  bridgeEnvelopeSchema,
} from './webmcp.js';
export type { BridgeHost, ModelContextLike, ModelContextTool, WebMcpAnnotations } from './webmcp.js';
export {
  attachContainerRuntime,
  attachLiveRuntime,
  isExecuteRequest,
  RUNTIME_SOURCE,
  RUNTIME_REQUEST_SOURCE,
} from './runtime.js';
export type { RuntimePort, RuntimeExecuteRequest, RuntimeResult, RuntimeMessageEvent } from './runtime.js';
