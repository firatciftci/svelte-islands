<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    summary,
    harbors,
    chart,
    berths,
  }: {
    label: string;
    summary: { movements: number; harbors: number; berths: number };
    harbors: Snippet;
    chart: Snippet;
    berths: Snippet;
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
  <h1>Harrow Sound harbor traffic</h1>
  <p>
    {summary.movements.toLocaleString("en-US")} ship movements across {summary.harbors}
    harbors and {summary.berths.toLocaleString("en-US")} berths.
  </p>
  <p class="demo-note">Every name and number here is invented.</p>
  {@render chart()}
  <section data-demo="harbors">
    <h2>Harbors</h2>
    {@render harbors()}
  </section>
  <section data-demo="berths">
    <h2>Berths</h2>
    {@render berths()}
  </section>
</main>
