---
title: Overlay
---

Render `Devtools` in development to see every island on your page, with its state, data size, and timings:

```svelte
<!--- file: src/routes/+layout.svelte --->
<script>
  import { dev } from "$app/env";
  import Devtools from "svelte-islands/devtools";
</script>

{#if dev}
  <Devtools />
{/if}
```

It flags three things:

- failed downloads
- parts over 256 KiB
- skeletons that were off by more than 16 pixels

You can change the last two limits with its `large` and `shift` props:

```svelte
<Devtools large={512} shift={8} />
```
