<script lang="ts">
  import { onMount } from "svelte";
  import { Island } from "svelte-islands";
  import Rows from "#lib/rows.svelte";

  const { data } = $props();

  let isControlled = $state(false);

  onMount(() => {
    void navigator.serviceWorker.register("/service-worker.js");
    isControlled = navigator.serviceWorker.controller != null;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      isControlled = true;
    });
  });
</script>

<h1 data-testid="controlled">{isControlled ? "Controlled" : "Waiting"}</h1>

<Island part={data.rows}>
  {#snippet children(rows)}
    <Rows {rows} label="offline" />
  {/snippet}
</Island>

<Island part={data.later} defer>
  {#snippet children(rows)}
    <Rows {rows} label="later" />
  {/snippet}
</Island>
