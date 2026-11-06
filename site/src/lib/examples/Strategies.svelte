<script lang="ts">
  import { Island, type Part } from "svelte-islands";
  import Coast from "#lib/components/Coast.svelte";
  import WardTable from "#lib/components/WardTable.svelte";
  import type { Ward } from "#lib/harrow.js";

  let {
    parts,
  }: {
    parts: {
      visible: Part<Array<Ward>>;
      idle: Part<Array<Ward>>;
      interaction: Part<Array<Ward>>;
      media: Part<Array<Ward>>;
      eager: Part<Array<Ward>>;
      never: Part<Array<Ward>>;
    };
  } = $props();
</script>

{#snippet table(rows: Array<Ward>)}
  <WardTable {rows} limit={2} />
{/snippet}

<div class="strategies">
  <Coast seed={21}>
    <p class="coast-note"><code>eager</code> wakes as soon as it can.</p>
    <Island part={parts.eager} when="eager" children={table} />
  </Coast>
  <Coast seed={22}>
    <p class="coast-note"><code>idle</code> waits for a quiet moment.</p>
    <Island part={parts.idle} when="idle" children={table} />
  </Coast>
  <Coast seed={23}>
    <p class="coast-note"><code>visible</code> wakes as you scroll to it.</p>
    <Island part={parts.visible} when="visible" children={table} />
  </Coast>
  <Coast seed={24}>
    <p class="coast-note"><code>interaction</code> waits for your pointer.</p>
    <Island part={parts.interaction} when="interaction" children={table} />
  </Coast>
  <Coast seed={25}>
    <p class="coast-note"><code>media</code> wakes in a narrow window.</p>
    <Island
      part={parts.media}
      when="media"
      media="(max-width: 40rem)"
      children={table}
    />
  </Coast>
  <Coast seed={26}>
    <p class="coast-note"><code>never</code> stays as it is.</p>
    <Island part={parts.never} when="never" children={table} />
  </Coast>
</div>
