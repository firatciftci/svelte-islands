<script lang="ts">
  import DemoPage from "#lib/components/DemoPage.svelte";
  import HarborTable from "#lib/components/HarborTable.svelte";
  import OnTimeChart from "#lib/components/OnTimeChart.svelte";

  const SHOWN = 100;

  let { data } = $props();
  let showAll = $state(false);
</script>

<DemoPage label="Plain SvelteKit page, tuned" summary={data.summary}>
  {#snippet chart()}
    <OnTimeChart rows={data.ports} title="On time at the busiest harbors" />
  {/snippet}
  {#snippet harbors()}
    <HarborTable rows={data.ports} filterLabel="Filter harbors" />
  {/snippet}
  {#snippet berths()}
    <HarborTable
      rows={data.berths}
      nameLabel="Berth"
      limit={showAll ? data.berths.length : SHOWN}
    />
    {#if !showAll}
      <p>
        <button type="button" onclick={() => (showAll = true)}>
          Show all berths
        </button>
      </p>
    {/if}
  {/snippet}
</DemoPage>
