<script lang="ts">
  import Fresh from "#lib/fresh.svelte";

  const { data } = $props();
</script>

<Fresh visitor={data.visitor} basket={data.basket} />
