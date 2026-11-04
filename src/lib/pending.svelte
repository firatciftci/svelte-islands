<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { scope } from "./part.js";
  import { boot, capture, fallback, skeletonOf } from "./runtime.js";

  const {
    name,
    isPending,
    reserve,
    children,
    class: className,
  }: {
    name: string;
    isPending: boolean;
    reserve?: string;
    children?: Snippet;
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
  aria-busy={isPending ? "true" : undefined}
  {@attach follow}
>
  {#if isPending}
    <div class="island-shell" aria-hidden="true">
      <!-- svelte-ignore hydration_html_changed -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html shell}
    </div>
  {:else}
    {@render children?.()}
  {/if}
</div>
