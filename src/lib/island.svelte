<!--
  @component
  Renders a part's value with its own loading and hydration. The server sends
  HTML, and the browser loads the data and the code only when `hydrate` says so.

  ```svelte
  <Island part={data.rows} hydrate="visible">
    {#snippet children(rows)}
      <Rows {rows} />
    {/snippet}
  </Island>
  ```
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { dev } from "$app/env";
  import { refreshAll } from "$app/navigation";
  import { flushSync, getAllContexts, onMount, untrack } from "svelte";
  import type { Adopted, Part, Render, Strategy } from "./part.js";
  import type { Body, Chunk, Control, Wake } from "./wake.js";
  import Frame from "./frame.svelte";
  import { scope as serverScope } from "./part.js";
  import {
    boot,
    capture,
    claim,
    fallback,
    freshOf,
    Gone,
    isFirstGone,
    load,
    loadNow,
    markupNow,
    markupOf,
    partsOf,
    peek,
    schedule,
    skeletonOf,
    strategiesOf,
    watch,
    whenWanted,
  } from "./runtime.js";
  import {
    awaken,
    codeOf,
    freshen,
    measurer,
    reveal as revealMarkup,
  } from "./wake.js";

  const {
    part,
    view,
    render = "server",
    reveal = "visible",
    hydrate,
    margin,
    media,
    prefetch = true,
    children,
    code: chunk,
    module: moduleId,
    why,
    scope,
    failed,
    class: className,
    as = "div",
  }: {
    /** The value to render, made with `part()` on the server. */
    part: Part<T>;
    /** Names this island when several share one part, so each has its own skeleton. */
    view?: string;
    /** Where the HTML comes from: `"server"` (the default), `"deferred"`, `"client"`, or `"fresh"`. */
    render?: Render;
    /** When deferred HTML is fetched. The default is `"visible"`. Fresh HTML is fetched as soon as the island mounts. */
    reveal?: Strategy;
    /**
     * When to hydrate: one strategy, or several where the first to fire wins.
     * The default is `"interaction"`, or `"visible"` for `render="client"`.
     */
    hydrate?: Strategy | ReadonlyArray<Strategy>;
    /** How far from the viewport counts as near, as a CSS margin. The default is `"320px"`. */
    margin?: string;
    /** The media query for the `"media"` strategy. */
    media?: string;
    /** Fetches the data at low priority once the island is near the viewport and the browser is idle. The default is `true`. */
    prefetch?: boolean;
    /** Renders the value. It also runs on the server, so it can't use `await`. */
    children: Snippet<[T]>;
    /** The island's code in its own chunk. The Vite plugin sets this. */
    code?: Chunk;
    /** The island's id in the build. The Vite plugin sets this. */
    module?: string;
    /** Why the island hydrates, or `"inferred"` when it never needs to. The Vite plugin sets this in dev. */
    why?: string;
    /** The page values the island's code reads. The Vite plugin sets this. */
    scope?: object;
    /** Shown when a part can't be loaded. Call `retry` to try again. */
    failed?: Snippet<[retry: () => void]>;
    /** A class for the island's wrapper. The wrapper is `display: contents` by default. */
    class?: string;
    /**
     * The wrapper's element. Use `"tbody"` to hydrate a long table a section at a
     * time. A `tbody` needs its rows in the page, so it needs `render="server"`.
     */
    as?: "div" | "tbody";
  } = $props();

  const context = getAllContexts();
  const server = serverScope();
  const origin = untrack(() => part);
  const key = $derived(view == null ? part.name : `${part.name}:${view}`);
  const first = untrack(() => key);
  const mode = untrack(() => render);
  const revealOn = untrack(() => reveal);
  const isDeferred = mode === "deferred" && !origin.isPrivate;
  const isFresh = mode === "fresh";
  const ssr = mode !== "client";
  const code = codeOf(
    untrack(() => children as Body | undefined),
    untrack(() => chunk),
  );

  const adopted = untrack((): (Adopted & { element?: HTMLElement }) | null => {
    if (server == null) {
      if (
        origin.loaded != null &&
        ssr &&
        !isDeferred &&
        !isFresh &&
        moduleId == null
      ) {
        return null;
      }
      const found = claim(origin, first);
      return found == null ? null : { ...found, html: " " };
    }
    return server.adopt({
      part: origin,
      key: first,
      render: mode,
      reveal: revealOn,
      as,
      module: moduleId ?? null,
      className: className ?? null,
      why: why ?? null,
      body: children,
      context,
      hydrate: hydrate == null ? null : strategiesOf(hydrate),
      margin: margin ?? null,
      media: media ?? null,
      prefetch,
      scope: scope ?? null,
    });
  });

  const strategies = $derived.by((): Array<Strategy> => {
    if (hydrate != null) {
      return strategiesOf(hydrate);
    }
    return !ssr || adopted?.state === "client" ? ["visible"] : ["interaction"];
  });

  let isLatched = adopted != null;
  let isReleased = $state(false);
  let fetched = $state.raw<{ hash: string; value: T } | null>(null);
  let body = $state.raw<Body | null>(code.now());
  let failure = $state<string | null>(null);
  let attempt = $state(0);

  const isAdopted = $derived.by(() => {
    if (part.hash !== origin.hash) {
      isLatched = false;
    }
    return isLatched && !isReleased;
  });

  const current = $derived.by(() => {
    const own = fetched?.hash === part.hash ? { value: fetched.value } : null;
    return isFresh && !isReleased ? own : (peek(part) ?? own);
  });

  const classes = $derived(
    className == null ? "island" : `island ${className}`,
  );
  const control: Control = { rouse: () => {} };
  const meter = measurer(origin);

  function retry() {
    failure = null;
    attempt++;
  }

  function release() {
    isReleased = true;
  }

  function onGone() {
    void refreshAll();
  }

  function later(run: () => void) {
    return schedule(
      () => {
        run();
        flushSync();
      },
      untrack(() => strategies),
    );
  }

  function wakeOf(): Wake {
    return {
      part: origin,
      key: first,
      needs: partsOf(adopted?.needs ?? null),
      hydrate: () => untrack(() => strategies),
      reveal: revealOn,
      options: untrack(() => ({ margin, media })),
      code,
      scope: untrack(() => scope),
      context,
      prefetch: untrack(() => prefetch),
      onGone,
      onRelease: release,
    };
  }

  function activate(target: HTMLElement) {
    const wake = wakeOf();
    if (adopted?.state === "fresh") {
      return freshen(target, async () => freshOf(first), wake, control);
    }
    if (adopted?.state === "static") {
      return awaken(target, wake, control);
    }
    if (adopted?.file != null) {
      const { file } = adopted;
      return revealMarkup(
        target,
        {
          fetch: async () => markupOf(file, origin.source, origin),
          now: () => markupNow(file, origin.source),
        },
        wake,
        control,
      );
    }
    let job: ReturnType<typeof schedule> | null = null;
    const watcher = watch(
      target,
      wake.hydrate(),
      () => {
        job = later(() => {
          meter.measure(target);
          release();
        });
      },
      wake.options,
    );
    control.rouse = watcher.now;
    const stopWanting =
      adopted?.isBusy === false
        ? whenWanted((want) => {
            if (want === "find") {
              control.rouse();
              return;
            }
            const loadedBody = code.now();
            if (loadedBody != null && loadNow(origin) != null) {
              watcher.stop();
              job?.cancel();
              body = loadedBody;
              release();
              flushSync();
            }
          })
        : () => {};
    return () => {
      job?.cancel();
      watcher.stop();
      stopWanting();
    };
  }

  let empty: HTMLElement | null = null;

  function learn(target: HTMLElement) {
    if (current != null && body != null) {
      meter.revealed(target);
      return capture(key, target);
    }
    empty = target;
  }

  $effect(() => {
    const element = isAdopted ? adopted?.element : null;
    if (element != null) {
      return untrack(() => activate(element));
    }
  });

  onMount(boot);

  $effect(() => {
    if (strategies.includes("eager")) {
      untrack(() => {
        control.rouse();
      });
    }
  });

  $effect(() => {
    if (isAdopted || (current != null && body != null)) {
      return;
    }
    const target = part;
    void attempt;
    let isLive = true;
    let job: ReturnType<typeof schedule> | null = null;
    const value =
      isFresh && !isReleased
        ? freshOf<T>(first).then(
            async (found) => load(found?.part ?? target),
            async () => load(target),
          )
        : load(target);
    Promise.all([value, code.load()]).then(
      ([value, loadedBody]) => {
        if (isLive) {
          job = later(() => {
            meter.measure(empty);
            fetched = { hash: target.hash, value };
            body = loadedBody;
          });
        }
      },
      (error: unknown) => {
        if (!isLive) {
          return;
        }
        if (error instanceof Gone && isFirstGone(target.hash)) {
          onGone();
        } else {
          failure = target.hash;
        }
      },
    );
    return () => {
      isLive = false;
      job?.cancel();
    };
  });
