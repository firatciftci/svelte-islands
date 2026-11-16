<script lang="ts">
  import Coast from "#lib/components/Coast.svelte";
  import HarborTable from "#lib/components/HarborTable.svelte";

  let { data } = $props();
</script>

<svelte:head>
  <meta name="color-scheme" content="light" />
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet mark()}
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path
      class="mark-water"
      d="M6 9c4-6 13-7 18-3s7 11 3 16-12 8-18 5-9-11-3-18z"
    />
    <path
      class="mark-land"
      d="M11 11c3-3 8-3 10 0s3 7 0 9-7 4-10 2-3-8 0-11z"
    />
  </svg>
{/snippet}

{#if data.kind === "home"}
  <div class="card card-home neat">
    <div class="home-text">
      <h1>svelte-islands</h1>
      <p>
        Your page's HTML arrives right away. Its data, and the work of hydrating
        it, wait until someone reaches for them.
      </p>
    </div>
    <div class="home-island">
      <Coast>
        <HarborTable
          rows={data.rows}
          limit={7}
          caption="Harrow Sound, by harbor"
        />
      </Coast>
    </div>
  </div>
{:else}
  <div class="card neat">
    <div class="page-text">
      <p class="page-section">{data.section}</p>
      <h1 class={{ long: data.title.length > 24 }}>{data.title}</h1>
      <p class="page-description">{data.description}</p>
    </div>
    <div
      class="page-island"
      style:--tide-x={`${data.tide.x}%`}
      style:--tide-y={`${data.tide.y}%`}
    >
      <div class="coast-land" aria-hidden="true">
        <div class="coast-shoal-outer"></div>
        <div class="coast-shoal-inner"></div>
        <div class="coast-drying"></div>
        <div class="coast-ground"></div>
      </div>
      <div class="page-bars">
        {#each data.bars as bar, index (index)}
          <i
            class={{ heading: index === 0 }}
            style:inline-size={`${bar * 100}%`}
          ></i>
        {/each}
      </div>
    </div>
    <p class="page-mark">{@render mark()}svelte-islands</p>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: var(--water);
  }
  .card {
    inline-size: 1200px;
    block-size: 630px;
    margin: 0;
    padding: 0;
    color: var(--ink);
  }
  .card::before {
    inset: 18px;
  }
  .card::after {
    inset: 24px;
  }
  h1 {
    margin: 0;
    font-family: var(--water-type);
    font-style: italic;
    font-weight: 400;
    letter-spacing: -0.015em;
    text-wrap: balance;
  }

  .card-home {
    display: grid;
    grid-template-columns: 480px 1fr;
    gap: 24px;
    align-items: center;
    padding: 0 56px 0 84px;
  }
  .card-home h1 {
    font-size: 80px;
    line-height: 1;
    white-space: nowrap;
  }
  .home-text p {
    margin: 28px 0 0;
    font-family: var(--water-type);
    font-style: italic;
    font-size: 29px;
    line-height: 1.3;
    text-wrap: pretty;
  }
  .home-island {
    --reach: 40px;
    padding-inline: 40px;
    font-size: 14px;
  }
  .home-island :global(.coast-tag) {
    display: none;
  }
  .home-island :global(.coast) {
    margin-block: 0;
  }
  .home-island :global(.coast-ground) {
    clip-path: circle(68% at 100% 0);
  }

  .card:not(.card-home) {
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-rows: 1fr auto;
    column-gap: 72px;
    padding: 76px 88px 64px;
  }
  .page-text {
    align-self: center;
  }
  .page-section {
    margin: 0 0 20px;
    font-family: var(--water-type);
    font-style: italic;
    font-size: 30px;
    color: var(--course);
  }
  .page-text h1 {
    font-size: 84px;
    line-height: 1;
  }
  .page-text h1.long {
    font-size: 66px;
    line-height: 1.04;
  }
  .page-description {
    display: -webkit-box;
    margin: 28px 0 0;
    overflow: hidden;
    font-family: var(--prose);
    font-size: 25px;
    line-height: 1.4;
    color: var(--muted);
    text-wrap: pretty;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }
  .page-island {
    --reach: 44px;
    --plate: calc(var(--reach) * 0.58);
    --corner: 16px;
    position: relative;
    isolation: isolate;
    align-self: center;
    margin: var(--reach);
    padding: 36px 30px;
  }
  .page-island .coast-ground {
    clip-path: circle(62% at var(--tide-x) var(--tide-y));
  }
  .page-bars {
    position: relative;
    display: grid;
    gap: 18px;
  }
  .page-bars i {
    display: block;
    block-size: 14px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--ink) 22%, transparent);
  }
  .page-bars i.heading {
    block-size: 22px;
    margin-block-end: 6px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--ink) 55%, transparent);
  }
  .page-mark {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 0;
    font-family: var(--water-type);
    font-style: italic;
    font-size: 32px;
  }
  .page-mark svg {
    inline-size: 46px;
    block-size: 46px;
  }
  .mark-water {
    fill: var(--shoal-2);
  }
  .mark-land {
    fill: var(--land);
    stroke: var(--ink);
    stroke-width: 1.4;
  }
</style>
