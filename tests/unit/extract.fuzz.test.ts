import type { Component } from "svelte";
import fc from "fast-check";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extract } from "#lib/extract.js";

const RUNS = Number(process.env.FUZZ_RUNS ?? 150);

const SCRIPT = `<script>
  import { Island } from "svelte-islands";
  import Child from "./Child.svelte";
  import { twice } from "./helpers.js";
  let { data } = $props();
  let count = $state(2);
  let label = $state("ok");
  let text = $state("typed");
  const list = [1, 2, 3];
  const word = "hi";
  function shout(value) { return String(value).toUpperCase(); }
</script>
`;

const PAGE_NAMES = ["count", "label", "list", "word", "data"];

const SELECTORS = [
  "h1",
  "div",
  "span",
  "b",
  "i",
  "em",
  "input",
  ".on",
  ".child",
  ".missing",
  "[title]",
  "[count]",
  "div b",
  "h1 + div",
  "div:has(em)",
  ":global(.on)",
  ":global(div) span",
  ":root",
  "div :global { span { color: blue; } }",
  "@media (width > 1px) { h1 { color: blue; } }",
  "div { & > span { color: blue; } }",
];

const ISLAND = `<script>
  import { registry } from "./registry.js";
  let { part, children, module, scope, hydrate } = $props();
  const body = module != null && registry[module] != null ? registry[module] : children;
  globalThis.fuzzHydrate?.push(hydrate ?? null);
</script>
<x-island>{@render body(part, scope)}</x-island>
`;

const CHILD = `<script>
  let { value, children } = $props();
</script>
<span class="child">{String(value)}</span>{@render children?.()}
`;

const scratch = { root: "", made: 0 };
const tally = { islands: 0, split: 0, styled: 0, styledSplit: 0 };

beforeAll(async () => {
  scratch.root = await mkdtemp(path.join(tmpdir(), "islands-fuzz-"));
});

afterAll(async () => {
  await rm(scratch.root, { recursive: true, force: true });
}, 60_000);

type Draw = {
  int: (min: number, max: number) => number;
  bool: () => boolean;
  next: () => number;
  isStatic: boolean;
};

function pick<T>(draw: Draw, items: ReadonlyArray<T>): T {
  return items[draw.int(0, items.length - 1)] as T;
}

function expression(
  draw: Draw,
  names: ReadonlyArray<string>,
  depth: number,
): string {
  const leaf = () =>
    pick(
      draw,
      draw.bool() && names.length > 0 ? names : ["1", '"s"', "word.length"],
    );
  if (depth <= 0) {
    return leaf();
  }
  const inner = () => expression(draw, names, depth - 1);
  const shapes: Array<() => string> = [
    leaf,
    () => `${inner()} + ${inner()}`,
    () => `twice(${inner()})`,
    () => (draw.isStatic ? `twice(${inner()})` : `shout(${inner()})`),
    () => `[${inner()}, ${inner()}].length`,
    () => `((count) => count + 1)(${inner()})`,
    () => `list.map((label) => label + ${inner()}).join("-")`,
    () =>
      names.length > 0 ? `JSON.stringify({ ${pick(draw, names)} })` : inner(),
    () => `(${inner()}) ? ${inner()} : ${inner()}`,
  ];
  return pick(draw, shapes)();
}

function nodes(
  draw: Draw,
  names: ReadonlyArray<string>,
  depth: number,
  isIsland: boolean,
): string {
  const count = draw.int(1, 3);
  const out: Array<string> = [];
  let scope = [...names];
  if (depth > 0 && draw.bool()) {
    const local = `local${draw.next()}`;
    out.push(`{const ${local} = ${expression(draw, scope, 1)}}`);
    scope = [...scope, local];
  }
  for (let index = 0; index < count; index += 1) {
    out.push(node(draw, scope, depth, isIsland));
  }
  return out.join("");
}

