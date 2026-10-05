/**
 * Container-runtime adapter for the WebMCP bridge.
 *
 * The playground host (or any same-origin parent) posts
 * `{ source: 'stickstar.runtime', type: 'execute', id, tool, args }`.
 * We validate the envelope, run it through {@link ToolBridge.execute}
 * (schema-checked, gate-serialized), and post the result back to the same
 * origin. Cross-origin messages are ignored. Nothing here reaches a shell.
 */
import { BridgeError, type ToolBridge } from './webmcp.js';

export const RUNTIME_SOURCE = 'stickstar.engine';
export const RUNTIME_REQUEST_SOURCE = 'stickstar.runtime';

export interface RuntimeExecuteRequest {
  source: typeof RUNTIME_REQUEST_SOURCE;
  type: 'execute';
  id: string;
  tool: string;
  args?: unknown;
}

export interface RuntimeResult {
  source: typeof RUNTIME_SOURCE;
  type: 'result';
  id: string;
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

export interface RuntimeMessageEvent {
  origin: string;
  data: unknown;
}

export interface RuntimePort {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: RuntimeMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: RuntimeMessageEvent) => void): void;
}

export function isExecuteRequest(data: unknown): data is RuntimeExecuteRequest {
  if (data === null || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    d['source'] === RUNTIME_REQUEST_SOURCE &&
    d['type'] === 'execute' &&
    typeof d['id'] === 'string' &&
    d['id'].length > 0 &&
    typeof d['tool'] === 'string' &&
    d['tool'].length > 0
  );
}

function errorCode(error: unknown): string {
  if (error instanceof BridgeError) return error.code;
  if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'ZodError') {
    return 'invalid_input';
  }
  return 'execute_failed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Listen for same-origin execute requests and answer them.
 * Returns a detach function. `origin` is both the accept-filter and the
 * postMessage target — never `*`.
 */
export function attachContainerRuntime(bridge: ToolBridge, port: RuntimePort, origin: string): () => void {
  if (!origin || origin === '*') {
    throw new RangeError('attachContainerRuntime: origin must be a concrete origin, not *');
  }
  const onMessage = (event: RuntimeMessageEvent): void => {
    if (event.origin !== origin) return;
    if (!isExecuteRequest(event.data)) return;
    const request = event.data;
    void bridge
      .execute(request.tool, request.args ?? {})
      .then((data) => {
        const result: RuntimeResult = {
          source: RUNTIME_SOURCE,
          type: 'result',
          id: request.id,
          tool: request.tool,
          ok: true,
          data,
        };
        port.postMessage(result, origin);
      })
      .catch((error: unknown) => {
        const result: RuntimeResult = {
          source: RUNTIME_SOURCE,
          type: 'result',
          id: request.id,
          tool: request.tool,
          ok: false,
          error: errorMessage(error),
          code: errorCode(error),
        };
        port.postMessage(result, origin);
      });
  };
  port.addEventListener('message', onMessage);
  return () => port.removeEventListener('message', onMessage);
}

/** Attach when this page is embedded in a same-origin parent frame. */
export function attachLiveRuntime(bridge: ToolBridge): (() => void) | null {
  if (typeof window === 'undefined') return null;
  if (window.parent === window) return null;
  const origin = window.location.origin;
  if (!origin || origin === 'null') return null;
  return attachContainerRuntime(bridge, window, origin);
}
