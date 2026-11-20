import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { baseOf, handle, run, transport } from "#lib/init.js";

const ARROW = `export const handle = async ({ event, resolve }) => resolve(event);\n`;

function isValid(code: string) {
  const { diagnostics = [] } = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext },
  });
  return diagnostics.length === 0;
}

function exportsOnce(code: string, name: string) {
  const declared = code.match(
    new RegExp(
      String.raw`export\s+(?:const|(?:async\s+)?function)\s+${name}\b`,
      "gu",
    ),
  );
  const listed = code.match(new RegExp(String.raw`\bas\s+${name}\b`, "gu"));
  return (declared?.length ?? 0) + (listed?.length ?? 0) === 1;
}

const HOOKS: Record<string, [text: string | null, store?: "redis" | "r2"]> = {
  "a missing file": [null],
  "an empty file": [""],
  "an arrow function": [ARROW],
  "a typed const": [
    `import type { Handle } from "@sveltejs/kit";\n\nexport const handle: Handle = async ({ event, resolve }) => resolve(event);\n`,
  ],
  "an async function": [
    `export async function handle({ event, resolve }) {\n  return resolve(event);\n}\n`,
  ],
  "a plain function": [
    `export function handle({ event, resolve }) {\n  return resolve(event);\n}\n`,
  ],
  "an existing sequence": [
    `import { sequence } from '@sveltejs/kit/hooks';\nimport { auth, i18n } from "$lib/server/hooks";\n\nexport const handle = sequence(auth, i18n);\n`,
  ],
  "a local handle in an export list": [
    `const handle = async ({ event, resolve }) => resolve(event);\n\nexport { handle };\n`,
  ],
  "a renamed handle in an export list": [
    `import { auth } from "$lib/server/auth";\n\nexport const handleError = () => {};\nexport { auth as handle };\n`,
  ],
  "other hooks but no handle": [
    `export const handleError = ({ error }) => console.error(error);\n`,
  ],
  "a name the rename would take": [
    `import { createApp } from "$lib/server/app";\n\nconst app = createApp();\n\nexport const handle = async ({ event, resolve }) => app.run(event, resolve);\n`,
  ],
  "a Redis store and an existing handle": [ARROW, "redis"],
  "an R2 store in a new file": [null, "r2"],
};

describe("init's handle", () => {
  for (const [shape, [text, store]] of Object.entries(HOOKS)) {
    it(`handles ${shape}`, () => {
      const after = handle(text, store) ?? "";
      expect(isValid(after)).toBe(true);
      expect(exportsOnce(after, "handle")).toBe(true);
      expect(after).toMatchSnapshot();
      expect(handle(after, store)).toBeNull();
    });
  }
});

describe("init's transport", () => {
  const SHAPES: Record<string, [text: string | null, prefix: string | null]> = {
    "a missing file": [null, null],
    "a missing file under a base path": [null, "/docs/_parts/"],
    "an app's own transport under a base path": [
      `export const transport = {\n  Vector: { encode: () => false, decode: () => null },\n};\n`,
      "/docs/_parts/",
    ],
    "a transport in an export list": [
      `const transport = {};\n\nexport { transport };\n`,
      null,
    ],
    "a name the rename would take": [
      `import { codecs } from "$lib/codecs";\n\nexport const transport = codecs;\n`,
      null,
    ],
  };
  for (const [shape, [text, prefix]] of Object.entries(SHAPES)) {
    it(`handles ${shape}`, () => {
      const after = transport(text, prefix) ?? "";
      expect(isValid(after)).toBe(true);
      expect(exportsOnce(after, "transport")).toBe(true);
      expect(after).toMatchSnapshot();
    });
  }
});

describe("init's base path", () => {
  it("reads a literal base from the Vite or Svelte config", () => {
    expect(
      baseOf([null, `sveltekit({ paths: { base: "/docs/" } })`]),
    ).toStrictEqual({ base: "/docs", isUnread: false });
    expect(baseOf([`export default {};`])).toStrictEqual({
      base: null,
      isUnread: false,
    });
  });

  it("says so when the base isn't a plain string", () => {
    expect(
      baseOf([`sveltekit({ paths: { base: process.env.BASE_PATH } })`]),
    ).toStrictEqual({ base: null, isUnread: true });
  });
});

describe("init in an app", () => {
  it("writes the base path's prefix and the store it's asked for", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "islands-init-"));
    try {
      await writeFile(path.join(root, "package.json"), "{}");
      await writeFile(
        path.join(root, "vite.config.js"),
        `import { sveltekit } from "@sveltejs/kit/vite";\n\nexport default { plugins: [sveltekit({ paths: { base: "/docs" } })] };\n`,
      );
      const lines: Array<string> = [];
      const io = {
        out: (line: string) => {
          lines.push(line);
        },
        err: () => {},
      };
      expect(await run([root, "--store", "r2"], io)).toBe(0);
      expect(await readFile(path.join(root, "src/hooks.js"), "utf8")).toContain(
        'islands({ prefix: "/docs/_parts/" })',
      );
      expect(
        await readFile(path.join(root, "src/hooks.server.js"), "utf8"),
      ).toContain("r2Store(() => env.PARTS)");
      expect(lines.at(-1)).toContain("bound as PARTS");
      expect(await run([root, "--store", "s3"], io)).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
