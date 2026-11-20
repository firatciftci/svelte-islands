import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handle, run as init, layout, transport, vite } from "#lib/init.js";
import {
  inspect,
  run as runInspect,
  describe as summary,
} from "#lib/inspect.js";
import { Part, serialize } from "#lib/part.js";

function output() {
  const lines = { out: [] as Array<string>, err: [] as Array<string> };
  return {
    lines,
    io: {
      out: (line: string) => {
        lines.out.push(line);
      },
      err: (line: string) => {
        lines.err.push(line);
      },
    },
  };
}

const PAGE = `<!doctype html><html><head></head><body>
<div class="island" data-island="aaaaaaaaaaaaaaaaaaaaaa" data-island-state="static" data-island-needs="[[&quot;bbbbbbbbbbbbbbbbbbbbbb&quot;,&quot;/&quot;,10]]"><p>rows</p></div>
<div class="island" data-island="cccccccccccccccccccccc" data-island-name="comments" aria-busy="true"><div class="island-shell"></div></div>
<script>__sveltekit_x = { base: "" };</script>
</body></html>`;

function site(pages: Record<string, string>) {
  return async (url: string) => {
    const found = pages[new URL(url).pathname];
    return found == null
      ? new Response(null, { status: 404 })
      : new Response(found);
  };
}

describe("inspect", () => {
  it("lists each island with its state, its part, and where its code lives", async () => {
    const found = await inspect(
      "https://site.test/page",
      "/_parts/",
      site({
        "/page": PAGE,
        "/_parts/aaaaaaaaaaaaaaaaaaaaaa.json": "x".repeat(2048),
      }),
    );
    expect(found.client).toBe("sveltekit");
    expect(found.islands).toHaveLength(2);
    expect(found.islands[0]).toMatchObject({
      hash: "aaaaaaaaaaaaaaaaaaaaaa",
      state: "static",
      needs: 1,
      module: null,
      part: { raw: 2048 },
    });
    expect(found.islands[1]).toMatchObject({
      name: "comments",
      state: null,
      part: null,
    });
    const text = summary(found);
    expect(text).toContain("2 islands");
    expect(text).toContain("SvelteKit hydrates the page");
    expect(text).toContain("server HTML, part 2 KiB");
    expect(text).toContain(
      "comments, rendered with the page, part in the page",
    );
  });

  it("reads what the island boot sends on a page with csr = false", async () => {
    const part = new Part({
      name: "profile",
      hash: "dddddddddddddddddddddd",
      source: "/",
      bytes: 10,
      loaded: { value: { n: 1 } },
      isPrivate: true,
    });
    const data = serialize(
      {
        scopes: [{ count: 1 }],
        islands: [
          {
            part,
            key: "profile",
            state: "static",
            file: null,
            needs: null,
            module: "m1",
            hydrate: ["idle", "interaction"],
            reveal: "visible",
            margin: null,
            media: null,
            prefetch: true,
            scope: { at: 0, names: ["count"], own: { label: "a" } },
            context: [[true, "tone", "warm"]],
          },
        ],
      },
      true,
    );
    const html = `<head><script type="speculationrules">{"prerender":[]}</script></head><body><div data-island="dddddddddddddddddddddd" data-island-module="m1" data-island-state="static" data-island-why="it reads count, which can change"></div><div data-island="eeeeeeeeeeeeeeeeeeeeee" data-island-module="m2" data-island-state="static" data-island-why="inferred"></div><script type="application/json" id="svelte-islands">${data}</script></body>`;
    const found = await inspect(
      "https://site.test/",
      "/_parts/",
      site({ "/": html }),
    );
    expect(found.client).toBe("islands");
    expect(found.speculation).toBe("prerender");
    expect(found.islands[0]).toMatchObject({
      name: "profile",
      module: "m1",
      hydrate: ["idle", "interaction"],
      scope: ["count", "label"],
      context: ['Symbol.for("tone")'],
    });
    expect(summary(found)).toContain(
      "hydrates on idle or interaction, gets count, label",
    );
    expect(summary(found)).toContain(
      "code in its own chunk, not sent by the boot, so it stays as server HTML",
    );
    expect(summary(found)).toContain(
      "hydrates because it reads count, which can change",
    );
    expect(summary(found)).toContain(
      "never hydrates, because nothing in it can change",
    );
  });

  it("prints JSON for scripts and fails cleanly on a bad page", async () => {
    const good = output();
    expect(
      await runInspect(
        ["https://site.test/page", "--json"],
        good.io,
        site({ "/page": PAGE }),
      ),
    ).toBe(0);
    expect(JSON.parse(good.lines.out.join("\n"))).toMatchObject({
      client: "sveltekit",
    });
    const bad = output();
    expect(await runInspect(["https://site.test/gone"], bad.io, site({}))).toBe(
      1,
    );
    expect(bad.lines.err[0]).toContain("HTTP 404");
    expect(await runInspect([], output().io, site({}))).toBe(2);
  });
});

