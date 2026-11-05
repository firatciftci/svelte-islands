---
title: Clicks before hydration
---

If someone clicks a button inside an island before it has hydrated, the island holds the click, hydrates, and replays it as a full press. You don't need to do anything for this to work, and controls that open on pointer events respond too.

There's one gap. An island can only hold a click once its code has loaded, and a click can land before any of your code has loaded. On a slow connection that window can last a few seconds.

To keep that click as well, you can remember it in a small inline script in `app.html`...

```html
<!--- file: src/app.html --->
<script>
  (() => {
    let early = null;
    const hold = (event) => {
      const target = event.target.closest?.('button, [role="button"]');
      if (
        target &&
        target.closest("a[href]") == null &&
        !(target.type === "submit" && target.form != null)
      )
        early = { event, target };
    };
    addEventListener("click", hold, true);
    window.takeEarlyClick = () => {
      removeEventListener("click", hold, true);
      return early;
    };
  })();
</script>
```

...then pass it to `replay(target, press)` when your root layout hydrates:

```svelte
<!--- file: src/routes/+layout.svelte --->
<script>
  import { replay } from "svelte-islands";

  $effect(() => {
    const early = window.takeEarlyClick();
    if (early?.target.isConnected) {
      replay(early.target, early.event);
    }
  });
</script>
```

The script skips links and submit buttons, because the browser has already acted on those clicks.

`replay` dispatches the pointer, mouse, and click events of a real press, in order, with the original coordinates and modifier keys. A click from the keyboard or a screen reader has a `detail` of 0, and `replay` repeats it with `target.click()`.
