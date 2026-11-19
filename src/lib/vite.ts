import type {
  DevEnvironment,
  Environment,
  HookHandler,
  Plugin,
  Rollup,
} from "vite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { coded } from "./errors.js";
import { extract } from "./extract.js";
import { csrRoutes } from "./routes.js";

const ISLAND = /\.__island-[\w-]+\.svelte$/u;
const BOOT = "virtual:svelte-islands/boot";
const BOOT_ID = "\0svelte-islands:boot";
const ALIAS = "virtual:svelte-islands/island/";
const ALIAS_ID = "\0svelte-islands:island:";
const SENTINEL = "__svelte_islands_boot__";
const ROUTE_FILE = /[/\\]\+(?:page|layout)[^/\\]*$/u;
const HOOKS = [
  "src/hooks.ts",
  "src/hooks.js",
  "src/hooks/index.ts",
  "src/hooks/index.js",
];

type Context<K extends "buildStart" | "load" | "transform" | "writeBundle"> =
  ThisParameterType<HookHandler<NonNullable<Plugin[K]>>>;

function isRunnable(environment: Environment): environment is DevEnvironment {
  return "transformRequest" in environment;
}

function bootFiles(files: ReadonlyArray<string>) {
  return JSON.stringify(JSON.stringify(files));
}

function withBoot(code: string, files: ReadonlyArray<string>) {
  const replacement = bootFiles(files);
  return code.replaceAll(`"${SENTINEL}"`, () => replacement);
}

function staticImports(bundle: Rollup.OutputBundle, entry: string) {
  const files = [entry];
  for (let index = 0; index < files.length; index += 1) {
    const chunk = bundle[files[index] ?? ""];
    if (chunk?.type !== "chunk") {
      continue;
    }
    for (const imported of chunk.imports) {
      if (!files.includes(imported)) {
        files.push(imported);
      }
    }
  }
  return files;
}

function missing(id: string) {
  const [before = "", after = ""] = coded(
    "islands_missing_code",
    "There's no code for the island %s in this build. The page may come from an older build, so reload it.",
  ).split("%s");
  return `${JSON.stringify(before)} + ${id} + ${JSON.stringify(after)}`;
}

/**
 * The Vite plugin that gives each island its own chunk, so a page's JavaScript
 * holds only the code outside islands, and that boots islands on pages with
 * `csr = false`. Add it next to `sveltekit()`.
 *
 * ```ts
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import { islands } from "svelte-islands/vite";
 * import { defineConfig } from "vite";
 *
 * export default defineConfig({ plugins: [sveltekit(), islands()] });
 * ```
 *
 * @returns The plugins.
 */