function node(
  draw: Draw,
  names: ReadonlyArray<string>,
  depth: number,
  isIsland: boolean,
): string {
  const expr = () => expression(draw, names, 2);
  const leaves: Array<() => string> = [
    () => "t",
    () => `{${expr()}}`,
    () => `<span title="{${expr()}}">{${expr()}}</span>`,
    () => `<b class:on={${expr()}}>{${expr()}}</b>`,
    () => `<i {${pick(draw, names)}}></i>`,
  ];
  if (!draw.isStatic) {
    leaves.push(
      () => `<Child value={${expr()}} />`,
      () => `{@render tag(${expr()})}`,
    );
  }
  if (isIsland && !draw.isStatic) {
    leaves.push(() => `<input bind:value={text} />`);
  }
  if (depth <= 0) {
    return pick(draw, leaves)();
  }
  const deeper = (extra: ReadonlyArray<string> = []) =>
    nodes(draw, [...names, ...extra], depth - 1, isIsland);
  const blocks: Array<() => string> = [
    ...leaves,
    () => `{#if ${expr()}}${deeper()}{:else}${deeper()}{/if}`,
    () => {
      const item = pick(draw, ["item", "count", "label"]);
      return `{#each list as ${item}, i}${deeper([item, "i"])}{/each}`;
    },
    () => {
      const name = `inner${draw.next()}`;
      const inside = nodes(
        draw,
        [...names.filter((each) => !each.startsWith("local")), "p"],
        depth - 1,
        isIsland,
      );
      return `{#snippet ${name}(p)}${inside}{/snippet}{@render ${name}(${expr()})}`;
    },
  ];
  if (!draw.isStatic) {
    blocks.push(() => `<Child value={${expr()}}>${deeper()}</Child>`);
  }
  return pick(draw, blocks)();
}

function island(draw: Draw) {
  if (draw.int(0, 2) === 0) {
    draw.isStatic = true;
    const body = nodes(draw, ["list", "word", "rows"], 2, true);
    draw.isStatic = false;
    return `<Island part={data.rows}>{#snippet children(rows)}${body}{/snippet}</Island>`;
  }
  const isWrapped = draw.bool();
  const outer = isWrapped ? [...PAGE_NAMES, "item"] : PAGE_NAMES;
  const body = nodes(draw, [...outer, "rows"], 2, true);
  const markup = `<Island part={data.rows}>{#snippet children(rows)}${body}{/snippet}</Island>`;
  return isWrapped ? `{#each list as item}${markup}{/each}` : markup;
}

const pages = fc.gen().map((generator) => {
  let counter = 0;
  const draw: Draw = {
    int: (min, max) => generator(fc.integer, { min, max }),
    bool: () => generator(fc.boolean),
    next: () => (counter += 1),
    isStatic: false,
  };
  const sections = Array.from({ length: draw.int(1, 3) }, () =>
    [island(draw), `<div>${nodes(draw, PAGE_NAMES, 1, false)}</div>`].join(
      "\n",
    ),
  );
  const rules = Array.from({ length: draw.bool() ? 0 : draw.int(1, 3) }, () => {
    const selector = pick(draw, SELECTORS);
    return selector.includes("{") ? selector : `${selector} { color: red; }`;
  });
  return `${SCRIPT}
{#snippet tag(value)}<em>{value} {label}</em>{/snippet}
<h1>{${expression(draw, PAGE_NAMES, 1)}}</h1>
${sections.join("\n")}
${rules.length === 0 ? "" : `<style>${rules.join(" ")}</style>`}
`;
});

function serverModule(source: string, filename: string) {
  return compile(source, {
    filename,
    generate: "server",
    cssHash: () => "svelte-fuzz",
  })
    .js.code.replaceAll(`"svelte-islands"`, `"./Island.compiled.js"`)
    .replaceAll(/"(\.\/[\w.-]+?)\.svelte"/gu, `"$1.compiled.js"`);
}

