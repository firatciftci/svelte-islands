<script lang="ts">
  const { label }: { label: string } = $props();

  const words = $derived(
    await new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(`${label} waited`);
      }, 20);
    }),
  );
</script>

<section data-testid={label}>
  <h2>{label} heading</h2>
  <p>{words}</p>
</section>