export function islands(): Array<Plugin> {
  const modules = new Map<string, string>();
  const pages = new Map<string, string>();
  const bodies = new Map<string, string>();
  const patched = new Set<string>();
  let root = process.cwd();
  let isServe = false;
  let boot: string | null = null;

  function own(id: string) {
    if (modules.has(id)) {
      return id;
    }
    const file = id.startsWith("/@fs/") ? id.slice(4) : path.join(root, id);
    return modules.has(file) ? file : null;
  }

  async function compilePage(
    island: string,
    environment: Environment,
    load: (page: string) => Promise<unknown>,
  ) {
    const page = pages.get(island);
    if (page == null || bodies.has(island)) {
      return;
    }
    if (!isRunnable(environment)) {
      await load(page);
      return;
    }
    const relative = path.relative(root, page);
    await environment.transformRequest(
      relative.startsWith("..") ? `/@fs${page}` : `/${relative}`,
    );
  }

  function bootSource() {
    const hooks = HOOKS.map((file) => path.join(root, file)).find((file) =>
      existsSync(file),
    );
    const lines = [`import { start } from "svelte-islands/shell";`];
    if (hooks != null) {
      lines.push(`import ${JSON.stringify(hooks)};`);
    }
    if (isServe) {
      lines.push(
        `start((id) => import(/* @vite-ignore */ new URL("./__x00__svelte-islands:island:" + id, import.meta.url).href));`,
      );
      return lines.join("\n");
    }
    const entries = Array.from(
      pages.keys(),
      (id) =>
        `${JSON.stringify(id)}: () => import(${JSON.stringify(`${ALIAS}${id}`)})`,
    );
    lines.push(
      `const registry = { ${entries.join(", ")} };`,
      `start((id) => registry[id]?.() ?? Promise.reject(new Error(${missing("id")})));`,
    );
    return lines.join("\n");
  }

  return [
    {
      name: "svelte-islands",
      enforce: "pre",
      sharedDuringBuild: true,
      config(config, { command }) {
        if (command === "serve") {
          return;
        }
        const routes = path.join(config.root ?? process.cwd(), "src/routes");
        return {
          define: { __SVELTE_ISLANDS_CSR__: JSON.stringify(csrRoutes(routes)) },
        };
      },
      configureServer(server) {
        const routes = path.join(server.config.root, "src/routes");
        const refresh = () => {
          Object.assign(globalThis, { __svelteIslandsCsr: csrRoutes(routes) });
        };
        refresh();
        server.watcher.on("all", (_event, file) => {
          if (ROUTE_FILE.test(file)) {
            refresh();
          }
        });
      },
      configResolved(config) {
        root = config.root;
        isServe = config.command === "serve";
        const plugins = config.plugins as Array<Plugin>;
        const own = plugins.findIndex(
          (plugin) => plugin.name === "svelte-islands",
        );
        const [plugin] = own === -1 ? [] : plugins.splice(own, 1);
        if (plugin == null) {
          return;
        }
        const preprocess = plugins.findIndex(
          (each) => each.name === "vite-plugin-svelte:preprocess",
        );
        plugins.splice(preprocess === -1 ? own : preprocess + 1, 0, plugin);
      },
      buildStart(this: Context<"buildStart">) {
        const { config, name } = this.environment;
        if (isServe || name !== "client" || pages.size === 0) {
          return;
        }
        const [output] = [config.build.rolldownOptions.output ?? {}].flat();
        if (output?.codeSplitting === false) {
          this.warn(
            coded(
              "islands_no_code_splitting",
              "The build doesn't split code, so each island's code stays in the main bundle, and islands on pages with csr = false stay as server HTML. Use the default output.bundleStrategy, \"split\".",
            ),
          );
          return;
        }
        boot = this.emitFile({ type: "chunk", id: BOOT, name: "islands" });
      },
      resolveId(id) {
        if (id === BOOT) {
          return BOOT_ID;
        }
        if (id.startsWith(ALIAS)) {
          return `${ALIAS_ID}${id.slice(ALIAS.length)}`;
        }
        return own(id);
      },
      async load(this: Context<"load">, id: string) {
        const [bare = id] = id.split("?", 1);
        if (bare === BOOT_ID) {
          return bootSource();
        }
        if (bare.startsWith(ALIAS_ID)) {
          const island = bare.slice(ALIAS_ID.length);
          await compilePage(island, this.environment, async (page) =>
            this.load({ id: page }),
          );
          const file = bodies.get(island);
          return file == null
            ? `throw new Error(${missing(JSON.stringify(island))});`
            : `export { body, url } from ${JSON.stringify(file)};`;
        }
        const file = own(id);
        return file == null ? null : (modules.get(file) ?? null);
      },
      transform: {
        filter: {
          id: { include: /\.svelte$/u, exclude: [/node_modules/u, ISLAND] },
        },
        handler(this: Context<"transform">, code: string, id: string) {
          const target =
            this.environment.config.consumer === "client" ? "client" : "server";
          const name = path.relative(root, id).split(path.sep).join("/");
          const extracted = extract(code, id, name, target, isServe);
          if (extracted == null) {
            return null;
          }
          if (target === "client") {
            for (const warning of extracted.warnings) {
              this.warn(warning);
            }
          }
          for (const made of extracted.modules) {
            if (target === "server") {
              pages.set(made.id, id);
            } else {
              modules.set(made.file, made.source);
              bodies.set(made.id, made.file);
            }
          }
          return { code: extracted.code, map: extracted.map };
        },
      },
      writeBundle(
        this: Context<"writeBundle">,
        options: Rollup.NormalizedOutputOptions,
        bundle: Rollup.OutputBundle,
      ) {
        const { config, name } = this.environment;
        if (config.consumer !== "client") {
          for (const [file, chunk] of Object.entries(bundle)) {
            if (chunk.type === "chunk" && chunk.code.includes(SENTINEL)) {
              patched.add(path.join(options.dir ?? "", file));
            }
          }
          return;
        }
        if (boot == null || name !== "client") {
          return;
        }
        const files = staticImports(bundle, this.getFileName(boot));
        for (const file of patched) {
          writeFileSync(file, withBoot(readFileSync(file, "utf8"), files));
        }
      },
    },
    {
      name: "svelte-islands:boot",
      apply: "serve",
      transform: {
        filter: { code: SENTINEL },
        handler(this: Context<"transform">, code: string) {
          if (this.environment.config.consumer === "client") {
            return null;
          }
          return withBoot(code, [`@id/__x00__${BOOT_ID.slice(1)}`]);
        },
      },
    },
  ];
}
