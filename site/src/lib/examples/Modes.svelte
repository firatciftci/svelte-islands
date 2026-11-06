<script lang="ts">
  import { Island, type Part } from "svelte-islands";
  import Coast from "#lib/components/Coast.svelte";
  import WardTable from "#lib/components/WardTable.svelte";
  import type { Ward } from "#lib/harrow.js";

  let {
    parts,
  }: {
    parts: {
      adopted: Part<Array<Ward>>;
      deferred: Part<Array<Ward>>;
      client: Part<Array<Ward>>;
    };
  } = $props();
</script>

<Coast seed={3}>
  <p class="coast-note">
    <code>static</code> has its HTML in the page, and its data waits.
  </p>
  <Island part={parts.adopted}>
    {#snippet children(rows)}
      <WardTable {rows} limit={3} />
    {/snippet}
  </Island>
</Coast>
<Coast seed={8}>
  <p class="coast-note">
    <code>deferred</code> gets its HTML as you scroll toward it.
  </p>
  <Island part={parts.deferred} defer>
    {#snippet children(rows)}
      <WardTable {rows} limit={3} />
    {/snippet}
  </Island>
</Coast>
<Coast seed={14}>
  <p class="coast-note"><code>client</code> has no server HTML at all.</p>
  <Island part={parts.client} ssr={false}>
    {#snippet children(rows)}
      <WardTable {rows} limit={3} />
    {/snippet}
  </Island>
</Coast>
