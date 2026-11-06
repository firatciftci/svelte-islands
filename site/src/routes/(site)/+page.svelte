<script lang="ts">
  import { resolve } from "$app/paths";
  import { Island, observe } from "svelte-islands";
  import Coast from "#lib/components/Coast.svelte";
  import Meta from "#lib/components/Meta.svelte";
  import Race from "#lib/components/Race.svelte";
  import Soundings from "#lib/components/Soundings.svelte";
  import TurnoutChart from "#lib/components/TurnoutChart.svelte";
  import WardTable from "#lib/components/WardTable.svelte";

  let { data } = $props();

  let status = $state<"static" | "loading" | "live" | "awake">("static");
  let kb = $state(0);
  let loadTime = $state(0);
  let hydrateTime = $state(0);
  let slow = $state<string | null>(null);
  let hero = $state<HTMLElement>();

  $effect(() => {
    slow = new URLSearchParams(location.search).get("slow");
    const island = hero?.querySelector(".island");
    if (island != null && !island.hasAttribute("data-island-state")) {
      status = "awake";
    }
    return observe((event) => {
      if (event.name !== data.harrow.name) {
        return;
      }
      if (event.type === "load") {
        kb = event.bytes / 1024;
        loadTime = event.duration;
      } else if (event.type === "hydrate") {
        hydrateTime = event.duration;
        status = "live";
      }
    });
  });

  function reached() {
    if (status === "static") {
      status = "loading";
    }
  }

  const docs = (slug: string) => resolve("/(site)/docs/[...slug]", { slug });
</script>

<Meta
  title="svelte-islands"
  description="Islands for SvelteKit: content-addressed page data, server HTML adopted without hydration, and skeletons learned from your own markup."
  path=""
  type="website"
/>

<main id="content" class="neat">
  <Soundings marks={data.soundings[0] ?? []} />
  <section class="hero">
    <div class="hero-title">
      <h1>svelte-islands</h1>
      <p class="hero-line">
        Your page's HTML arrives right away. Its data, and the work of hydrating
        it, wait until someone reaches for them.
      </p>
      <figure class="code install">
        <pre><code>npm install svelte-islands</code></pre>
        <button type="button" class="copy" data-copy aria-label="Copy code">
          <span class="copy-idle">Copy</span><span class="copy-done"
            >Copied</span
          >
        </button>
      </figure>
      <p class="hero-actions">
        <a class="cta" href={docs("getting-started/introduction")}
          >Read the docs</a
        >
      </p>
      <div class="key">
        <h2>Key</h2>
        <ul>
          <li>
            <i class="swatch swatch-water"></i>Deep water: plain HTML, with no
            island
          </li>
          <li>
            <i class="swatch swatch-drying"></i>Drying: an island's HTML, with
            no code running yet
          </li>
          <li>
            <i class="swatch swatch-rock"></i>Rock awash: an island whose HTML
            hasn't arrived
          </li>
          <li>
            <i class="swatch swatch-land"></i>Land: an island that has woken up
          </li>
        </ul>
        <p>Soundings: the size of each docs page, in kilobytes</p>
      </div>
    </div>
    <div class="hero-island" bind:this={hero}>
      <Coast seed={7} onreach={reached}>
        <Island part={data.harrow} when="interaction">
          {#snippet children(rows)}
            <WardTable {rows} limit={8} caption="Harrow Sound, by ward" />
          {/snippet}
        </Island>
      </Coast>
      <p class="coast-caption" aria-live="polite">
        {#if status === "static"}
          This table is plain HTML so far, and its data hasn't been downloaded.
          <span class="hint-pointer">Move your pointer over it.</span>
          <span class="hint-touch">Tap it.</span>
        {:else if status === "loading"}
          Downloading its data...
        {:else if status === "live"}
          Awake. It downloaded {kb.toFixed(1)} KB in {Math.round(loadTime)} ms and
          hydrated in {Math.round(hydrateTime)} ms. Try sorting it.
        {:else}
          Awake. Try sorting it.
        {/if}
      </p>
      <p class="coast-caption slow" data-needs-script>
        {#if slow != null}
          Downloads on this page are delayed by {slow} ms, so you can watch them.
          <a href={resolve("/(site)")} data-sveltekit-reload
            >Back to full speed</a
          >
        {:else}
          <a href="?slow=1500" data-sveltekit-reload
            >Reload and watch it slowly</a
          >
        {/if}
      </p>
      <p class="coast-caption invented">
        Every name and number here is invented.
      </p>
    </div>
  </section>
  <Soundings marks={data.soundings[1] ?? []} />

  <section class="archipelago">
    <svg
      class="course"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points="70,0 68,16 30,50 70,84"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div class="reach">
      <div class="reach-text">
        <h2>HTML can wait too</h2>
        <p>
          This table's HTML wasn't in the page when it loaded. It arrived as you
          scrolled toward it, and until then you'd have seen a skeleton that the
          library learned from the table itself.
        </p>
      </div>
      <Coast seed={19}>
        <Island part={data.deferred} defer>
          {#snippet children(rows)}
            <WardTable {rows} limit={6} />
          {/snippet}
        </Island>
      </Coast>
    </div>
    <div class="reach reach-flip">
      <div class="reach-text">
        <h2>Some things never need to wake</h2>
        <p>
          This island won't ever download its data. The text of these docs is
          built the same way, so it reaches you once as HTML and not a second
          time as data.
        </p>
      </div>
      <Coast seed={29}>
        <Island part={data.never} when="never">
          {#snippet children(rows)}
            <WardTable {rows} limit={4} />
          {/snippet}
        </Island>
      </Coast>
    </div>
    <div class="reach">
      <div class="reach-text">
        <h2>Some things only make sense in a browser</h2>
        <p>
          This chart has no server HTML at all. It renders when it comes into
          view, and a skeleton holds its place so that nothing moves.
        </p>
      </div>
      <Coast seed={31}>
        <Island part={data.client} ssr={false}>
          {#snippet children(rows)}
            <TurnoutChart {rows} title="Turnout in the ten closest wards" />
          {/snippet}
        </Island>
      </Coast>
    </div>
  </section>
  <Soundings marks={data.soundings[2] ?? []} />

  <section class="sheet" id="race">
    <h2>The same page, twice</h2>
    <p>
      Both pages show the same invented election, with 120 districts and 3,000
      polling places. One uses plain SvelteKit, and the other uses islands. They
      load one after the other because they share your browser's main thread.
    </p>
    <Race recorded={data.recorded} />
  </section>

  <section class="sheet setup">
    <h2>Setting it up</h2>
    <p>
      Three lines, and then nothing on your pages changes until you make your
      first island.
    </p>
    <div class="prose">
      {#each data.setup as html, index (index)}
        {@html html}
      {/each}
    </div>
  </section>

  <nav class="sheet pointers" aria-label="Where to go next">
    <a href={docs("getting-started/introduction")}>
      <strong>Get started</strong>
      <span>Install it and make your first island.</span>
    </a>
    <a href={docs("appendix/how-it-works")}>
      <strong>How it works</strong>
      <span>What happens on the server and in the browser.</span>
    </a>
    <a href={docs("appendix/benchmark")}>
      <strong>Benchmark</strong>
      <span>The numbers, the method, and where islands don't help.</span>
    </a>
  </nav>
</main>

<footer class="site-footer">
  <span>MIT licensed.</span>
  <span
    >Built for <a href="https://electionsarchive.com">electionsarchive.com</a
    >.</span
  >
  <a href={docs("appendix/credits")}>Credits</a>
</footer>
