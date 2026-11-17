<script lang="ts">
  import { getContext } from "svelte";
  import { getTone, hidden } from "#lib/contexts.js";

  const label = getContext<string>("label");
  const tone = getTone();
  const secret = getContext<string | undefined>(hidden);
</script>

<p data-testid="tone">{label} {tone} {secret ?? "none"}</p>
