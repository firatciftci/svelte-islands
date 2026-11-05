<!--
  @component
  A development overlay that lists the page's islands with their state, data size,
  load and hydration times, and any problems it finds. It renders nothing in
  production, and you can keep it out of the bundle with `{#if dev}`.
-->
<script lang="ts">
  import { dev } from "$app/env";
  import { onMount } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { Observation } from "./observe.js";
  import { observe } from "./observe.js";
  import { boxes } from "./runtime.js";

  const {
    shift = 16,
    large = 256,
  }: {
    /** Flags a skeleton that was off by more than this many pixels. */
    shift?: number;
    /** Flags a part larger than this many KiB. */
    large?: number;
  } = $props();

  const LOG = 50;

  const seen = new SvelteMap<
    string,
    {
      load?: number;
      hydrate?: number;
      from?: number;
      to?: number;
      failed?: string;
    }
  >();
  let islands = $state.raw<
    Array<{
      element: HTMLElement;
      hash: string;
      name: string;
      state: string;
      bytes: number;
      isPlain: boolean;
    }>
  >([]);
  let log = $state.raw<Array<Observation>>([]);
  let outlines = $state.raw<Array<DOMRect>>([]);
  let isOpen = $state(false);
  let root: HTMLElement | null = null;

  const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
  const ms = (duration: number) => `${Math.round(duration)} ms`;

  const rows = $derived(
    islands.map((island) => {
      const stats = seen.get(island.hash);
      const change =
        stats?.from != null && stats.to != null ? stats.to - stats.from : null;
      const issues: Array<string> = [];
      if (change != null && Math.abs(change) > shift) {
        issues.push(
          `Its skeleton was ${Math.round(Math.abs(change))} px off, so the page moved when the content arrived.`,
        );
      }
      if (island.bytes > large * 1024) {
        issues.push(
          'Its data is large. Split it, or load it later with fetch: "lazy".',
        );
      }
      if (stats?.failed != null) {
        issues.push(`Download failed: ${stats.failed}`);
      }
      if (island.isPlain) {
        issues.push(
          "No learned skeleton yet, so it shows a plain placeholder.",
        );
      }
      return { ...island, ...stats, change, issues };
    }),
  );
  const flagged = $derived(rows.filter((row) => row.issues.length > 0).length);
  const size = $derived.by(() => {
    let sum = 0;
    for (const island of islands) {
      sum += island.bytes;
    }
    return kib(sum);
  });

  function describe(event: Observation) {
    switch (event.type) {
      case "load":
      case "markup": {
        return `${event.type} ${event.name}: ${kib(event.bytes)} in ${ms(event.duration)}`;
      }
      case "hydrate": {
        return `hydrate ${event.name} (${event.when}): ${ms(event.duration)}`;
      }
      case "reveal": {
        return `reveal ${event.name}: ${Math.round(event.from)} to ${Math.round(event.to)} px`;
      }
      default: {
        return `fail ${event.name}: ${event.message}`;
      }
    }
  }

  function record(event: Observation) {
    log = [event, ...log].slice(0, LOG);
    const stats = seen.get(event.hash) ?? {};
    if (event.type === "load") {
      seen.set(event.hash, { ...stats, load: event.duration });
    } else if (event.type === "hydrate") {
      seen.set(event.hash, { ...stats, hydrate: event.duration });
    } else if (event.type === "reveal") {
      seen.set(event.hash, { ...stats, from: event.from, to: event.to });
    } else if (event.type === "fail") {
      seen.set(event.hash, { ...stats, failed: event.message });
    }
  }

  function scan() {
    islands = [...document.querySelectorAll<HTMLElement>("[data-island]")].map(
      (element) => ({
        element,
        hash: element.dataset.island ?? "",
        name: element.dataset.islandName ?? "",
        state:
          element.dataset.islandState ??
          (element.hasAttribute("aria-busy") ? "waiting" : "live"),
        bytes: Number(element.dataset.islandBytes ?? 0),
        isPlain:
          element.querySelector(":scope > .island-shell > .island-fallback") !=
          null,
      }),
    );
  }

  function outline(element: HTMLElement) {
    outlines = boxes(element).map((box) => box.getBoundingClientRect());
  }

  function clearOutline() {
    outlines = [];
  }

  function reach(element: HTMLElement) {
    boxes(element)[0]?.scrollIntoView({ block: "center" });
    outline(element);
  }

  function holds(target: HTMLElement) {
    root = target;
    return () => {
      root = null;
    };
  }

  onMount(() => {
    if (!dev) {
      return;
    }
    scan();
    let frame = 0;
    const stopObserving = observe(record);
    const watcher = new MutationObserver((records) => {
      const isOurs = records.every((item) => root?.contains(item.target));
      if (frame !== 0 || isOurs) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        scan();
      });
    });
    watcher.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-island-state", "aria-busy"],
    });
    return () => {
      stopObserving();
      watcher.disconnect();
      cancelAnimationFrame(frame);
    };
  });
