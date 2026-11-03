<script lang="ts">
  import type { Snippet } from "svelte";

  const { body, value }: { body: Snippet<[never]>; value: unknown } = $props();
</script>

<div class="island-body">{@render body(value as never)}</div>
