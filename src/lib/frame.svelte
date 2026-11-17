<script lang="ts">
  import type { Snippet } from "svelte";

  const {
    body,
    value,
    scope,
  }: { body: Snippet<[never, never]>; value: unknown; scope?: unknown } =
    $props();
</script>

{@render body(value as never, scope as never)}
