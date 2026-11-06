<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    summary,
    districts,
    chart,
    places,
  }: {
    label: string;
    summary: { votes: number; districts: number; places: number };
    districts: Snippet;
    chart: Snippet;
    places: Snippet;
  } = $props();

  $effect(() => {
    if (!location.search.includes("race")) {
      return;
    }
    const tasks: Array<number> = [];
    const canCount =
      PerformanceObserver.supportedEntryTypes.includes("longtask");
    const watcher = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tasks.push(entry.duration);
      }
    });
    if (canCount) {
      watcher.observe({ type: "longtask", buffered: true });
    }
    function report() {
      const [page] = performance.getEntriesByType("navigation");
      const html =
        page instanceof PerformanceNavigationTiming ? page.encodedBodySize : 0;
      let total = html;
      for (const entry of performance.getEntriesByType("resource")) {
        if (entry instanceof PerformanceResourceTiming) {
          total += entry.encodedBodySize;
        }
      }
      let blocking = 0;
      for (const duration of tasks) {
        blocking += duration - 50;
      }
      parent.postMessage(
        { kind: "race", html, total, tasks: tasks.length, blocking, canCount },
        location.origin,
      );
    }
    let timer = 0;
    function settle() {
      timer = window.setTimeout(report, 1500);
    }
    if (document.readyState === "complete") {
      settle();
    } else {
      addEventListener("load", settle, { once: true });
    }
    return () => {
      clearTimeout(timer);
      removeEventListener("load", settle);
      watcher.disconnect();
    };
  });
</script>

<svelte:head>
  <title>{label} • svelte-islands Docs</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="demo" id="content">
  <h1>Harrow Sound general election</h1>
  <p>
    {summary.votes.toLocaleString("en-US")} votes across {summary.districts} districts
    and {summary.places.toLocaleString("en-US")} polling places.
  </p>
  <p class="demo-note">Every name and number here is invented.</p>
  {@render chart()}
  <section data-demo="districts">
    <h2>Districts</h2>
    {@render districts()}
  </section>
  <section data-demo="places">
    <h2>Polling places</h2>
    {@render places()}
  </section>
</main>
