import { randomUUID } from "node:crypto";

/** DSH 0.1.2+ unary RPC: slash endpoints + { args: { request|_request: … } }. */
const METHOD_ARG_WRAPPERS: Record<string, string | null> = {
  "session/list": "_request",
  "session/create": "request",
  "session/prompt": "request",
  "session/cancel": "request",
  "session/selectModel": "request",
  "session/rename": "request",
  "workspace/create": "request",
  "workspace/rename": "request",
  "workspace/archiveSession": "request",
  "agentPresets/list": null,
  "settings/describe": null,
  "host/describe": null,
};

export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export function endpointOf(method: string): string {
  return method.replaceAll(".", "/");
}

export function wrapArgs(method: string, payload: unknown): { args: Record<string, unknown> } {
  const endpoint = endpointOf(method);
  let body: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : {};
  if (endpoint === "session/prompt" && typeof body.requestId !== "string") {
    body = { ...body, requestId: randomUUID() };
  }
  const wrapper = METHOD_ARG_WRAPPERS[endpoint];
  if (wrapper === null) return { args: {} };
  if (wrapper === undefined) return { args: body };
  return { args: { [wrapper]: body } };
}

export function buildClientRequest(method: string, payload: unknown): {
  type: "client-request";
  rpcId: string;
  method: string;
  payload: { args: Record<string, unknown> };
} {
  const endpoint = endpointOf(method);
  return {
    type: "client-request",
    rpcId: randomUUID(),
    method: endpoint,
    payload: wrapArgs(method, payload),
  };
}

export function unwrapRpc<T>(result: RpcResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`);
}
