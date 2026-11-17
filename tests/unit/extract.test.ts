import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { extract } from "#lib/extract.js";

const FILE = "/app/src/routes/+page.svelte";

function svelte(strings: TemplateStringsArray, ...values: Array<unknown>) {
  return String.raw({ raw: strings }, ...values);
}

function page(script: string, markup: string, style = "") {
  return `<script lang="ts">
  import { Island } from "svelte-islands";
${script}
</script>

${markup}
${style}`;
}

function client(code: string) {
  const extracted = extract(code, FILE, "src/routes/+page.svelte", "client");
  if (extracted == null) {
    throw new Error("expected islands");
  }
  for (const made of [
    { source: extracted.code, file: FILE },
    ...extracted.modules,
  ]) {
    compile(made.source, { filename: made.file, generate: "client" });
    compile(made.source, { filename: made.file, generate: "server" });
  }
  return extracted;
}

function only(code: string) {
  const extracted = client(code);
  expect(extracted.warnings).toStrictEqual([]);
  expect(extracted.modules).toHaveLength(1);
  const [made] = extracted.modules;
  if (made == null) {
    throw new Error("expected a module");
  }
  return { page: extracted.code, module: made.source };
}

describe("extract", () => {
  it("leaves a component without islands alone", () => {
    expect(
      extract("<p>hello</p>", FILE, "src/routes/+page.svelte", "client"),
    ).toBeNull();
    expect(
      extract(
        `<script>import { Pending } from "svelte-islands";</script>`,
        FILE,
        "src/routes/+page.svelte",
        "client",
      ),
    ).toBeNull();
  });

  it("moves the snippet and its imports out of the page", () => {
    const { page: rewritten, module } = only(
      page(
        `  import Rows from "$lib/Rows.svelte";
  const { data } = $props();`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows)}
    <Rows {rows} />
  {/snippet}
</Island>`,
      ),
    );
    expect(rewritten).not.toContain("Rows");
    expect(rewritten).toMatch(
      /code=\{\(\) => import\("\/app\/src\/routes\/\+page\.svelte\.__island-[\w-]+\.svelte"\)\}/u,
    );
    expect(rewritten).toMatch(/module="[\w-]{12}"/u);
    expect(rewritten).not.toContain("scope=");
    expect(module).toContain(`import Rows from "$lib/Rows.svelte";`);
    expect(module).toContain("{#snippet body(rows, scope)}");
    expect(module).toContain("export { body };");
    expect(module).toContain('<script module lang="ts">');
  });

  it("keeps an import the page still uses", () => {
    const { page: rewritten } = only(
      page(
        `  import Rows from "$lib/Rows.svelte";
  const { data } = $props();`,
        svelte`<Rows rows={[]} />
<Island part={data.rows}>
  {#snippet children(rows)}<Rows {rows} />{/snippet}
</Island>`,
      ),
    );
    expect(rewritten).toContain(`import Rows from "$lib/Rows.svelte";`);
  });

  it("keeps the rest of a partly used import", () => {
    const { page: rewritten, module } = only(
      page(
        `  import { format, parse as read } from "$lib/text";
  const { data } = $props();`,
        svelte`<p>{read("x")}</p>
<Island part={data.rows}>
  {#snippet children(rows)}<p>{format(rows)}</p>{/snippet}
</Island>`,
      ),
    );
    expect(rewritten).toContain(`import { parse as read } from "$lib/text"`);
    expect(module).toContain(`import { format } from "$lib/text";`);
  });

  it("reads page values through getters and writes through setters", () => {
    const { page: rewritten, module } = only(
      page(
        `  const { data } = $props();
  let count = $state(0);
  const label = $derived(count + "!");`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows)}
    <button onclick={() => (count += rows.length)}>{label}</button>
  {/snippet}
</Island>`,
      ),
    );
    expect(rewritten).toContain("get count() { return count; }");
    expect(rewritten).toMatch(/set count\((\w+)\) \{ count = \1; \}/u);
    expect(rewritten).toContain("get label() { return label; }");
    expect(rewritten).not.toContain("set label");
    expect(module).toContain("scope.count += rows.length");
    expect(module).toContain("{scope.label}");
  });

  it("rewrites shorthand attributes, bindings, and directives", () => {
    const { module, page: rewritten } = only(
      page(
        `  const { data } = $props();
  let value = $state("");
  let open = $state(false);
  let color = $state("red");
  let title = $state("t");
  function tooltip(node: HTMLElement) {}`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows)}
    <input bind:value {title} />
    <details bind:open class:open style:color use:tooltip></details>
  {/snippet}
</Island>`,
      ),
    );
    expect(module).toContain("bind:value={scope.value}");
    expect(module).toContain("title={scope.title}");
    expect(module).toContain("bind:open={scope.open}");
    expect(module).toContain("class:open={scope.open}");
    expect(module).toContain("style:color={scope.color}");
    expect(module).toContain("use:scope.tooltip");
    expect(rewritten).toMatch(/set value\(/u);
    expect(rewritten).toMatch(/set open\(/u);
    expect(rewritten).not.toMatch(/set color\(/u);
  });

  it("expands shorthand properties", () => {
    const { module } = only(
      page(
        `  const { data } = $props();
  const unit = "kg";`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows)}<p>{JSON.stringify({ unit, rows })}</p>{/snippet}
</Island>`,
      ),
    );
    expect(module).toContain("{ unit: scope.unit, rows }");
  });

  it("leaves names declared inside the snippet alone", () => {
    const { page: rewritten, module } = only(
      page(
        `  const { data } = $props();
  let item = $state(0);
  let index = $state(0);
  let total = $state(0);
  let value = $state(0);
  let found = $state(0);`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows)}
    {#each rows as item, index (item.id)}<p>{item.name} {index}</p>{/each}
    {const total = rows.length}
    {@const value = total * 2}
    {#await Promise.resolve(1) then found}{found}{/await}
    {#snippet inner(item: number)}{item}{/snippet}
    {@render inner(value)}
    <p>{[1].map((total) => total + 1)}</p>
    <p>{(() => { const found = 1; return found; })()}</p>
  {/snippet}
</Island>`,
      ),
    );
    expect(rewritten).not.toContain("scope=");
    expect(module).not.toContain("scope.");
  });

  it("captures each-block values around the island", () => {
    const { page: rewritten, module } = only(
      page(
        `  const { data } = $props();
  const groups = ["a", "b"];`,
        svelte`{#each groups as group, index (group)}
  <Island part={data.rows} view={group}>
    {#snippet children(rows)}<p>{group} {index}</p>{/snippet}
  </Island>
{/each}`,
      ),
    );
    expect(rewritten).toContain("get group() { return group; }");
    expect(rewritten).toContain("get index() { return index; }");
    expect(module).toContain("{scope.group} {scope.index}");
  });

  it("passes components that aren't imports through the scope", () => {
    const { module } = only(
      page(
        `  import A from "$lib/A.svelte";
  import B from "$lib/B.svelte";
  const { data, wide } = $props();
  const View = $derived(wide ? A : B);`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows)}<View {rows}>text</View>{/snippet}
</Island>`,
      ),
    );
    expect(module).toContain("<scope.View {rows}>text</scope.View>");
  });

  it("reads and writes stores through the scope", () => {
    const { page: rewritten, module } = only(
      page(
        `  import { writable } from "svelte/store";
  const { data } = $props();
  const count = writable(0);`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows)}<button onclick={() => ($count += 1)}>{$count}</button>{/snippet}
</Island>`,
      ),
    );
    expect(rewritten).toContain("get $count() { return $count; }");
    expect(rewritten).toMatch(/set \$count\(/u);
    expect(module).toContain("scope.$count += 1");
  });

  it("copies the page's snippets that the island renders", () => {
    const { page: rewritten, module } = only(
      page(
        `  import Badge from "$lib/Badge.svelte";
  const { data } = $props();
  let tone = $state("calm");`,
        svelte`{#snippet badge(label: string)}<Badge {label} {tone} />{/snippet}
<Island part={data.rows}>
  {#snippet children(rows)}{@render badge(rows[0])}{/snippet}
</Island>`,
      ),
    );
    expect(rewritten).not.toContain("{#snippet badge");
    expect(rewritten).not.toContain("Badge");
    expect(module).toContain("{#snippet badge(label: string)}");
    expect(module).toContain("tone={scope.tone}");
    expect(module).toContain(`import Badge from "$lib/Badge.svelte";`);
  });

  it("shares one module between islands that pass the same snippet", () => {
    const extracted = client(
      page(
        `  import Table from "$lib/Table.svelte";
  const { data } = $props();`,
        svelte`{#snippet table(rows)}<Table {rows} />{/snippet}
<Island part={data.a} children={table} />
<Island part={data.b} children={table} />`,
      ),
    );
    const [first, second] = extracted.modules;
    expect(first?.file).toBe(second?.file);
    expect(first?.id).not.toBe(second?.id);
    expect(extracted.code).not.toContain("{#snippet table");
    expect(extracted.code).not.toContain("Table");
  });

  it("follows a renamed import", () => {
    const extracted = client(svelte`<script>
  import { Island as Isle } from "svelte-islands";
  import Rows from "$lib/Rows.svelte";
  const { data } = $props();
</script>

<Isle part={data.rows}>{#snippet children(rows)}<Rows {rows} />{/snippet}</Isle>`);
    expect(extracted.modules).toHaveLength(1);
  });

  it("ignores type annotations and assertions", () => {
    const { page: rewritten, module } = only(
      page(
        `  import type { Row } from "$lib/types";
  import { Kind } from "$lib/kind";
  const { data } = $props();
  type Local = { id: number };`,
        svelte`<Island part={data.rows}>
  {#snippet children(rows: Array<Row>)}<p>{(rows[0] as Local).id} {rows.length satisfies number} {Kind.A}</p>{/snippet}
</Island>`,
      ),
    );
    expect(rewritten).not.toContain("scope=");
    expect(module).toContain(`import { Kind } from "$lib/kind";`);
    expect(module).not.toContain("Row }");
  });

  it("marks islands for the server without moving anything", () => {
    const code = page(
      `  import Rows from "$lib/Rows.svelte";
  const { data } = $props();
  let count = $state(0);`,
      svelte`<Island part={data.rows}>
  {#snippet children(rows)}<Rows {rows} onpick={() => count++} />{/snippet}
</Island>`,
    );
    const server = extract(code, FILE, "src/routes/+page.svelte", "server");
    const browser = extract(code, FILE, "src/routes/+page.svelte", "client");
    expect(server?.code).toContain("{#snippet children(rows)}");
    expect(server?.code).toContain(`import Rows from "$lib/Rows.svelte";`);
    expect(server?.code).toContain("get count() { return count; }");
    expect(server?.code).not.toContain("set count");
    expect(server?.code).not.toContain("code=");
    expect(server?.modules[0]?.id).toBe(browser?.modules[0]?.id);
    compile(server?.code ?? "", { filename: FILE, generate: "server" });
  });

  it.each([
    [
      "scoped styles",
      svelte`<Island part={data.rows}>{#snippet children(rows)}<p class="a">{rows}</p>{/snippet}</Island>`,
      "<style>.a { color: red; }</style>",
      "scoped styles",
    ],
    [
      "svelte:self",
      svelte`<Island part={data.rows}>{#snippet children(rows)}<svelte:self />{/snippet}</Island>`,
      "",
      "<svelte:self>",
    ],
    [
      "$$props",
      svelte`<Island part={data.rows}>{#snippet children(rows)}{$$props.x}{/snippet}</Island>`,
      "",
      "$$props",
    ],
    [
      "a debug tag",
      svelte`<Island part={data.rows}>{#snippet children(rows)}{@debug data}{/snippet}</Island>`,
      "",
      "{@debug data}",
    ],
    [
      "a name that means something else where the island is",
      svelte`{#snippet show()}{item}{/snippet}
{#each [1] as item}<Island part={data.rows}>{#snippet children(rows)}{@render show()}{/snippet}</Island>{/each}`,
      "",
      `"item" means something else`,
    ],
    [
      "children that aren't a snippet",
      svelte`<Island part={data.rows} children={pick()} />`,
      "",
      "aren't a snippet",
    ],
  ])("leaves an island in the page for %s", (_, markup, style, reason) => {
    const extracted = extract(
      page(
        `  const { data } = $props();
  const item = 1;
  function pick() {}`,
        markup,
        style,
      ),
      FILE,
      "src/routes/+page.svelte",
      "client",
    );
    expect(extracted?.modules).toStrictEqual([]);
    expect(extracted?.warnings.join("\n")).toContain(reason);
  });

  it.each([
    ["a class it uses", `<p class="a">`, ".a { color: red; }"],
    ["its tag", `<p>`, "section p { color: red; }"],
    ["a selector inside :has()", `<p>`, ".x:has(p) { color: red; }"],
    [
      "a class it may get at runtime",
      `<p class={rows.length > 1 ? "a" : "b"}>`,
      ".a { color: red; }",
    ],
    ["a spread", `<p {...data}>`, ".a { color: red; }"],
    ["an attribute it has", `<p data-on="1">`, "[data-on] { color: red; }"],
    [
      "a class directive",
      `<p class:a={rows.length > 1}>`,
      ".a { color: red; }",
    ],
    [
      "a nested rule",
      `<p class="b">`,
      "@media (width > 1px) { .a { .b { color: red; } } }",
    ],
    ["a dynamic element", `<svelte:element this="p">`, "p { color: red; }"],
  ])(
    "leaves an island in the page when its markup matches %s",
    (_, open, style) => {
      const tag = open.startsWith("<svelte:element") ? "svelte:element" : "p";
      const extracted = extract(
        page(
          `  const { data } = $props();`,
          svelte`<Island part={data.rows}>{#snippet children(rows)}${open}{rows}</${tag}>{/snippet}</Island>`,
          `<style>${style}</style>`,
        ),
        FILE,
        "src/routes/+page.svelte",
        "client",
      );
      expect(extracted?.modules).toStrictEqual([]);
      expect(extracted?.warnings.join("\n")).toContain("scoped styles");
    },
  );

  it.each([
    ["another class", svelte`<p class="b">{rows}</p>`, ".a { color: red; }"],
    ["another tag", svelte`<p>{rows}</p>`, "section span { color: red; }"],
    ["the root", svelte`<p>{rows}</p>`, ":root { --gap: 1rem; }"],
    [
      "a global block",
      svelte`<p class="a">{rows}</p>`,
      ".page :global { .a { color: red; } }",
    ],
    [
      "a global inside a compound selector",
      svelte`<p class="b">{rows}</p>`,
      ":global(.b) span { color: red; }",
    ],
    [
      "a component",
      svelte`<Rows {rows} />`,
      ".a { color: red; } p { color: blue; }",
    ],
  ])("splits islands whose markup meets only %s", (_, markup, style) => {
    only(
      page(
        `  import Rows from "$lib/Rows.svelte";
  const { data } = $props();`,
        svelte`<Island part={data.rows}>{#snippet children(rows)}${markup}{/snippet}</Island>`,
        `<style>${style}</style>`,
      ),
    );
  });

  it("splits islands whose markup only meets global styles", () => {
    only(
      page(
        `  const { data } = $props();`,
        svelte`<Island part={data.rows}>{#snippet children(rows)}<p class="a">{rows}</p>{/snippet}</Island>`,
        "<style>:global(.a) { color: red; } @keyframes spin { from { opacity: 0; } }</style>",
      ),
    );
  });

  it("gives every island a stable id", () => {
    const code = page(
      `  const { data } = $props();`,
      svelte`<Island part={data.a}>{#snippet children(a)}{a}{/snippet}</Island>
<Island part={data.b}>{#snippet children(b)}{b}{/snippet}</Island>`,
    );
    const first = extract(code, FILE, "src/routes/+page.svelte", "client");
    const again = extract(code, FILE, "src/routes/+page.svelte", "client");
    expect(first?.modules.map((made) => made.id)).toStrictEqual(
      again?.modules.map((made) => made.id),
    );
    expect(new Set(first?.modules.map((made) => made.id)).size).toBe(2);
  });
});
