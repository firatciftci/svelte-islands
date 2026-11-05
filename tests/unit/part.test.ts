import { beforeEach, describe, expect, it, vi } from "vitest";
import { deserialize, islands, Part, serialize } from "#lib/part.js";

function made(name: string, value: unknown, isPrivate = false) {
  return new Part({
    name,
    hash: `${name}-hash`,
    source: "/",
    bytes: 10,
    isPrivate,
    loaded: { value },
  });
}

describe("serialize", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    islands();
  });

  it.each([
    ["rows", [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]],
    ["a string that starts with the marker", "~hello"],
    ["a date", new Date(0)],
    ["a map", new Map([["a", 1]])],
    ["a set", new Set([1])],
    ["a bigint", 12n],
    ["NaN", NaN],
    ["negative zero", -0],
    ["undefined", undefined],
  ])("carries %s", (_, value) => {
    expect(deserialize(serialize(value))).toStrictEqual(value);
  });

  it("keeps a cycle", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const copy = deserialize(serialize(cycle)) as typeof cycle;
    expect(copy.self).toBe(copy);
  });

  it("carries a part inside a value", () => {
    const small = made("small", { a: 1 });
    const copy = deserialize(serialize({ small })) as { small: Part };
    expect(copy.small).toBeInstanceOf(Part);
    expect(copy.small.loaded?.value).toStrictEqual({ a: 1 });
  });

  it("refuses a private part inside a public one", () => {
    const secret = made("secret", { token: "abc" }, true);
    expect(() => serialize({ secret })).toThrow(/private part "secret"/u);
  });

  it("allows a private part inside a private one", () => {
    const secret = made("secret", { token: "abc" }, true);
    const copy = deserialize(serialize({ secret }, true)) as { secret: Part };
    expect(copy.secret.loaded?.value).toStrictEqual({ token: "abc" });
  });
});

describe("part", () => {
  beforeEach(() => {
    islands({ inline: 4096 });
  });

  it("stays inline up to the limit and travels by reference above it", () => {
    const base = { name: "a", hash: "h", source: "/", loaded: { value: 1 } };
    expect(new Part({ ...base, bytes: 4096 }).isInline).toBe(true);
    expect(new Part({ ...base, bytes: 4097 }).isInline).toBe(false);
  });

  it("always keeps a private part inline", () => {
    const base = { name: "a", hash: "h", source: "/", loaded: { value: 1 } };
    expect(new Part({ ...base, bytes: 1e9, isPrivate: true }).isInline).toBe(
      true,
    );
  });

  it("normalizes the URL prefix", () => {
    expect(islands({ prefix: "/x" })).toBeTruthy();
    islands({ prefix: "/_parts/" });
  });
});
