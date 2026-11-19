import type { Plugin } from "vite";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { islands } from "#lib/vite.js";

const PAGE = `<script>
  import { Island } from "svelte-islands";

  let { data } = $props();
  let count = $state(0);
</script>

<Island part={data.rows}>
  {#snippet children(rows)}
    <button onclick={() => count++}>{rows.length} rows, pressed {count}</button>
  {/snippet}
</Island>
`;

const made: Array<string> = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "islands-vite-"));
  made.push(dir);
  return dir;
}

function named(plugins: Array<Plugin>, name: string) {
  const found = plugins.find((plugin) => plugin.name === name);
  if (found == null) {
    throw new Error(`no plugin named ${name}`);
  }
  return found;
}

function call(
  plugin: Plugin,
  hook: "configResolved" | "buildStart" | "load" | "transform" | "writeBundle",
  context: object,
  ...args: Array<unknown>
): unknown {
  const found: unknown = plugin[hook];
  const handler =
    typeof found === "function"
      ? found
      : typeof found === "object" && found != null && "handler" in found
        ? found.handler
        : null;
  if (typeof handler !== "function") {
    throw new Error(`the plugin has no ${hook} hook`);
  }
  return Reflect.apply(handler, context, args);
}

function built(root: string) {
  const plugins = islands();
  const main = named(plugins, "svelte-islands");
  call(main, "configResolved", {}, { root, command: "build", plugins: [main] });
  return main;
}

function environment(consumer: "client" | "server", codeSplitting = true) {
  return {
    name: consumer === "client" ? "client" : "ssr",
    config: {
      consumer,
      build: {
        rolldownOptions: {
          output: codeSplitting ? {} : { codeSplitting: false },
        },
      },
    },
  };
}

describe("the Vite plugin", () => {
  it("moves itself to right after Svelte's preprocessor", () => {
    const plugins = islands();
    const main = named(plugins, "svelte-islands");
    const order: Array<Plugin> = [
      { name: "kit" },
      main,
      { name: "vite-plugin-svelte:preprocess" },
      { name: "vite-plugin-svelte:compile" },
    ];
    call(
      main,
      "configResolved",
      {},
      { root: "/app", command: "build", plugins: order },
    );
    expect(order.map((plugin) => plugin.name)).toStrictEqual([
      "kit",
      "vite-plugin-svelte:preprocess",
      "svelte-islands",
      "vite-plugin-svelte:compile",
    ]);
  });

  it("gives each island its own module, and leaves files without islands alone", () => {
    const root = scratch();
    const main = built(root);
    const context = { environment: environment("client"), warn: vi.fn() };
    const page = path.join(root, "src/routes/+page.svelte");
    const result = call(main, "transform", context, PAGE, page);
    expect(result).toMatchObject({ code: expect.stringContaining("module=") });
    expect(context.warn).not.toHaveBeenCalled();
    expect(
      call(
        main,
        "transform",
        context,
        "<p>plain</p>",
        path.join(root, "a.svelte"),
      ),
    ).toBeNull();
  });

  it("writes the boot's files into the server build once the client build knows them", () => {
    const root = scratch();
    const main = built(root);
    const page = path.join(root, "src/routes/+page.svelte");
    call(
      main,
      "transform",
      { environment: environment("server"), warn: vi.fn() },
      PAGE,
      page,
    );
    const client = {
      environment: environment("client"),
      warn: vi.fn(),
      emitFile: vi.fn(() => "boot-ref"),
      getFileName: (ref: string) =>
        ref === "boot-ref" ? "_app/islands.js" : "",
    };
    call(main, "buildStart", client);
    expect(client.emitFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chunk", name: "islands" }),
    );
    const output = path.join(root, "output/server");
    mkdirSync(path.join(output, "chunks"), { recursive: true });
    const server = path.join(output, "chunks/server.js");
    writeFileSync(server, `const BOOT = "__svelte_islands_boot__";\n`);
    call(
      main,
      "writeBundle",
      { environment: environment("server") },
      { dir: output },
      {
        "chunks/server.js": {
          type: "chunk",
          code: readFileSync(server, "utf8"),
          imports: [],
        },
      },
    );
    call(
      main,
      "writeBundle",
      client,
      { dir: path.join(root, "output/client") },
      {
        "_app/islands.js": { type: "chunk", imports: ["_app/shared.js"] },
        "_app/shared.js": { type: "chunk", imports: [] },
      },
    );
    expect(readFileSync(server, "utf8")).toBe(
      `const BOOT = ${JSON.stringify(JSON.stringify(["_app/islands.js", "_app/shared.js"]))};\n`,
    );
  });

  it("warns, and emits no boot, when the client build doesn't split code", () => {
    const root = scratch();
    const main = built(root);
    call(
      main,
      "transform",
      { environment: environment("server"), warn: vi.fn() },
      PAGE,
      path.join(root, "src/routes/+page.svelte"),
    );
    const client = {
      environment: environment("client", false),
      warn: vi.fn(),
      emitFile: vi.fn(),
    };
    call(main, "buildStart", client);
    expect(client.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^islands_no_code_splitting\n/u),
    );
    expect(client.emitFile).not.toHaveBeenCalled();
  });

  it("answers an island it has no code for with a coded error", async () => {
    const main = built(scratch());
    const code = await call(
      main,
      "load",
      { environment: environment("client"), load: vi.fn() },
      "\0svelte-islands:island:unknown",
    );
    expect(code).toContain("islands_missing_code");
    expect(code).toContain('"unknown"');
  });
});