describe("init", () => {
  it("creates hooks with the transport and the handle", () => {
    expect(transport(null)).toContain("export const transport = islands();");
    expect(handle(null)).toContain("export const handle = islands();");
  });

  it("keeps an app's own transport as codecs", () => {
    const after =
      transport(
        `import { Vector } from "$lib/vector";\n\nexport const transport = {\n  Vector: { encode: () => false, decode: () => null },\n};\n`,
      ) ?? "";
    expect(after).toContain(
      'import { Vector } from "$lib/vector";\nimport { islands } from "svelte-islands";',
    );
    expect(after).toContain("const codecs = {");
    expect(after).toContain("export const transport = islands({ codecs });");
  });

  it("puts an app's own handle in a sequence after the islands handle", () => {
    const after =
      handle(
        `export async function handle({ event, resolve }) {\n  return resolve(event);\n}\n`,
      ) ?? "";
    expect(after).toContain('import { sequence } from "@sveltejs/kit/hooks";');
    expect(after).toContain("async function app({ event, resolve })");
    expect(after).toContain("export const handle = sequence(islands(), app);");
    expect(handle(after)).toBeNull();
  });

  it("adds the plugin after sveltekit(), even with options inside", () => {
    const after =
      vite(
        `import { sveltekit } from "@sveltejs/kit/vite";\nimport { defineConfig } from "vite";\n\nexport default defineConfig({\n  plugins: [sveltekit({ adapter: node() })],\n});\n`,
      ) ?? "";
    expect(after).toContain(
      "plugins: [sveltekit({ adapter: node() }), islands()]",
    );
    expect(after).toContain('import { islands } from "svelte-islands/vite";');
    expect(vite(after)).toBeNull();
    expect(() => vite("export default {};")).toThrow(/sveltekit\(\)/u);
  });

  it("isn't thrown off by parentheses in strings and comments", () => {
    const config = `import { sveltekit } from "@sveltejs/kit/vite";\n// see :)\nexport default {\n  plugins: [sveltekit({ kit: { files: { lib: "src/(lib" } } }) /* ) */],\n};\n`;
    expect(vite(config)).toContain(
      'plugins: [sveltekit({ kit: { files: { lib: "src/(lib" } } }), islands() /* ) */]',
    );
    expect(() => vite(`${config}// islands() is commented out\n`)).not.toThrow();
  });

  it("leaves a config alone that calls a foreign islands()", () => {
    expect(() =>
      vite(
        `import { sveltekit } from "@sveltejs/kit/vite";\nimport { islands } from "./islands.js";\nexport default { plugins: [sveltekit(), islands()] };\n`,
      ),
    ).toThrow(/already calls islands\(\)/u);
  });

  it("imports the stylesheet in the root layout", () => {
    expect(
      layout(
        `<script lang="ts">\n  const { children } = $props();\n</script>\n`,
      ),
    ).toContain(`<script lang="ts">\n  import "svelte-islands/styles.css";`);
    expect(layout(null)).toContain("{@render children()}");
    expect(layout(`<p>hi</p>`)).toMatch(
      /^<script>\n {2}import "svelte-islands\/styles\.css";\n<\/script>/u,
    );
  });

  describe("in an app", () => {
    let root = "";

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "islands-init-"));
      await mkdir(join(root, "src/routes"), { recursive: true });
      await writeFile(join(root, "package.json"), "{}");
      await writeFile(join(root, "tsconfig.json"), "{}");
      await writeFile(
        join(root, "vite.config.ts"),
        `import { sveltekit } from "@sveltejs/kit/vite";\nexport default { plugins: [sveltekit()] };\n`,
      );
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("sets everything up once and changes nothing the second time", async () => {
      const first = output();
      expect(await init([root], first.io)).toBe(0);
      expect(first.lines.out).toStrictEqual([
        "created: src/hooks.ts",
        "created: src/hooks.server.ts",
        "created: src/routes/+layout.svelte",
        "updated: vite.config.ts",
      ]);
      expect(existsSync(join(root, "src/hooks.ts"))).toBe(true);
      expect(await readFile(join(root, "vite.config.ts"), "utf8")).toContain(
        "sveltekit(), islands()",
      );
      const second = output();
      expect(await init([root], second.io)).toBe(0);
      expect(
        second.lines.out.every((line) => line.startsWith("unchanged")),
      ).toBe(true);
    });

    it("creates missing folders and says when there's no Vite config", async () => {
      await rm(join(root, "src"), { recursive: true });
      await rm(join(root, "vite.config.ts"));
      const lines = output();
      expect(await init([root], lines.io)).toBe(1);
      expect(existsSync(join(root, "src/routes/+layout.svelte"))).toBe(true);
      expect(lines.lines.err.join("\n")).toContain(
        "skipped: vite.config.ts: there's no Vite config",
      );
    });

    it("refuses a folder without a package.json", async () => {
      const lines = output();
      expect(await init([join(root, "src")], lines.io)).toBe(2);
    });
  });
});
