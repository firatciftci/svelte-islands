<script lang="ts">
  import { Island } from "svelte-islands";

  const { data } = $props();
  const SIZE = 100;
  const CHUNKS = ["0", "1", "2"];
  let picked = $state("none");
</script>

<svelte:head>
  <title>Table</title>
</svelte:head>

<h1>Table</h1>
<p data-picked>{picked}</p>

<table>
  <thead>
    <tr><th>Name</th><th>Votes</th></tr>
  </thead>
  {#each CHUNKS as chunk (chunk)}
    <Island part={data.rows} view={chunk} as="tbody" when="visible">
      {#snippet children(rows)}
        {#each rows.slice(Number(chunk) * SIZE, (Number(chunk) + 1) * SIZE) as row (row.id)}
          <tr>
            <td>
              <button
                type="button"
                onclick={() => {
                  picked = row.name;
                }}>{row.name}</button
              >
            </td>
            <td>{row.votes}</td>
          </tr>
        {/each}
      {/snippet}
    </Island>
  {/each}
</table>
