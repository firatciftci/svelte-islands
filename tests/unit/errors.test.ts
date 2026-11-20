import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coded, CODES, ERRORS } from "#lib/errors.js";

const LIBRARY = "src/lib";

describe("error codes", () => {
  it("lead each message and link to their section", () => {
    expect(coded("islands_part_failed", "Couldn't load it.")).toBe(
      `islands_part_failed\nCouldn't load it.\n${ERRORS}#islands_part_failed`,
    );
  });

  it("each have a section on the errors page, in the same order", () => {
    const page = readFileSync("docs/70-appendix/25-errors.md", "utf8");
    const headings = page
      .matchAll(/^## `(\w+)`$/gmu)
      .map(([, code]) => code)
      .toArray();
    expect(headings).toStrictEqual([...CODES]);
  });

  it("are each used by the library", () => {
    const source = readdirSync(LIBRARY)
      .filter((file) => file !== "errors.ts")
      .map((file) => readFileSync(path.join(LIBRARY, file), "utf8"))
      .join("\n");
    expect(CODES.filter((code) => !source.includes(`"${code}"`))).toStrictEqual(
      [],
    );
  });
});
