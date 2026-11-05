<script lang="ts">
  const { label }: { label: string } = $props();
</script>

<section data-testid={label}>
  <h2>{label} heading</h2>
  <p>{label} waited</p>
</section>
