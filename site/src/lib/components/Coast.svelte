<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    lost = false,
    onreach,
    children,
  }: { lost?: boolean; onreach?: () => void; children: Snippet } = $props();

  let ground = $state<HTMLElement>();

  function reach(element: HTMLElement) {
    function point(x: number, y: number) {
      if (ground == null) {
        return;
      }
      const box = ground.getBoundingClientRect();
      element.style.setProperty("--tide-x", `${x - box.left}px`);
      element.style.setProperty("--tide-y", `${y - box.top}px`);
      onreach?.();
    }
    const pointed = (event: PointerEvent) => {
      point(event.clientX, event.clientY);
    };
    const focused = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        const box = event.target.getBoundingClientRect();
        point(box.left + box.width / 2, box.top + box.height / 2);
      }
    };
    element.addEventListener("pointerenter", pointed);
    element.addEventListener("focusin", focused);
    return () => {
      element.removeEventListener("pointerenter", pointed);
      element.removeEventListener("focusin", focused);
    };
  }
</script>

<div class={["coast", { "coast-lost": lost }]} data-coast {@attach reach}>
  <div class="coast-land" aria-hidden="true">
    <div class="coast-shoal-outer"></div>
    <div class="coast-shoal-inner"></div>
    <div class="coast-drying"></div>
    <div class="coast-ground" bind:this={ground}></div>
  </div>
  {#if !lost}
    <span class="coast-tag" aria-hidden="true"></span>
  {/if}
  <div class="coast-body">
    {@render children()}
  </div>
</div>
