<script lang="ts">
  import { resolve } from "$app/paths";

  type Numbers = {
    html: number;
    total: number;
    tasks: number | null;
    blocking: number | null;
  };
  type Name = "plain" | "islands";

  let {
    recorded,
  }: {
    recorded: {
      date: string;
      machine: string;
      plain: Numbers;
      islands: Numbers;
    };
  } = $props();

  const ROWS: Array<{
    key: keyof Numbers;
    label: string;
    unit: "kb" | "count" | "ms";
  }> = [
    { key: "html", label: "HTML", unit: "kb" },
    { key: "total", label: "Total downloaded", unit: "kb" },
    { key: "tasks", label: "Long tasks", unit: "count" },
    { key: "blocking", label: "Blocking time", unit: "ms" },
  ];

  const PANES = [
    {
      name: "plain",
      caption: "Plain SvelteKit",
      label: "Plain SvelteKit page",
      href: resolve("/demo/plain"),
    },
    {
      name: "islands",
      caption: "With islands",
      label: "Islands page",
      href: resolve("/demo/islands"),
    },
  ] as const;

  let started = $state<Array<Name>>([]);
  let running = $state<Name | null>(null);
  let measured = $state.raw<Record<Name, Numbers> | null>(null);
  let width = $state(0);
  let waiting: ((numbers: Numbers) => void) | null = null;

  const shown = $derived(measured ?? recorded);

  function isReport(
    data: unknown,
  ): data is {
    kind: "race";
    html: number;
    total: number;
    tasks: number;
    blocking: number;
    canCount: boolean;
  } {
    return (
      typeof data === "object" &&
      data != null &&
      "kind" in data &&
      data.kind === "race"
    );
  }

  function received(event: MessageEvent<unknown>) {
    if (event.origin !== location.origin || !isReport(event.data)) {
      return;
    }
    const { html, total, tasks, blocking, canCount } = event.data;
    waiting?.({
      html,
      total,
      tasks: canCount ? tasks : null,
      blocking: canCount ? blocking : null,
    });
  }

  function measure(name: Name) {
    running = name;
    started = [...started, name];
    return new Promise<Numbers>((done) => {
      waiting = done;
    });
  }

  async function run() {
    measured = null;
    started = [];
    const plain = await measure("plain");
    const islands = await measure("islands");
    running = null;
    waiting = null;
    measured = { plain, islands };
  }

  function format(value: number | null, unit: "kb" | "count" | "ms") {
    if (value == null) {
      return "–";
    }
    if (unit === "kb") {
      return `${Math.round(value / 1024).toLocaleString("en-US")} KB`;
    }
    if (unit === "ms") {
      return `${Math.round(value).toLocaleString("en-US")} ms`;
    }
    return value.toLocaleString("en-US");
  }

  function share(value: number | null, other: number | null) {
    const most = Math.max(value ?? 0, other ?? 0);
    return most === 0 ? 0 : ((value ?? 0) / most) * 100;
  }
</script>

<svelte:window onmessage={received} />

<div class="race">
  <table class="race-table">
    <thead>
      <tr>
        <td></td>
        <th scope="col">
          <i class="race-swatch race-plain"></i>Plain SvelteKit
        </th>
        <th scope="col">
          <i class="race-swatch race-islands"></i>With islands
        </th>
      </tr>
    </thead>
    <tbody>
      {#each ROWS as row (row.key)}
        <tr>
          <th scope="row">{row.label}</th>
          <td>
            <span class="race-value">
              {format(shown.plain[row.key], row.unit)}
            </span>
            <span
              class="race-bar race-plain"
              style:inline-size={`${share(shown.plain[row.key], shown.islands[row.key])}%`}
            ></span>
          </td>
          <td>
            <span class="race-value">
              {format(shown.islands[row.key], row.unit)}
            </span>
            <span
              class="race-bar race-islands"
              style:inline-size={`${share(shown.islands[row.key], shown.plain[row.key])}%`}
            ></span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="race-note" aria-live="polite">
    {#if running != null}
      Loading {running === "plain" ? "Plain SvelteKit" : "With islands"}...
    {:else if measured != null}
      Measured just now in your browser.
      {#if measured.plain.tasks == null}
        This browser doesn't report long tasks, so only the sizes are shown.
      {/if}
    {:else}
      Recorded on {recorded.date} with {recorded.machine}, at 4x CPU slowdown.
    {/if}
  </p>
  <p class="actions">
    <button
      type="button"
      class="cta"
      data-needs-script
      disabled={running != null}
      onclick={run}
    >
      Run it on your machine
    </button>
    <a href={resolve("/(site)/docs/[...slug]", { slug: "appendix/benchmark" })}
      >How this was measured</a
    >
  </p>
  {#if started.length > 0}
    <div class="race-panes">
      {#each PANES as pane (pane.name)}
        <figure class="race-pane">
          <figcaption>{pane.caption}</figcaption>
          <div class="race-window" bind:clientWidth={width}>
            {#if started.includes(pane.name)}
              <iframe
                title={pane.label}
                src={`${pane.href}?race`}
                style:scale={width / 1000}
              ></iframe>
            {:else}
              <p class="race-wait">Waiting its turn</p>
            {/if}
          </div>
        </figure>
      {/each}
    </div>
    {#if measured != null}
      <p class="race-note">
        Both pages are still running in these frames. Try sorting a table in
        each one.
      </p>
    {/if}
  {/if}
</div>
