<script lang="ts">
  type Heading = { id: string; text: string; level: 2 | 3 };
  type Demo = {
    state: "waiting" | "static" | "partial" | "live";
    target: HTMLElement;
  };

  let { headings, leftOut }: { headings: Array<Heading>; leftOut: number } =
    $props();

  let chart = $state<HTMLElement>();
  let demos = $state.raw<Record<string, Array<Demo>>>({});
  let current = $state<string | null>(null);

  function stateOf(target: HTMLElement): Demo["state"] {
    if (target.querySelector(".berths > tbody:not(.island)") != null) {
      return "live";
    }
    let isLive = false;
    let isStatic = false;
    for (const island of target.querySelectorAll<HTMLElement>(".island")) {
      const named = island.dataset.islandState;
      if (
        island.getAttribute("aria-busy") === "true" ||
        named === "deferred" ||
        named === "client"
      ) {
        return "waiting";
      }
      if (named === "static") {
        isStatic = true;
      } else {
        isLive = true;
      }
    }
    if (isLive && isStatic) {
      return "partial";
    }
    return isLive ? "live" : "static";
  }

  function measure() {
    const anchors = headings.map(({ id }) => document.getElementById(id));
    const found: Record<string, Array<Demo>> = {};
    for (const target of document.querySelectorAll<HTMLElement>(
      "[data-coast]",
    )) {
      let owner: string | null = null;
      for (const [index, anchor] of anchors.entries()) {
        if (
          anchor != null &&
          anchor.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ) {
          owner = headings[index]?.id ?? null;
        }
      }
      if (owner != null) {
        (found[owner] ??= []).push({ state: stateOf(target), target });
      }
    }
    demos = found;
  }

  function mark(heading: Heading, isMarked: boolean) {
    for (const demo of demos[heading.id] ?? []) {
      demo.target.classList.toggle("coast-hover", isMarked);
    }
  }

  $effect(() => {
    void headings;
    const changed = new MutationObserver(measure);
    changed.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-island-state", "aria-busy"],
      childList: true,
    });
    measure();
    return () => changed.disconnect();
  });

  $effect(() => {
    const ids = headings.map(({ id }) => id);
    current = ids[0] ?? null;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const {
          target,
          isIntersecting,
          boundingClientRect,
          rootBounds,
        } of entries) {
          if (isIntersecting) {
            current = target.id;
          } else if (
            target.id === current &&
            rootBounds != null &&
            boundingClientRect.top > rootBounds.bottom
          ) {
            current = ids[ids.indexOf(target.id) - 1] ?? ids[0] ?? null;
          }
        }
      },
      { rootMargin: "-10% 0px -75% 0px" },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element != null) {
        seen.observe(element);
      }
    }
    return () => seen.disconnect();
  });

  $effect(() => {
    if (current == null || chart == null) {
      return;
    }
    const link = chart.querySelector(
      `[data-rail-item="${CSS.escape(current)}"]`,
    );
    if (link != null && chart.scrollHeight > chart.clientHeight) {
      link.scrollIntoView({ block: "nearest" });
    }
  });
</script>

<aside class="rail" aria-labelledby="rail-title">
  <h2 class="rail-title" id="rail-title">On this page</h2>
  <ol class="rail-list" bind:this={chart}>
    {#each headings as heading (heading.id)}
      {const shown = $derived(demos[heading.id] ?? [])}
      <li
        class={{ "rail-item": true, "rail-item-3": heading.level === 3 }}
        data-rail-item={heading.id}
      >
        <a
          href={`#${heading.id}`}
          aria-current={heading.id === current ? "location" : undefined}
          onpointerenter={() => mark(heading, true)}
          onpointerleave={() => mark(heading, false)}
          onfocus={() => mark(heading, true)}
          onblur={() => mark(heading, false)}
          >{heading.text}{#if shown.length > 0}<span
              class="rail-demos"
              aria-hidden="true"
              >{#each shown as demo, index (index)}<i
                  class="rail-demo"
                  data-state={demo.state}
                ></i>{/each}</span
            >{/if}</a
        >
      </li>
    {/each}
  </ol>
  {#if leftOut > 0}
    <p class="rail-foot">
      {leftOut.toFixed(1)} KB of this page's text isn't sent a second time as data.
    </p>
  {/if}
</aside>
