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
  import type { Part, Render, Strategy } from "./part.js";
  import type { Claimed } from "./runtime.js";
  import type { Body, Chunk, Control, Wake } from "./wake.js";
  import Frame from "./frame.svelte";
  import { scope as serverScope } from "./part.js";
  import {
    boot,
    capture,
    claim,
    fallback,
    Gone,
    isFirstGone,
    load,
    loadNow,
    markupNow,
    markupOf,
    needsOf,
    partsOf,
    peek,
    reading,
    schedule,
    skeletonOf,
    strategiesOf,
    watch,
    whenWanted,
  } from "./runtime.js";
  import { awaken, codeOf, measurer, reveal as revealMarkup } from "./wake.js";

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
    /** When deferred or fresh HTML is fetched. The default is `"visible"`. */
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
  const ssr = mode !== "client";
  const code = codeOf(
    untrack(() => children as Body | undefined),
    untrack(() => chunk),
  );

  function shell(skeleton: string | null) {
    return `<div class="island-shell" aria-hidden="true">${skeleton ?? fallback(origin.bytes)}</div>`;
  }

  const adopted = untrack((): (Claimed & { html: string }) | null => {
    if (server == null) {
      if (origin.loaded != null && ssr && !isDeferred) {
        return null;
      }
      const found = claim(origin, first);
      return found == null ? null : { ...found, html: " " };
    }
    if (as === "tbody" && mode !== "server") {
      throw new Error(
        `The island "${origin.name}" uses as="tbody", which needs its rows in the page. Use render="server".`,
      );
    }
    const { loaded } = origin;
    if (loaded == null || (origin.isInline && ssr && !isDeferred)) {
      return null;
    }
    const prefix = `s${origin.hash.slice(0, 6).replaceAll("-", "_")}`;
    let drawn: { result: string; reads: Set<Part> } | null = null;
    const draw = () =>
      (drawn ??= reading(() =>
        server.render(children, loaded.value, context, prefix),
      ));
    const isSecret = () =>
      origin.isPrivate ||
      draw()
        .reads.values()
        .some((read) => read.isPrivate);
    const html = () => {
      if (isSecret()) {
        throw new Error("private");
      }
      return draw().result;
    };
    if (!ssr) {
      const outlined = server.outline(`${origin.hash}:${first}`, html, first);
      return {
        state: "client",
        file: null,
        needs: null,
        isBusy: outlined === "",
        html: `${outlined}${shell(server.skeleton(origin.name, first, html))}`,
      };
    }
    let rendered: string;
    try {
      rendered = draw().result;
    } catch (error) {
      if (!server.awaited(error, origin.name)) {
        throw error;
      }
      return {
        state: "client",
        file: null,
        needs: null,
        isBusy: true,
        html: shell(server.skeleton(origin.name, first, html)),
      };
    }
    const needs = needsOf(draw().reads, origin);
    if (!isDeferred || isSecret()) {
      return {
        state: "static",
        file: null,
        needs,
        isBusy: false,
        html: rendered,
      };
    }
    const file = server.stash(rendered, revealOn === "eager");
    const outlined = server.outline(file, html);
    return {
      state: "deferred",
      file,
      needs,
      isBusy: outlined === "",
      html: `${outlined}${shell(server.skeleton(origin.name, first, html))}`,
    };
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

  const current = $derived(
    peek(part) ??
      (fetched?.hash === part.hash ? { value: fetched.value } : null),
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
    return schedule(() => {
      run();
      flushSync();
    }, untrack(() => strategies));
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
    Promise.all([load(target), code.load()]).then(
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

{#if isAdopted && adopted != null}
  <svelte:element
    this={as}
    class={["island", className]}
    data-island={origin.hash}
    data-island-name={dev ? origin.name : undefined}
    data-island-module={moduleId}
    data-island-bytes={dev ? origin.bytes : undefined}
    data-island-state={adopted.state}
    data-island-file={adopted.file}
    data-island-needs={adopted.needs}
    aria-busy={adopted.isBusy ? "true" : undefined}
    {@attach activate}
  >
    <!-- svelte-ignore hydration_html_changed -->
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html adopted.html}
  </svelte:element>
{:else}
  <svelte:element
    this={as}
    class={["island", className]}
    data-island={part.hash}
    data-island-name={dev ? part.name : undefined}
    data-island-bytes={dev ? part.bytes : undefined}
    aria-busy={current == null || body == null ? "true" : undefined}
    {@attach learn}
  >
    {#if current != null && body != null}
      <Frame {body} value={current.value} {scope} />
    {:else if failure === part.hash}
      {#if failed != null}
        {@render failed(retry)}
      {:else}
        <button class="island-retry" type="button" onclick={retry}>Retry</button
        >
      {/if}
    {:else}
      <div class="island-shell" aria-hidden="true">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html skeletonOf(key) ?? fallback(part.bytes)}
      </div>
    {/if}
  </svelte:element>
{/if}
