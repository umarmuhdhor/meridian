import { describe, it, expect } from "vitest";
import {
  createSageDeciderHttp,
  SageTransportError,
  type FetchLike,
} from "../../src/adapters/llm/sage-decider-http.js";

const okJson = (content: string): Awaited<ReturnType<FetchLike>> => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => "",
});

const input = {
  systemPrompt: "sys",
  goal: "pick a pool",
  sessionKey: "meridian-trading",
  cycleId: "screen-x",
  timeoutMs: 1000,
};

describe("createSageDeciderHttp", () => {
  it("returns trimmed content on success", async () => {
    const fetchImpl: FetchLike = async () => okJson("  deployed 0.5 SOL into GOOD/SOL  ");
    const sage = createSageDeciderHttp({ baseUrl: "http://x:8642", apiKey: "k", fetchImpl });
    const r = await sage.decide(input);
    expect(r.text).toBe("deployed 0.5 SOL into GOOD/SOL");
  });

  it("sends session key + auth headers to /v1/chat/completions", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return okJson("ok");
    };
    const sage = createSageDeciderHttp({ baseUrl: "http://x:8642/", apiKey: "secret", fetchImpl });
    await sage.decide(input);
    expect(seenUrl).toBe("http://x:8642/v1/chat/completions"); // trailing slash trimmed
    expect(seenHeaders.Authorization).toBe("Bearer secret");
    expect(seenHeaders["X-Hermes-Session-Key"]).toBe("meridian-trading");
  });

  it("sends CF Access service-token headers when configured", async () => {
    let seen: Record<string, string> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      seen = init.headers;
      return okJson("ok");
    };
    const sage = createSageDeciderHttp({
      baseUrl: "http://x:8642", apiKey: "k", fetchImpl,
      cfAccessClientId: "cid.access", cfAccessClientSecret: "csecret",
    });
    await sage.decide(input);
    expect(seen["CF-Access-Client-Id"]).toBe("cid.access");
    expect(seen["CF-Access-Client-Secret"]).toBe("csecret");
  });

  it("omits CF Access headers when not configured", async () => {
    let seen: Record<string, string> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      seen = init.headers;
      return okJson("ok");
    };
    const sage = createSageDeciderHttp({ baseUrl: "http://x:8642", apiKey: "k", fetchImpl });
    await sage.decide(input);
    expect(seen["CF-Access-Client-Id"]).toBeUndefined();
  });

  it("includes cycle_id in the user message", async () => {
    let body: unknown;
    const fetchImpl: FetchLike = async (_url, init) => {
      body = JSON.parse(init.body);
      return okJson("ok");
    };
    const sage = createSageDeciderHttp({ baseUrl: "http://x:8642", apiKey: "k", fetchImpl });
    await sage.decide(input);
    const messages = (body as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages[1]?.content).toContain("cycle_id: screen-x");
  });

  it("throws SageTransportError on non-ok status", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
      text: async () => "bad gateway",
    });
    const sage = createSageDeciderHttp({ baseUrl: "http://x:8642", apiKey: "k", fetchImpl });
    await expect(sage.decide(input)).rejects.toBeInstanceOf(SageTransportError);
  });

  it("throws SageTransportError on network failure", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const sage = createSageDeciderHttp({ baseUrl: "http://x:8642", apiKey: "k", fetchImpl });
    await expect(sage.decide(input)).rejects.toBeInstanceOf(SageTransportError);
  });

  it("throws SageTransportError on timeout (abort)", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    const sage = createSageDeciderHttp({ baseUrl: "http://x:8642", apiKey: "k", fetchImpl });
    await expect(sage.decide({ ...input, timeoutMs: 20 })).rejects.toBeInstanceOf(SageTransportError);
  });
});
