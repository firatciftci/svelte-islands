<script lang="ts">
  import { spread } from "#lib/spread.js";

  type Heading = { id: string; text: string; level: 2 | 3; at: number };
  type Land = {
    top: number;
    size: number;
    state: "waiting" | "static" | "live";
    target: HTMLElement;
  };

  let { headings, leftOut }: { headings: Array<Heading>; leftOut: number } =
    $props();

  const LINE = 19;
  const GAP = 6;
  const NOMINAL = 640;
  const LABEL = 28;

  const sizes = $derived(
    headings.map(({ text }) => (text.length > LABEL ? 2 * LINE : LINE) + GAP),
  );
  const minimum = $derived.by(() => {
    let total = 0;
    for (const size of sizes) {
      total += size;
    }
    return total;
  });
  const nominal = $derived(Math.max(NOMINAL, minimum));
  const estimated = $derived(
    spread(
      headings.map((heading, index) => ({
        at: heading.at * nominal,
        size: sizes[index] ?? LINE,
      })),
      nominal,
    ).map((position) => position / nominal),
  );

  let scale = $state<HTMLElement>();
  let chart = $state<HTMLElement>();
  let shifts = $state.raw<Array<number>>([]);
  let lands = $state.raw<Array<Land>>([]);
  let win = $state(0);
  let current = $state<string | null>(null);

  function landState(target: HTMLElement): Land["state"] {
    const islands = target.querySelectorAll<HTMLElement>(".island");
    let state: Land["state"] = "live";
    for (const island of islands) {
      const named = island.dataset.islandState;
      if (
        island.getAttribute("aria-busy") === "true" ||
        named === "deferred" ||
        named === "client"
      ) {
        return "waiting";
      }
      if (named === "static") {
        state = "static";
      }
    }
    return state;
  }

  function measure() {
    if (scale == null) {
      return;
    }
    const height = scale.clientHeight;
    const total = document.documentElement.scrollHeight;
    const items = [...scale.querySelectorAll<HTMLElement>("[data-rail-item]")];
    const placed = spread(
      headings.map((heading, index) => {
        const element = document.getElementById(heading.id);
        const y =
          element == null
            ? heading.at
            : (element.getBoundingClientRect().top + scrollY) / total;
        return {
          at: y * height,
          size: (items[index]?.offsetHeight ?? LINE) + GAP,
        };
      }),
      height,
    );
    shifts = placed.map(
      (position, index) => position - (estimated[index] ?? 0) * height,
    );
    lands = [...document.querySelectorAll<HTMLElement>("[data-coast]")].map(
      (target) => {
        const box = target.getBoundingClientRect();
        return {
          top: ((box.top + scrollY) / total) * height,
          size: Math.max(14, (box.height / total) * height),
          state: landState(target),
          target,
        };
      },
    );
    win = Math.min(1, innerHeight / total);
  }

  $effect(() => {
    void headings;
    if (scale == null) {
      return;
    }
    const resized = new ResizeObserver(measure);
    resized.observe(document.documentElement);
    resized.observe(scale);
    const changed = new MutationObserver(measure);
    changed.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-island-state", "aria-busy"],
    });
    addEventListener("resize", measure);
    measure();
    return () => {
      resized.disconnect();
      changed.disconnect();
      removeEventListener("resize", measure);
    };
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

  $effect(() => {
    if (CSS.supports("animation-timeline", "scroll()") || scale == null) {
      return;
    }
    let pending = 0;
    const update = () => {
      pending = 0;
      const room = document.documentElement.scrollHeight - innerHeight;
      scale?.style.setProperty("--read", String(room > 0 ? scrollY / room : 0));
    };
    const scrolled = () => {
      if (pending === 0) {
        pending = requestAnimationFrame(update);
      }
    };
    addEventListener("scroll", scrolled, { passive: true });
    update();
    return () => {
      removeEventListener("scroll", scrolled);
      cancelAnimationFrame(pending);
    };
  });

  function go(land: Land) {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    land.target.scrollIntoView({
      block: "center",
      behavior: calm ? "auto" : "smooth",
    });
  }
</script>

<aside class="rail" aria-labelledby="rail-title">
  <h2 class="rail-title" id="rail-title">On this page</h2>
  <div class="rail-chart" bind:this={chart}>
    <div
      class="rail-scale"
      bind:this={scale}
      style:--minimum={`${minimum}px`}
      style:--win={win}
    >
      <div class="rail-track" aria-hidden="true"></div>
      <div class="rail-course" aria-hidden="true"></div>
      <div class="rail-window" aria-hidden="true"></div>
      {#each lands as land, index (index)}
        <button
          type="button"
          class="rail-land"
          tabindex="-1"
          aria-hidden="true"
          data-state={land.state}
          style:top={`${land.top}px`}
          style:block-size={`${land.size}px`}
          onclick={() => go(land)}
          onpointerenter={() => land.target.classList.add("coast-hover")}
          onpointerleave={() => land.target.classList.remove("coast-hover")}
        ></button>
      {/each}
      <ol class="rail-list">
        {#each headings as heading, index (heading.id)}
          <li
            class="rail-item"
            class:rail-item-3={heading.level === 3}
            style:top={`${(estimated[index] ?? 0) * 100}%`}
            style:--shift={`${shifts[index] ?? 0}px`}
            data-rail-item={heading.id}
          >
            <a
              href={`#${heading.id}`}
              aria-current={heading.id === current ? "location" : undefined}
              >{heading.text}</a
            >
          </li>
        {/each}
      </ol>
    </div>
  </div>
  {#if leftOut > 0}
    <p class="rail-foot">
      {leftOut.toFixed(1)} KB of this page's text isn't sent a second time as data.
    </p>
  {/if}
  <svg
    width="0"
    height="0"
    class="coast-filter"
    aria-hidden="true"
    focusable="false"
  >
    <filter
      id="rail-coast"
      x="-30%"
      y="-30%"
      width="160%"
      height="160%"
      color-interpolation-filters="sRGB"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.08"
        numOctaves="2"
        seed="4"
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale="7"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </svg>
</aside>
