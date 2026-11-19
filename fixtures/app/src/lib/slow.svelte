<script lang="ts">
  import { browser } from "$app/env";

  const { count }: { count: number } = $props();
  let presses = $state(0);

  if (browser) {
    const end = performance.now() + 120;
    let spins = 0;
    while (performance.now() < end) {
      spins++;
    }
    console.debug(`spun ${spins} times`);
  }
</script>

<button type="button" data-testid="slow" onclick={() => presses++}>
  {count} rows, pressed {presses}
</button>