</script>

{#if dev}
  <aside class="devtools" data-islands-devtools {@attach holds}>
    {#each outlines as rect, at (at)}
      <div
        class="outline"
        style:inset-block-start="{rect.top}px"
        style:inset-inline-start="{rect.left}px"
        style:inline-size="{rect.width}px"
        style:block-size="{rect.height}px"
      ></div>
    {/each}
    {#if isOpen}
      <section class="panel" aria-label="Islands on this page">
        <header>
          <h2>Islands on this page</h2>
          <p>{islands.length} islands, {size} of data</p>
          <button
            type="button"
            onclick={() => {
              isOpen = false;
              clearOutline();
            }}>Close</button
          >
        </header>
        {#if rows.length === 0}
          <p class="note">No islands on this page.</p>
        {:else}
          <table>
            <thead>
              <tr>
                <th scope="col">Island</th>
                <th scope="col">State</th>
                <th scope="col" class="number">Data</th>
                <th scope="col" class="number">Load</th>
                <th scope="col" class="number">Hydrate</th>
                <th scope="col" class="number">Height change</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.element)}
                <tr
                  onpointerenter={() => {
                    outline(row.element);
                  }}
                  onpointerleave={clearOutline}
                >
                  <td>
                    <button
                      type="button"
                      class="name"
                      onclick={() => {
                        reach(row.element);
                      }}
                      onfocus={() => {
                        outline(row.element);
                      }}
                      onblur={clearOutline}>{row.name}</button
                    >
                    {#each row.issues as issue (issue)}
                      <p class="issue">{issue}</p>
                    {/each}
                  </td>
                  <td>{row.state}</td>
                  <td class="number">{kib(row.bytes)}</td>
                  <td class="number">
                    {row.load == null ? "" : ms(row.load)}
                  </td>
                  <td class="number">
                    {row.hydrate == null ? "" : ms(row.hydrate)}
                  </td>
                  <td class="number">
                    {row.change == null ? "" : `${Math.round(row.change)} px`}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <h3>Events</h3>
        {#if log.length === 0}
          <p class="note">No events yet.</p>
        {:else}
          <ol>
            {#each log as event, at (at)}
              <li>{describe(event)}</li>
            {/each}
          </ol>
        {/if}
      </section>
    {:else}
      <button
        type="button"
        class="pill"
        onclick={() => {
          isOpen = true;
        }}
      >
        Islands {islands.length}
        {#if flagged > 0}
          <span class="flag">{flagged} to check</span>
        {/if}
      </button>
    {/if}
  </aside>
{/if}

<style>
  .devtools {
    color-scheme: dark;
    color: #f4f4f5;
    font:
      12px/1.4 system-ui,
      sans-serif;
  }

  .outline {
    position: fixed;
    z-index: 2147483646;
    pointer-events: none;
    outline: 2px solid #38bdf8;
    background: rgb(56 189 248 / 12%);
  }

  .pill,
  .panel {
    position: fixed;
    z-index: 2147483647;
    inset-block-end: 12px;
    inset-inline-end: 12px;
    border: 1px solid #52525b;
    border-radius: 8px;
    background: #18181b;
    color: inherit;
    font: inherit;
  }

  .pill {
    padding: 6px 10px;
    cursor: pointer;
  }

  .flag {
    margin-inline-start: 6px;
    color: #fbbf24;
  }

  .panel {
    overflow: auto;
    inline-size: min(720px, calc(100vw - 24px));
    max-block-size: 70vh;
    padding: 12px;
  }

  header {
    display: flex;
    gap: 12px;
    align-items: baseline;
    margin-block-end: 8px;
  }

  header p {
    flex: 1;
    margin: 0;
    color: #a1a1aa;
  }

  header button {
    border: 1px solid #52525b;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  h2,
  h3 {
    margin: 0;
    font: inherit;
    font-weight: 600;
  }

  h3 {
    margin-block: 12px 4px;
  }

  table {
    inline-size: 100%;
    border-collapse: collapse;
    font: inherit;
  }

  th,
  td {
    padding: 3px 8px 3px 0;
    border-block-end: 1px solid #27272a;
    color: inherit;
    font: inherit;
    text-align: start;
    vertical-align: top;
  }

  th {
    color: #a1a1aa;
  }

  .number {
    font-variant-numeric: tabular-nums;
    text-align: end;
    white-space: nowrap;
  }

  .name {
    padding: 0;
    border: 0;
    background: none;
    color: #38bdf8;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .issue {
    margin: 2px 0 0;
    color: #fbbf24;
  }

  .note {
    margin: 0;
    color: #a1a1aa;
  }

  ol {
    margin: 0;
    padding: 0;
    color: #d4d4d8;
    font-family: ui-monospace, monospace;
    list-style: none;
  }
</style>
