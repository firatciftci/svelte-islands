<script lang="ts">
  import DemoPage from "#lib/components/DemoPage.svelte";
  import TurnoutChart from "#lib/components/TurnoutChart.svelte";
  import WardTable from "#lib/components/WardTable.svelte";

  let { data } = $props();
</script>

<DemoPage label="Plain SvelteKit page" summary={data.summary}>
  {#snippet chart()}
    <TurnoutChart rows={data.districts} title="Turnout by district" />
  {/snippet}
  {#snippet districts()}
    <WardTable
      rows={data.districts}
      nameLabel="District"
      filterLabel="Filter districts"
    />
  {/snippet}
  {#snippet places()}
    <WardTable rows={data.places} nameLabel="Polling place" />
  {/snippet}
</DemoPage>
