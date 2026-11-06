<script lang="ts">
  import { Await } from "svelte-islands";

  const { data } = $props();
</script>

<svelte:head>
  <title>Streaming</title>
</svelte:head>

<h1>Streaming</h1>

<nav>
  <a data-testid="same" href="/streaming?topic={data.topic}&view=2"
    >Same topic</a
  >
  <a data-testid="other" href="/streaming?topic=b">Other topic</a>
  <a data-testid="soon" href="/streaming?topic=c&slow=200">Soon</a>
  <a data-testid="deep" href="/streaming?topic=d#deep">Deep</a>
</nav>

<Await promise={data.quick} name="streaming.quick">
  {#snippet children(text)}
    <p data-testid="quick">{text}</p>
  {/snippet}
</Await>

<Await
  promise={data.body}
  name="streaming.body"
  key={data.topic}
  reserve="20rem"
  class="body-wrap"
>
  {#snippet children(body)}
    <section data-testid="body" data-view={body.view}>
      {#each body.lines as line (line)}
        <p>{line}</p>
      {/each}
      <h2 id="deep">Deep</h2>
    </section>
  {/snippet}
</Await>

{#if data.broken != null}
  <Await promise={data.broken} name="streaming.broken">
    {#snippet children()}
      <p>never</p>
    {/snippet}
    {#snippet failed()}
      <p data-testid="failed">failed</p>
    {/snippet}
  </Await>
{/if}
