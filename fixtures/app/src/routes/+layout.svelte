<script lang="ts">
  import "svelte-islands/styles.css";
  import { browser } from "$app/env";
  import { onMount } from "svelte";
  import { observe } from "svelte-islands";
  import type { Observation } from "svelte-islands";

  const { children } = $props();

  if (browser) {
    const events: Array<Observation> = [];
    Object.assign(window, { islandEvents: events });
    observe((event) => {
      events.push(event);
    });
  }

  onMount(() => {
    document.documentElement.dataset.hydrated = "true";
  });
</script>

{@render children()}
