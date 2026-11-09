import { describe, expect, it } from "vitest";
import { buildClientRequest, endpointOf, wrapArgs } from "../../packages/bridge/src/dsh/rpc.js";

describe("dsh rpc wrap", () => {
  it("maps dotted methods to slash endpoints", () => {
    expect(endpointOf("session.create")).toBe("session/create");
  });

  it("wraps session/list with _request", () => {
    expect(wrapArgs("session/list", {})).toEqual({ args: { _request: {} } });
  });

  it("wraps session/prompt with requestId", () => {
    const wrapped = wrapArgs("session/prompt", {
      sessionId: "s1",
      mode: "queue",
      content: [{ type: "text", text: "hi" }],
    });
    expect(wrapped.args.request).toMatchObject({
      sessionId: "s1",
      mode: "queue",
    });
    expect(typeof (wrapped.args.request as { requestId: string }).requestId).toBe("string");
  });

  it("builds client-request envelope", () => {
    const msg = buildClientRequest("settings/describe", null);
    expect(msg.type).toBe("client-request");
    expect(msg.method).toBe("settings/describe");
    expect(msg.payload).toEqual({ args: {} });
    expect(msg.rpcId.length).toBeGreaterThan(8);
  });
});
