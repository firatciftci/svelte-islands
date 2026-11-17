<script lang="ts">
  import { setContext } from "svelte";
  import { Island } from "svelte-islands";
  import { hidden, setTone } from "#lib/contexts.js";
  import Rows from "#lib/rows.svelte";
  import Tone from "#lib/tone.svelte";

  const { data } = $props();

  setContext("label", "labeled");
  setContext(hidden, "secret");
  setTone("warm");

  let count = $state(5);
  const greeting = "hello";
</script>

<svelte:head>
  <title>Shell</title>
</svelte:head>

<h1>Shell</h1>
<a href="/" data-testid="home">Home</a>

<Island part={data.staticRows}>
  {#snippet children(rows)}
    <p data-testid="shell-scope">{greeting} {count}</p>
    <button
      type="button"
      data-testid="shell-bump"
      onclick={() => {
        count += 1;
      }}
    >
      bump {count}
    </button>
    <Tone />
    <Rows {rows} label="shell-static" />
  {/snippet}
</Island>

<Island part={data.small}>
  {#snippet children(words)}
    <button
      type="button"
      data-testid="shell-small"
      onclick={() => {
        count += 1;
      }}
    >
      {words.length} {count}
    </button>
  {/snippet}
</Island>

<div style="block-size: 4000px"></div>

<Island part={data.deferredRows} render="deferred">
  {#snippet children(rows)}
    <Rows {rows} label="shell-deferred" />
  {/snippet}
</Island>

<div style="block-size: 4000px"></div>

<Island part={data.clientRows} render="client">
  {#snippet children(rows)}
    <Rows {rows} label="shell-client" />
  {/snippet}
</Island>
