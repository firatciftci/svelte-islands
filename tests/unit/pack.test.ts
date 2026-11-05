import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isPackable, pack, unpack } from "#lib/pack.js";

const number = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .filter((value) => !Object.is(value, -0));

const cell = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.boolean(),
  fc.integer(),
  number,
  fc.string(),
);

const { tree } = fc.letrec<{ tree: unknown }>((tie) => ({
  tree: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    cell,
    fc.array(tie("tree"), { maxLength: 12 }),
    fc.dictionary(fc.string(), tie("tree"), {
      maxKeys: 6,
      noNullPrototype: true,
    }),
  ),
}));

const keys = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
  minLength: 1,
  maxLength: 6,
});

const table = keys.chain((names) =>
  fc.array(
    fc.record(Object.fromEntries(names.map((name) => [name, cell])), {
      noNullPrototype: true,
    }),
    { minLength: 2, maxLength: 40 },
  ),
);

const sequence = fc
  .array(fc.integer({ min: 1, max: 5 }), { minLength: 8, maxLength: 200 })
  .map((steps) => {
    let at = -3;
    return steps.map((step) => {
      at += step === 5 ? 40 : 1;
      return at;
    });
  });

const mostlyOne = fc
  .tuple(cell, fc.array(cell, { maxLength: 6 }))
  .chain(([fill, others]) =>
    fc
      .array(fc.integer({ min: 0, max: 40 }), { minLength: 8, maxLength: 120 })
      .map((spots) =>
        spots.map((spot) => (spot < others.length ? others[spot] : fill)),
      ),
  );

const holey = fc.array(fc.option(fc.integer(), { freq: 2, nil: null }), {
  minLength: 8,
  maxLength: 120,
});

const fewStrings = fc.array(
  fc.constantFrom("Labour", "Conservative", "Green", ""),
  { minLength: 8, maxLength: 200 },
);

const nestedLists = fc.array(
  fc.oneof(
    fc.array(fc.integer(), { maxLength: 6 }),
    fc.constant(null),
    fc.constant(undefined),
  ),
  { minLength: 2, maxLength: 40 },
);

function roundTrip(value: unknown) {
  if (!isPackable(value)) {
    throw new Error("expected a packable value");
  }
  return unpack(JSON.parse(JSON.stringify(pack(value))));
}

describe("pack", () => {
  it.each([
    ["any tree", tree],
    ["tables", table],
    ["rising integers", sequence],
    ["repeated values", mostlyOne],
    ["nulls among numbers", holey],
    ["few distinct strings", fewStrings],
    ["lists of lists", nestedLists],
    [
      "tables inside tables",
      fc.array(
        fc.record({ rows: table, name: cell }, { noNullPrototype: true }),
      ),
    ],
  ])("round-trips %s", (_, generated) => {
    fc.assert(
      fc.property(generated, (value) => {
        expect(roundTrip(value)).toStrictEqual(value);
      }),
      { numRuns: 500 },
    );
  });

  it.each([
    ["an object", '{"__proto__":{"polluted":true},"a":1}'],
    [
      "table rows",
      '[{"__proto__":{"polluted":true},"a":1},{"__proto__":{"polluted":true},"a":2}]',
    ],
  ])("keeps a __proto__ key in %s as plain data", (_, source) => {
    const value: unknown = JSON.parse(source);
    const decoded: unknown = unpack(pack(value as never));
    expect(JSON.stringify(decoded)).toBe(source);
    const first: unknown = Array.isArray(decoded) ? decoded[0] : decoded;
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(Object.keys(first as object)).toContain("__proto__");
  });

  it("gives objects from a dictionary their own copies", () => {
    const shared = { a: 1 };
    const rows = Array.from({ length: 20 }, () => shared);
    const unpacked = roundTrip(rows) as Array<typeof shared>;
    expect(unpacked).toStrictEqual(rows);
    expect(unpacked[0]).not.toBe(unpacked[1]);
  });

  it("makes large tables smaller than JSON", () => {
    const rows = Array.from({ length: 500 }, (_, at) => ({
      id: at,
      party: at % 2 === 0 ? "Labour" : "Conservative",
      votes: at * 7,
      note: null,
    }));
    const size = (value: unknown) => JSON.stringify(value).length;
    expect(size(pack(rows))).toBeLessThan(size(rows) / 2);
  });

  it.each([
    ["NaN", NaN],
    ["infinity", Infinity],
    ["negative zero", -0],
    ["a date", new Date(0)],
    ["a map", new Map()],
    ["a set", new Set()],
    ["a bigint", 1n],
    ["a class instance", new (class Thing {})()],
    ["an array with a hole", [1, , 3]],
    ["a symbol key", { [Symbol("x")]: 1 }],
    ["a date inside a list", [{ at: new Date(0) }]],
  ])("refuses %s, which devalue then carries", (_, value) => {
    expect(isPackable(value)).toBe(false);
  });

  it("refuses a cycle and keeps a repeated flat object", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(isPackable(cycle)).toBe(false);
    const flat = { a: 1 };
    expect(isPackable([flat, flat])).toBe(true);
  });
});
