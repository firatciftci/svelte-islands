<script lang="ts">
  const { name, label }: { name: string; label: string } = $props();

  let presses = $state(0);
</script>

<p data-testid="{label}-name">{name}</p>
<button
  type="button"
  data-testid="{label}-press"
  onclick={() => {
    presses += 1;
  }}
>
  pressed {presses}
</button>
