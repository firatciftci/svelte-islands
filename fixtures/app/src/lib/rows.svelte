<script lang="ts">
  import type { Row } from "#lib/data.js";

  const { rows, label }: { rows: Array<Row>; label: string } = $props();

  let presses = $state(0);
</script>

<section aria-labelledby="{label}-heading" data-testid={label}>
  <h2 id="{label}-heading">{label} heading</h2>
  <button
    type="button"
    data-testid="{label}-press"
    onclick={() => {
      presses += 1;
    }}
  >
    pressed {presses}
  </button>
  <table>
    <tbody>
      {#each rows as row (row.id)}
        <tr>
          <td>{row.name}</td>
          <td>{row.votes}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