async function renderVariant(
  variant: "original" | "server" | "client",
  page: string,
) {
  scratch.made += 1;
  const dir = path.join(scratch.root, `${scratch.made}-${variant}`);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "Page.svelte");
  let source = page;
  const registry: Array<string> = [];
  const imports: Array<string> = [];
  if (variant !== "original") {
    const extracted = extract(page, file, "Page.svelte", variant);
    if (extracted == null) {
      throw new Error("expected islands");
    }
    const unexpected = extracted.warnings.filter(
      (warning) =>
        !warning.includes("means something else") &&
        !warning.includes("scoped styles"),
    );
    expect(unexpected).toStrictEqual([]);
    source = extracted.code;
    if (variant === "client") {
      const count = (page.match(/<Island /gu) ?? []).length;
      if (page.includes("<style>")) {
        tally.styled += count;
        tally.styledSplit += extracted.modules.length;
      } else {
        tally.islands += count;
        tally.split += extracted.modules.length;
      }
    }
    for (const [index, island] of extracted.modules.entries()) {
      if (variant !== "client") {
        continue;
      }

      const name = `island${index}.compiled.js`;
      await writeFile(
        path.join(dir, name),
        serverModule(island.source, island.file),
      );
      imports.push(`import { body as b${index} } from "./${name}";`);
      registry.push(`${JSON.stringify(island.id)}: b${index}`);
    }
  }
  await writeFile(
    path.join(dir, "registry.js"),
    `${imports.join("\n")}\nexport const registry = { ${registry.join(", ")} };\n`,
  );
  await writeFile(
    path.join(dir, "helpers.js"),
    "export function twice(value) { return value * 2; }\n",
  );
  await writeFile(
    path.join(dir, "Mock.compiled.js"),
    serverModule(ISLAND, "Mock.svelte"),
  );
  await writeFile(
    path.join(dir, "Island.compiled.js"),
    `export { default as Island } from "./Mock.compiled.js";\n`,
  );
  await writeFile(
    path.join(dir, "Child.compiled.js"),
    serverModule(CHILD, "Child.svelte"),
  );
  await writeFile(
    path.join(dir, "Page.compiled.js"),
    serverModule(source, file),
  );
  const module = (await import(
    pathToFileURL(path.join(dir, "Page.compiled.js")).href
  )) as { default: Component<{ data: { rows: Array<number> } }> };
  return render(module.default, { props: { data: { rows: [4, 5] } } }).body;
}

describe("the Vite plugin's transform", () => {
  it("renders the same HTML with and without the plugin", async () => {
    await fc.assert(
      fc.asyncProperty(pages, async (page) => {
        const original = await renderVariant("original", page);
        expect(await renderVariant("server", page)).toBe(original);
        expect(await renderVariant("client", page)).toBe(original);
      }),
      { numRuns: RUNS },
    );
    expect(tally.split / tally.islands).toBeGreaterThan(0.8);
    expect(tally.styledSplit / tally.styled).toBeGreaterThan(0.3);
  }, 600_000);

  it("renders an island it marks never-hydrating the same whatever the page's state", async () => {
    const seen = { never: 0 };
    await fc.assert(
      fc.asyncProperty(pages, async (page) => {
        const hydrates: Array<string | null> = [];
        Object.assign(globalThis, { fuzzHydrate: hydrates });
        const before = await renderVariant("server", page);
        Object.assign(globalThis, { fuzzHydrate: undefined });
        const after = await renderVariant(
          "server",
          page
            .replace("$state(2)", "$state(7)")
            .replace('$state("ok")', '$state("changed")')
            .replace('$state("typed")', '$state("retyped")'),
        );
        const islandsOf = (html: string) =>
          html
            .split("<x-island>")
            .slice(1)
            .map((part) => part.split("</x-island>")[0]);
        const [first, second] = [islandsOf(before), islandsOf(after)];
        for (const [index, hydrate] of hydrates.entries()) {
          if (hydrate === "never") {
            seen.never += 1;
            expect(second[index]).toBe(first[index]);
          }
        }
      }),
      { numRuns: RUNS },
    );
    expect(seen.never).toBeGreaterThan(0);
  }, 600_000);
});
