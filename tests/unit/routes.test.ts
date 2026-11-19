import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { csrRoutes } from "#lib/routes.js";

const made: Array<string> = [];

function routes(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "islands-routes-"));
  made.push(root);
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return csrRoutes(root);
}

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("csrRoutes", () => {
  it("runs SvelteKit's client unless a route turns it off", () => {
    expect(
      routes({
        "+page.svelte": "",
        "about/+page.svelte": "",
        "about/+page.server.ts": "export const csr = false;",
      }),
    ).toStrictEqual({ "/": true, "/about": false });
  });

  it("lets a universal file win over a server file", () => {
    expect(
      routes({
        "+page.svelte": "",
        "+page.ts": "export const csr = true;",
        "+page.server.ts": "export const csr = false;",
      }),
    ).toStrictEqual({ "/": true });
  });

  it("inherits from layouts, and lets the deepest node win", () => {
    expect(
      routes({
        "(docs)/+layout.ts": "export const csr = false;",
        "(docs)/guide/+page.svelte": "",
        "(docs)/live/+page.svelte": "",
        "(docs)/live/+page.ts": "export const csr = true;",
        "+page.svelte": "",
        "+page.server.ts": "export const csr = false;",
        "child/+page.svelte": "",
      }),
    ).toStrictEqual({
      "/": false,
      "/(docs)/guide": false,
      "/(docs)/live": true,
      "/child": true,
    });
  });

  it("leaves a route to the HTML when it can't read the value", () => {
    expect(
      routes({
        "+page.svelte": "",
        "+page.ts": "export const csr = process.env.CSR === '1';",
        "reset/+page@.svelte": "",
        "typed/+page.svelte": "",
        "typed/+page.ts": "export const csr: boolean = false;",
      }),
    ).toStrictEqual({ "/": null, "/reset": null, "/typed": false });
  });
});
