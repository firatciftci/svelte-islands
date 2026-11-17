<script lang="ts">
  import { Island, type Part } from "svelte-islands";
  import Coast from "#lib/components/Coast.svelte";
  import HarborTable from "#lib/components/HarborTable.svelte";
  import OnTimeChart from "#lib/components/OnTimeChart.svelte";
  import type { Harbor } from "#lib/harrow.js";

  let { parts }: { parts: { harbors: Part<Array<Harbor>> } } = $props();
</script>

<Coast>
  <p class="coast-note">
    The chart and the table share one part, so whichever wakes first downloads
    it for both.
  </p>
  <Island part={parts.harbors} view="chart" hydrate="visible">
    {#snippet children(rows)}
      <OnTimeChart {rows} title="On time at the busiest harbors" count={6} />
    {/snippet}
  </Island>
</Coast>
<Coast>
  <p class="coast-note">
    The table stays static until you reach for it, even after the chart is live.
  </p>
  <Island part={parts.harbors} view="table">
    {#snippet children(rows)}
      <HarborTable {rows} limit={5} />
    {/snippet}
  </Island>
</Coast>
