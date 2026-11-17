<script lang="ts">
  import { Island, type Part } from "svelte-islands";
  import Coast from "#lib/components/Coast.svelte";
  import HarborTable from "#lib/components/HarborTable.svelte";
  import type { Harbor } from "#lib/harrow.js";

  let {
    parts,
  }: {
    parts: {
      adopted: Part<Array<Harbor>>;
      deferred: Part<Array<Harbor>>;
      client: Part<Array<Harbor>>;
    };
  } = $props();
</script>

<Coast>
  <p class="coast-note">
    <code>static</code> has its HTML in the page, and its data waits.
  </p>
  <Island part={parts.adopted}>
    {#snippet children(rows)}
      <HarborTable {rows} limit={3} />
    {/snippet}
  </Island>
</Coast>
<Coast>
  <p class="coast-note">
    <code>deferred</code> gets its HTML as you scroll toward it.
  </p>
  <Island part={parts.deferred} render="deferred">
    {#snippet children(rows)}
      <HarborTable {rows} limit={3} />
    {/snippet}
  </Island>
</Coast>
<Coast>
  <p class="coast-note"><code>client</code> has no server HTML at all.</p>
  <Island part={parts.client} render="client">
    {#snippet children(rows)}
      <HarborTable {rows} limit={3} />
    {/snippet}
  </Island>
</Coast>
