<script lang="ts">
  import { Island } from "svelte-islands";

  const { data } = $props();

  let presses = $state(0);
</script>

<svelte:head>
  <title>Private</title>
</svelte:head>

<Island part={data.account} defer>
  {#snippet children(account)}
    <p data-testid="secret">{account.secret}</p>
    <button
      type="button"
      data-testid="private-press"
      onclick={() => {
        presses += 1;
      }}
    >
      pressed {presses}
    </button>
  {/snippet}
</Island>
