<script lang="ts">
  import type { Snippet } from "svelte";

  const {
    body,
    value,
    scope,
    onready,
  }: {
    body: Snippet<[never, never]>;
    value: unknown;
    scope?: unknown;
    onready?: () => void;
  } = $props();

  $effect(() => {
    onready?.();
  });
</script>

{@render body(value as never, scope as never)}
