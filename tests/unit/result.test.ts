import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, map, mapErr, andThen, unwrapOr } from "../../src/shared/result.js";

describe("Result", () => {
  it("ok() constructs a success", () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err() constructs a failure", () => {
    const r = err("boom");
    expect(isErr(r)).toBe(true);
    if (!r.ok) expect(r.error).toBe("boom");
  });

  it("map transforms ok value, passes through err", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(map(err<string>("x"), (n: number) => n * 3)).toEqual({ ok: false, error: "x" });
  });

  it("mapErr transforms err, passes through ok", () => {
    expect(mapErr(err("e"), (s) => `wrapped:${s}`)).toEqual({ ok: false, error: "wrapped:e" });
    expect(mapErr(ok(1), (s: string) => s.toUpperCase())).toEqual({ ok: true, value: 1 });
  });

  it("andThen chains", () => {
    const div = (n: number): ReturnType<typeof ok<number>> | ReturnType<typeof err<string>> =>
      n === 0 ? err("div0") : ok(10 / n);
    expect(andThen(ok(2), div)).toEqual({ ok: true, value: 5 });
    expect(andThen(ok(0), div)).toEqual({ ok: false, error: "div0" });
  });

  it("unwrapOr returns fallback on err", () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err<string>("x"), 99)).toBe(99);
  });
});
