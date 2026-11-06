<!--
  @component
  Shows a learned skeleton while `isPending` is true, and the content after that,
  for loading states you drive yourself.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { scope } from "./part.js";
  import { boot, capture, fallback, skeletonOf } from "./runtime.js";

  const {
    name,
    isPending,
    isStale = false,
    reserve,
    children,
    class: className,
  }: {
    /** A stable name for this content. Skeletons are learned per name. */
    name: string;
    /** Whether to show the skeleton. */
    isPending: boolean;
    /** Whether the content shown is out of date while newer content loads. */
    isStale?: boolean;
    /** The height to hold before a skeleton is known, as a CSS length. */
    reserve?: string;
    /** The finished content. */
    children?: Snippet;
    /** A class for the wrapper. */
    class?: string;
  } = $props();

  const server = scope();
  const shell = $derived(
    server?.shape(name) ?? skeletonOf(name) ?? fallback(0, reserve),
  );

  function follow(target: HTMLElement) {
    if (!isPending) {
      return capture(name, target);
    }
    const known = skeletonOf(name);
    const shown = target.querySelector(":scope > .island-shell");
    if (
      known != null &&
      shown?.querySelector(":scope > .island-fallback") != null
    ) {
      shown.innerHTML = known;
    }
  }

  onMount(boot);
</script>

<div
  class={["island", className]}
  aria-busy={isPending || isStale ? "true" : undefined}
  data-island-stale={isStale ? "" : undefined}
  {@attach follow}
>
  {#if isPending}
    <div class="island-shell island-delayed" aria-hidden="true">
      <!-- svelte-ignore hydration_html_changed -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html shell}
    </div>
  {:else}
    {@render children?.()}
  {/if}
</div>
