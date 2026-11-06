<script lang="ts">
  import { Island } from "svelte-islands";
  import DemoPage from "#lib/components/DemoPage.svelte";
  import TurnoutChart from "#lib/components/TurnoutChart.svelte";
  import WardTable from "#lib/components/WardTable.svelte";

  let { data } = $props();
</script>

<DemoPage label="Islands page" summary={data.summary}>
  {#snippet chart()}
    <Island part={data.districts} view="chart" ssr={false}>
      {#snippet children(rows)}
        <TurnoutChart {rows} title="Turnout by district" />
      {/snippet}
    </Island>
  {/snippet}
  {#snippet districts()}
    <Island part={data.districts} view="table">
      {#snippet children(rows)}
        <WardTable {rows} nameLabel="District" filterLabel="Filter districts" />
      {/snippet}
    </Island>
  {/snippet}
  {#snippet places()}
    <Island part={data.places} defer>
      {#snippet children(rows)}
        <WardTable {rows} nameLabel="Polling place" />
      {/snippet}
    </Island>
  {/snippet}
</DemoPage>
