<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    seed = 1,
    lost = false,
    onreach,
    children,
  }: {
    seed?: number;
    lost?: boolean;
    onreach?: () => void;
    children: Snippet;
  } = $props();

  const uid = $props.id();

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

<div class="coast" class:coast-lost={lost} data-coast {@attach reach}>
  <svg
    width="0"
    height="0"
    class="coast-filter"
    aria-hidden="true"
    focusable="false"
  >
    <filter
      id={`coast-${uid}`}
      x="-5%"
      y="-5%"
      width="110%"
      height="110%"
      color-interpolation-filters="sRGB"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.016"
        numOctaves="2"
        {seed}
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale="22"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </svg>
  <div
    class="coast-land"
    style:filter={`url(#coast-${uid})`}
    aria-hidden="true"
  >
    <div class="coast-shoal-outer"></div>
    <div class="coast-shoal-inner"></div>
    <div class="coast-drying"></div>
    <div class="coast-ground" bind:this={ground}></div>
  </div>
  <div class="coast-body">
    {@render children()}
  </div>
</div>
