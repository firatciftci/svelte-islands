<script lang="ts">
  import { afterNavigate } from "$app/navigation";

  const GAP = 6;
  const EDGE = 8;
  const SHOW_AFTER = 150;
  const HIDE_AFTER = 200;

  let symbol = $state.raw<Element | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  afterNavigate(() => hide());

  function present(tip: HTMLElement) {
    const isOpen = tip.matches(":popover-open");
    const index = Number(symbol?.getAttribute("data-tip"));
    const source = symbol?.closest("figure")?.querySelector("template")?.content
      .children[index];
    if (source == null) {
      if (isOpen) {
        tip.hidePopover();
      }
      return;
    }
    tip.replaceChildren(source.cloneNode(true));
    if (!isOpen) {
      tip.showPopover();
    }
    const anchor = symbol?.getBoundingClientRect();
    if (anchor == null) {
      return;
    }
    const below = anchor.bottom + GAP;
    const fits = below + tip.offsetHeight <= window.innerHeight - EDGE;
    const widest = document.documentElement.clientWidth - tip.offsetWidth;
    tip.style.top = `${fits ? below : Math.max(EDGE, anchor.top - GAP - tip.offsetHeight)}px`;
    tip.style.left = `${Math.max(EDGE, Math.min(anchor.left, widest - EDGE))}px`;
  }

  function later(delay: number, action: () => void) {
    clearTimeout(timer);
    timer = setTimeout(action, delay);
  }

  function show(target: Element) {
    clearTimeout(timer);
    symbol = target;
  }

  function hide() {
    clearTimeout(timer);
    symbol = null;
  }

  function entered(event: PointerEvent) {
    if (event.pointerType === "touch" || !(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest("[data-tip]");
    if (event.target.closest(".type-tip") != null || target === symbol) {
      clearTimeout(timer);
    } else if (target != null) {
      later(symbol == null ? SHOW_AFTER : 0, () => show(target));
    }
  }

  function left(event: PointerEvent) {
    if (event.pointerType === "touch" || !(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest(".type-tip, [data-tip]") != null) {
      later(HIDE_AFTER, hide);
    }
  }

  function clicked(event: MouseEvent) {
    if (
      !(event.target instanceof Element) ||
      event.target.closest(".type-tip") != null
    ) {
      return;
    }
    const target = event.target.closest("[data-tip]");
    if (target == null) {
      hide();
    } else {
      show(target);
    }
  }

  function pressed(event: KeyboardEvent) {
    if (event.key === "Escape") {
      hide();
    }
  }

  function scrolled(event: Event) {
    if (
      !(event.target instanceof Element) ||
      event.target.closest(".type-tip") == null
    ) {
      hide();
    }
  }
</script>

<svelte:window
  onpointerover={entered}
  onpointerout={left}
  onclick={clicked}
  onkeydown={pressed}
  onscrollcapture={scrolled}
/>

<div class="type-tip" popover="manual" {@attach present}></div>
