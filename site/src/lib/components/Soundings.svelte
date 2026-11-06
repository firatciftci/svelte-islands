<script lang="ts">
  let { marks }: { marks: Array<{ x: number; y: number; kb: string }> } =
    $props();
</script>

<div class="soundings" aria-hidden="true">
  {#each marks as mark, index (index)}
    <span style:left={`${mark.x * 100}%`} style:top={`${mark.y * 100}%`}
      >{mark.kb}</span
    >
  {/each}
</div>
