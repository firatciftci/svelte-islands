import fc from "fast-check";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { isPackable, pack } from "#lib/pack.js";
import { deserialize, islands, Part, serialize, usePacker } from "#lib/part.js";
import { outline, skeletonize } from "#lib/skeleton.js";

const RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const SECRET = "zq9secret";

usePacker((value, claims) =>
  isPackable(value, claims) ? JSON.stringify(pack(value)) : null,
);
islands();

const leaf = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: false }),
  fc.string(),
  fc.bigInt(),
  fc.date({ noInvalidDate: true }),
);

const { value } = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    leaf,
    fc.array(tie("value"), { maxLength: 8 }),
    fc.dictionary(fc.string({ maxLength: 6 }), tie("value"), { maxKeys: 6 }),
    fc
      .array(fc.tuple(fc.string({ maxLength: 4 }), tie("value")), {
        maxLength: 4,
      })
      .map((entries) => new Map(entries)),
    fc.array(fc.integer(), { maxLength: 6 }).map((items) => new Set(items)),
    fc
      .record({ id: fc.integer(), name: fc.string(), score: fc.double() })
      .chain((row) =>
        fc.array(fc.constant(row), { minLength: 4, maxLength: 20 }),
      ),
  ),
}));

const parted = value.map(
  (inner) =>
    new Part({
      name: "nested",
      hash: "nested-hash",
      source: "/",
      bytes: 10,
      loaded: { value: inner },
    }),
);

describe("serialize", () => {
  it("brings back every value it carries", () => {
    fc.assert(
      fc.property(value, (input) => {
        expect(deserialize(serialize(input))).toStrictEqual(input);
      }),
      { numRuns: RUNS },
    );
  });

  it("carries parts inside other values", () => {
    fc.assert(
      fc.property(parted, value, (part, around) => {
        const copy = deserialize(serialize({ part, around })) as {
          part: Part;
          around: unknown;
        };
        expect(copy.part).toBeInstanceOf(Part);
        expect(copy.part.hash).toBe(part.hash);
        expect(copy.around).toStrictEqual(around);
      }),
      { numRuns: RUNS },
    );
  });
});

const TAGS = [
  "div",
  "section",
  "p",
  "span",
  "ul",
  "li",
  "table",
  "tr",
  "td",
  "b",
  "a",
];
const HEADINGS = ["h1", "h2", "h3"];

const attribute = fc.oneof(
  fc.constant(` title="${SECRET}"`),
  fc.constant(` class="box"`),
  fc.constant(` style="inline-size:40%;background:url(/${SECRET}.png)"`),
  fc.constant(` data-user="${SECRET}"`),
  fc.constant(` aria-label="${SECRET}"`),
  fc.constant(` aria-label="Landmark"`),
  fc.constant(""),
);

const { html } = fc.letrec<{ html: string }>((tie) => ({
  html: fc.oneof(
    { depthSize: "small" },
    fc.constant(SECRET),
    fc.constant(`<!-- ${SECRET} -->`),
    fc.constant(`<img src="/${SECRET}.png" alt="${SECRET}">`),
    fc
      .tuple(
        fc.constantFrom(...TAGS),
        attribute,
        fc.array(tie("html"), { maxLength: 5 }),
      )
      .map(
        ([tag, extra, inner]) => `<${tag}${extra}>${inner.join("")}</${tag}>`,
      ),
    fc
      .tuple(
        fc.constantFrom(...HEADINGS),
        fc.stringMatching(/^[A-Za-z ]{1,12}$/u),
      )
      .map(([tag, words]) => `<${tag}>${words}</${tag}>`),
    fc.string({ maxLength: 20 }),
  ),
}));

describe("skeletonize", () => {
  it("never carries text or attribute values, and stays within its budget", () => {
    fc.assert(
      fc.property(html, (markup) => {
        const shaped = skeletonize(markup) ?? "";
        expect(shaped).not.toContain(SECRET);
        expect(shaped.length).toBeLessThanOrEqual(24 * 1024);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("outline", () => {
  it("keeps only headings and landmark names", () => {
    fc.assert(
      fc.property(html, (markup) => {
        const found = outline(markup.replaceAll(`aria-label="${SECRET}"`, ""));
        expect(found).not.toContain(SECRET);
        if (found !== "") {
          expect(found).toMatch(/^<div class="island-outline">/u);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
