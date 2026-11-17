<script lang="ts">
  import type { Row } from "#lib/data.js";

  const { rows }: { rows: Array<Row> } = $props();

  let name = $state("");
  let note = $state("");
  let harbor = $state("north");
  let isUrgent = $state(false);
  let sent = $state<string | null>(null);
</script>

<form
  data-testid="form"
  onsubmit={(event) => {
    event.preventDefault();
    sent = `${name}|${note}|${harbor}|${isUrgent}`;
  }}
>
  <input name="name" aria-label="Name" bind:value={name} />
  <input
    name="note"
    aria-label="Note"
    value={note}
    oninput={(event) => {
      note = event.currentTarget.value;
    }}
  />
  <select name="harbor" aria-label="Harbor" bind:value={harbor}>
    <option value="north">North</option>
    <option value="south">South</option>
  </select>
  <label>
    <input type="checkbox" name="urgent" bind:checked={isUrgent} />
    Urgent
  </label>
  <button type="submit">Send</button>
</form>
<p data-testid="echo">{name}|{note}|{harbor}|{isUrgent}</p>
<p data-testid="sent">{sent ?? "unsent"}</p>
<p>{rows.length} rows</p>