</script>

{#snippet liveBody()}
  {#if current != null && body != null}
    <Frame {body} value={current.value} {scope} />
  {:else if failure === part.hash}
    {#if failed != null}
      {@render failed(retry)}
    {:else}
      <button class="island-retry" type="button" onclick={retry}>Retry</button>
    {/if}
  {:else}
    <div class="island-shell" aria-hidden="true">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html skeletonOf(key) ?? fallback(part.bytes)}
    </div>
  {/if}
{/snippet}

{#if isAdopted && adopted != null}
  <!-- svelte-ignore hydration_html_changed -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html adopted.html}
{:else if as === "tbody"}
  <tbody
    class={classes}
    data-island={part.hash}
    data-island-name={dev ? part.name : undefined}
    data-island-bytes={dev ? part.bytes : undefined}
    data-island-why={dev ? why : undefined}
    aria-busy={current == null || body == null ? "true" : undefined}
    {@attach learn}
  >
    {@render liveBody()}
  </tbody>
{:else}
  <div
    class={classes}
    data-island={part.hash}
    data-island-name={dev ? part.name : undefined}
    data-island-bytes={dev ? part.bytes : undefined}
    data-island-why={dev ? why : undefined}
    aria-busy={current == null || body == null ? "true" : undefined}
    {@attach learn}
  >
    {@render liveBody()}
  </div>
{/if}
