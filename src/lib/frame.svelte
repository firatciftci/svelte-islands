<script lang="ts">
  import type { Snippet } from "svelte";

  const { body, value }: { body: Snippet<[never]>; value: unknown } = $props();
</script>

{@render body(value as never)}
