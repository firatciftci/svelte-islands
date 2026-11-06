<script lang="ts">
  import { resolve } from "$app/paths";
  import Coast from "#lib/components/Coast.svelte";
</script>

<svelte:head>
  <title>This page isn't on the chart • svelte-islands Docs</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="missing" id="content">
  <Coast seed={11} lost>
    <h1>This page isn't on the chart</h1>
    <p>
      The link may be out of date. You can search the docs or start from the
      introduction.
    </p>
    <p class="actions">
      <a
        class="cta"
        href={resolve("/(site)/docs/[...slug]", {
          slug: "getting-started/introduction",
        })}>Go to the introduction</a
      >
      <button type="button" class="link" data-open-search
        >Search the docs</button
      >
    </p>
  </Coast>
</main>
