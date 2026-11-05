<script lang="ts">
  import "svelte-islands/styles.css";

  const { children } = $props();
</script>

{@render children()}
