<script lang="ts">
  import DemoPage from "#lib/components/DemoPage.svelte";
  import HarborTable from "#lib/components/HarborTable.svelte";
  import OnTimeChart from "#lib/components/OnTimeChart.svelte";

  let { data } = $props();
</script>

<DemoPage label="Plain SvelteKit page" summary={data.summary}>
  {#snippet chart()}
    <OnTimeChart rows={data.ports} title="On time at the busiest harbors" />
  {/snippet}
  {#snippet harbors()}
    <HarborTable rows={data.ports} filterLabel="Filter harbors" />
  {/snippet}
  {#snippet berths()}
    <HarborTable rows={data.berths} nameLabel="Berth" />
  {/snippet}
</DemoPage>
