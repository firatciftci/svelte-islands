<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { tick } from "svelte";
  import { Island, load } from "svelte-islands";
  import Meta from "#lib/components/Meta.svelte";
  import Modes from "#lib/examples/Modes.svelte";
  import Strategies from "#lib/examples/Strategies.svelte";
  import Rail from "#lib/components/Rail.svelte";

  let { data } = $props();

  const leftOut = $derived.by(() => {
    let bytes = 0;
    for (const segment of data.segments) {
      if (segment.kind === "html" && !segment.part.isInline) {
        bytes += segment.part.bytes;
      }
    }
    return bytes / 1024;
  });

  const plainHref = $derived(
    resolve("/(site)/docs/[...slug]/llms.txt", { slug: data.slug }),
  );

  let copied = $state(false);

  async function copyPage() {
    const answer = await fetch(plainHref);
    await navigator.clipboard.writeText(await answer.text());
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1500);
  }

  afterNavigate(async ({ to }) => {
    const hash = to?.url.hash.slice(1);
    if (hash == null || hash === "" || document.getElementById(hash) != null) {
      return;
    }
    const waiting: Array<Promise<unknown>> = [];
    for (const segment of data.segments) {
      if (segment.kind === "html") {
        waiting.push(load(segment.part));
      }
    }
    await Promise.all(waiting);
    await tick();
    document.getElementById(hash)?.scrollIntoView();
  });
</script>

<Meta
  title={`${data.title} • svelte-islands Docs`}
  description={data.description}
  path={`/docs/${data.slug}`}
/>

<svelte:head>
  <link rel="alternate" type="text/markdown" href={plainHref} />
</svelte:head>

<main class="content" id="content">
  <div class="content-column">
    <p class="crumbs">{data.section}</p>
    <h1>{data.title}</h1>
    {#if data.headings.length > 0}
      <details class="rail-phone">
        <summary>On this page</summary>
        <ol>
          {#each data.headings as heading (heading.id)}
            <li class:sub={heading.level === 3}>
              <a href={`#${heading.id}`}>{heading.text}</a>
            </li>
          {/each}
        </ol>
      </details>
    {/if}
    {#key data.slug}
      <div class="prose">
        {#each data.segments as segment, index (index)}
          {#if segment.kind === "html"}
            <Island part={segment.part} when="never">
              {#snippet children(html)}
                {@html html}
              {/snippet}
            </Island>
          {:else if segment.name === "modes" && data.modes != null}
            <Modes parts={data.modes} />
          {:else if segment.name === "strategies" && data.strategies != null}
            <Strategies parts={data.strategies} />
          {/if}
        {/each}
      </div>
    {/key}
    <footer class="page-end">
      <div class="page-links">
        {#if data.file != null}
          <a
            href={`https://github.com/firatciftci/svelte-islands/edit/main/${data.file}`}
            >Edit this page on GitHub</a
          >
        {/if}
        <button type="button" class="page-copy" onclick={copyPage}>
          {copied ? "Copied" : "Copy this page as Markdown"}
        </button>
        <a href={plainHref}>View this page as plain text</a>
      </div>
      <nav class="pager" aria-label="Previous and next">
        {#if data.previous != null}
          <a
            href={resolve("/(site)/docs/[...slug]", {
              slug: data.previous.slug,
            })}
          >
            <span>Previous</span>
            <strong>{data.previous.title}</strong>
          </a>
        {/if}
        {#if data.next != null}
          <a
            class="next"
            href={resolve("/(site)/docs/[...slug]", { slug: data.next.slug })}
          >
            <span>Next</span>
            <strong>{data.next.title}</strong>
          </a>
        {/if}
      </nav>
    </footer>
  </div>
</main>
{#key data.slug}
  <Rail headings={data.headings} {leftOut} />
{/key}
