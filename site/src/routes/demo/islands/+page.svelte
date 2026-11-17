<script lang="ts">
  import { Island } from "svelte-islands";
  import DemoPage from "#lib/components/DemoPage.svelte";
  import HarborTable from "#lib/components/HarborTable.svelte";
  import OnTimeChart from "#lib/components/OnTimeChart.svelte";

  let { data } = $props();
</script>

<DemoPage label="Islands page" summary={data.summary}>
  {#snippet chart()}
    <Island part={data.ports} view="chart" render="client">
      {#snippet children(rows)}
        <OnTimeChart {rows} title="On time at the busiest harbors" />
      {/snippet}
    </Island>
  {/snippet}
  {#snippet harbors()}
    <Island part={data.ports} view="table">
      {#snippet children(rows)}
        <HarborTable {rows} filterLabel="Filter harbors" />
      {/snippet}
    </Island>
  {/snippet}
  {#snippet berths()}
    <Island part={data.berths} render="deferred">
      {#snippet children(rows)}
        <HarborTable {rows} nameLabel="Berth" />
      {/snippet}
    </Island>
  {/snippet}
</DemoPage>
