<script lang="ts">
  import "svelte-islands/styles.css";
  import "../app.css";

  let { children } = $props();
</script>

{@render children()}
