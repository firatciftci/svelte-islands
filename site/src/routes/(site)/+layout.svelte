<script lang="ts">
  import { onNavigate } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import Mark from "#lib/components/Mark.svelte";
  import Search from "#lib/components/Search.svelte";
  import ThemeToggle from "#lib/components/ThemeToggle.svelte";

  let { data, children } = $props();

  let search = $state<Search>();

  const inDocs = $derived(
    page.url.pathname.startsWith(resolve("/(site)/docs")),
  );
  const onBenchmark = $derived(
    page.url.pathname.endsWith("appendix/benchmark"),
  );

  onNavigate((navigation) => {
    if (document.startViewTransition == null) {
      return;
    }
    return new Promise((done) => {
      document.startViewTransition(async () => {
        done();
        await navigation.complete;
      });
    });
  });

  function pressed(event: KeyboardEvent) {
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
    const wantsSearch =
      (event.key === "k" && (event.metaKey || event.ctrlKey)) ||
      (event.key === "/" && !typing);
    if (wantsSearch) {
      event.preventDefault();
      search?.open();
    }
  }

  async function clicked(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-open-search]") != null) {
      search?.open();
      return;
    }
    const button = target?.closest<HTMLElement>("[data-copy]");
    const text = button?.closest("figure")?.querySelector("pre")?.textContent;
    if (button == null || text == null) {
      return;
    }
    await navigator.clipboard.writeText(text);
    button.dataset.copied = "";
    setTimeout(() => {
      delete button.dataset.copied;
    }, 1500);
  }
</script>

<svelte:window onkeydown={pressed} onclick={clicked} />

<a class="skip" href="#content">Skip to content</a>

<header class="site-header">
  <div class="site-header-inner">
    <a class="wordmark" href={resolve("/(site)")}>
      <Mark />
      <span>svelte-islands</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <a
        href={resolve("/(site)/docs/[...slug]", {
          slug: "getting-started/introduction",
        })}
        aria-current={inDocs && !onBenchmark ? "page" : undefined}>Docs</a
      >
      <a href={`${resolve("/(site)")}#race`}>Demo</a>
      <a
        href={resolve("/(site)/docs/[...slug]", { slug: "appendix/benchmark" })}
        aria-current={onBenchmark ? "page" : undefined}>Benchmark</a
      >
    </nav>
    <div class="site-tools">
      <button type="button" class="tool search-open" data-open-search>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <span class="search-word">Search</span>
        <kbd>/</kbd>
      </button>
      <ThemeToggle />
      <a
        class="tool tool-github"
        href="https://github.com/firatciftci/svelte-islands">GitHub</a
      >
    </div>
  </div>
</header>

{@render children()}

<Search bind:this={search} index={data.search} />
