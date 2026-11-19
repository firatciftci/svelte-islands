<script lang="ts">
  import { resolve } from "$app/paths";
  import DemoPage from "#lib/components/DemoPage.svelte";
  import HarborTable from "#lib/components/HarborTable.svelte";
  import OnTimeChart from "#lib/components/OnTimeChart.svelte";
  import type { Harbor } from "#lib/harrow.js";

  let { data } = $props();
  let loaded = $state.raw<Array<Harbor> | null>(null);

  async function fetchBerths() {
    const response = await fetch(resolve("/demo/plain-lazy/berths.json"));
    loaded = (await response.json()) as Array<Harbor>;
  }

  function whenNear(element: HTMLElement) {
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          watcher.disconnect();
          void fetchBerths();
        }
      },
      { rootMargin: "320px" },
    );
    watcher.observe(element);
    return () => watcher.disconnect();
  }
</script>

<DemoPage label="Plain SvelteKit page, lazy berths" summary={data.summary}>
  {#snippet chart()}
    <OnTimeChart rows={data.ports} title="On time at the busiest harbors" />
  {/snippet}
  {#snippet harbors()}
    <HarborTable rows={data.ports} filterLabel="Filter harbors" />
  {/snippet}
  {#snippet berths()}
    <div {@attach whenNear}>
      {#if loaded == null}
        <p>Loading berths...</p>
      {:else}
        <HarborTable rows={loaded} nameLabel="Berth" />
      {/if}
    </div>
  {/snippet}
</DemoPage>
