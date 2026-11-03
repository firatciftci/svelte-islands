<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import {
    getAllContexts,
    hydrate,
    onMount,
    tick,
    unmount,
    untrack,
  } from "svelte";
  import type { Part, Strategy } from "./part.js";
  import Frame from "./frame.svelte";
  import { scope } from "./part.js";
  import {
    boot,
    capture,
    claim,
    fallback,
    Gone,
    intercept,
    isFirstGone,
    load,
    peek,
    skeletonOf,
    watch,
  } from "./runtime.js";

  const {
    part,
    view,
    when = "interaction",
    children,
    failed,
    class: className,
  }: {
    part: Part<T>;
    view?: string;
    when?: Strategy;
    children: Snippet<[T]>;
    failed?: Snippet<[retry: () => void]>;
    class?: string;
  } = $props();

  const context = getAllContexts();
  const server = scope();
  const origin = untrack(() => part);
  const key = $derived(view == null ? part.name : `${part.name}:${view}`);
  const first = untrack(() => key);
  const markup = untrack(() => {
    if (server == null) {
      return claim(origin) ? " " : null;
    }
    if (origin.isInline || origin.loaded == null) {
      return null;
    }
    const html = server.render(
      children,
      origin.loaded.value,
      context,
      `s${origin.hash.slice(0, 6).replaceAll("-", "_")}`,
    );
    server.rendered(origin, first, html);
    return html;
  });

  let isLatched = markup != null;
  let fetched = $state.raw<{ hash: string; value: T } | null>(null);
  let failure = $state<string | null>(null);
  let attempt = $state(0);

  const isAdopted = $derived.by(() => {
    if (part.hash !== origin.hash) {
      isLatched = false;
    }
    return isLatched;
  });

  const current = $derived(
    peek(part) ??
      (fetched?.hash === part.hash ? { value: fetched.value } : null),
  );

  function retry() {
    failure = null;
    attempt++;
  }

  function activate(target: HTMLElement) {
    const body = untrack(() => children);
    const held = when === "never" ? null : intercept(target);
    const stopCapture = capture(first, target);
    let instance: ReturnType<typeof hydrate> | null = null;
    let isLive = true;
    const stop = watch(target, when, () => {
      load(origin).then(
        async (value) => {
          await tick();
          if (isLive) {
            instance = hydrate(Frame, {
              target,
              props: { body, value },
              context,
            });
            target.dataset.islandState = "live";
            held?.release();
          }
        },
        () => {
          held?.stop();
        },
      );
    });
    return () => {
      isLive = false;
      stop();
      stopCapture();
      held?.stop();
      if (instance != null) {
        void unmount(instance);
      }
    };
  }

  function learn(target: HTMLElement) {
    if (current != null) {
      return capture(key, target);
    }
  }

  onMount(boot);

  $effect(() => {
    if (isAdopted || current != null) {
      return;
    }
    const target = part;
    void attempt;
    let isLive = true;
    load(target).then(
      (value) => {
        if (isLive) {
          fetched = { hash: target.hash, value };
        }
      },
      (error: unknown) => {
        if (!isLive) {
          return;
        }
        if (error instanceof Gone && isFirstGone(target.hash)) {
          void invalidateAll();
        } else {
          failure = target.hash;
        }
      },
    );
    return () => {
      isLive = false;
    };
  });
</script>

{#if isAdopted}
  <div
    class={["island", className]}
    data-island={origin.hash}
    data-island-state="static"
    {@attach activate}
  >
    <!-- svelte-ignore hydration_html_changed -->
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html markup}
  </div>
{:else}
  <div
    class={["island", className]}
    data-island={part.hash}
    aria-busy={current == null ? "true" : undefined}
    {@attach learn}
  >
    {#if current != null}
      {@render children(current.value)}
    {:else if failure === part.hash}
      {#if failed != null}
        {@render failed(retry)}
      {:else}
        <button class="island-retry" type="button" onclick={retry}>Retry</button
        >
      {/if}
    {:else}
      <div class="island-skeleton" aria-hidden="true">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html skeletonOf(key) ?? fallback(part.bytes)}
      </div>
    {/if}
  </div>
{/if}
