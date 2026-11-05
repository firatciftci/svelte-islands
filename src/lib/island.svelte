<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import {
    flushSync,
    getAllContexts,
    hydrate,
    onMount,
    unmount,
    untrack,
  } from "svelte";
  import type { Part, Strategy } from "./part.js";
  import type { Claimed } from "./runtime.js";
  import Frame from "./frame.svelte";
  import { quietly, scope } from "./part.js";
  import {
    boot,
    capture,
    claim,
    fallback,
    Gone,
    intercept,
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
    watch,
    whenWanted,
  } from "./runtime.js";

  const {
    part,
    view,
    when,
    ssr = true,
    defer = false,
    margin,
    media,
    children,
    failed,
    class: className,
  }: {
    part: Part<T>;
    view?: string;
    when?: Strategy;
    ssr?: boolean;
    defer?: boolean | Strategy;
    margin?: string;
    media?: string;
    children: Snippet<[T]>;
    failed?: Snippet<[retry: () => void]>;
    class?: string;
  } = $props();

  const context = getAllContexts();
  const server = scope();
  const origin = untrack(() => part);
  const key = $derived(view == null ? part.name : `${part.name}:${view}`);
  const first = untrack(() => key);
  const plan = untrack(() => ({
    when: when ?? (ssr ? "interaction" : "visible"),
    fetch: typeof defer === "string" ? defer : "visible",
    isDeferred: defer !== false,
    options: { margin, media },
  }));

  function shell(skeleton: string | null) {
    return `<div class="island-shell" aria-hidden="true">${skeleton ?? fallback(origin.bytes)}</div>`;
  }

  const adopted = untrack((): (Claimed & { html: string }) | null => {
    if (server == null) {
      const found = claim(origin, first);
      return found == null ? null : { ...found, html: " " };
    }
    const { loaded } = origin;
    if (loaded == null || (origin.isInline && ssr && !plan.isDeferred)) {
      return null;
    }
    const prefix = `s${origin.hash.slice(0, 6).replaceAll("-", "_")}`;
    let drawn: { result: string; reads: Set<Part> } | null = null;
    const draw = () =>
      (drawn ??= reading(() =>
        server.render(children, loaded.value, context, prefix),
      ));
    const html = () => draw().result;
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
    const rendered = html();
    const needs = needsOf(draw().reads, origin);
    if (!plan.isDeferred) {
      return {
        state: "static",
        file: null,
        needs,
        isBusy: false,
        html: rendered,
      };
    }
    const file = server.stash(rendered);
    const outlined = server.outline(file, html);
    return {
      state: "deferred",
      file,
      needs,
      isBusy: outlined === "",
      html: `${outlined}${shell(server.skeleton(origin.name, first, html))}`,
    };
  });

  let isLatched = adopted != null;
  let isReleased = $state(false);
  let fetched = $state.raw<{ hash: string; value: T } | null>(null);
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

  let rouse = () => {};

  function arm(target: HTMLElement, strategy: Strategy, start: () => void) {
    const watcher = watch(target, strategy, start, plan.options);
    rouse = watcher.now;
    if (untrack(() => when) === "eager") {
      watcher.now();
    }
    return watcher.stop;
  }

  function retry() {
    failure = null;
    attempt++;
  }

  function release() {
    isReleased = true;
  }

  function later(run: () => void) {
    return schedule(
      () => {
        run();
        flushSync();
      },
      untrack(() => when) ?? plan.when,
    );
  }

  function awaken(target: HTMLElement) {
    const body = untrack(() => children);
    let job: ReturnType<typeof schedule> | null = null;
    const held =
      plan.when === "never"
        ? null
        : intercept(target, () => {
            rouse();
            job?.hurry();
          });
    const stopCapture = capture(first, target);
    const needs = partsOf(adopted?.needs ?? null);
    let instance: ReturnType<typeof hydrate> | null = null;
    let isLive = true;
    let stopWanting = () => {};
    const mount = (value: T) => {
      if (!isLive || instance != null) {
        return;
      }
      stopWanting();
      instance = hydrate(Frame, { target, props: { body, value }, context });
      target.dataset.islandState = "live";
      if (held?.isHolding() === true) {
        flushSync();
      }
      held?.release();
    };
    const stop = arm(target, plan.when, () => {
      Promise.all([
        load(origin),
        ...needs.map(async (need) => load(need)),
      ]).then(
        ([value]) => {
          if (!isLive) {
            return;
          }
          job = schedule(
            () => {
              mount(value);
            },
            untrack(() => when) ?? plan.when,
          );
          if (held?.isHolding() === true) {
            job.hurry();
          }
        },
        () => {
          held?.stop();
        },
      );
    });
    if (plan.when !== "never") {
      stopWanting = whenWanted((want) => {
        if (want === "find") {
          rouse();
          return;
        }
        const found = loadNow(origin);
        if (found != null && needs.every((need) => loadNow(need) != null)) {
          stop();
          job?.cancel();
          mount(found.value);
          flushSync();
        }
      });
    }
    return () => {
      isLive = false;
      job?.cancel();
      stop();
      stopWanting();
      stopCapture();
      held?.stop();
      if (instance != null) {
        void unmount(instance);
      }
    };
  }

  function reveal(target: HTMLElement, file: string) {
    let isLive = true;
    let rest = () => {};
    let stopWanting = () => {};
    const show = (html: string) => {
      const skeleton = target.querySelector(":scope > .island-shell");
      if (!isLive || skeleton == null) {
        return;
      }
      stopWanting();
      const template = document.createElement("template");
      template.innerHTML = html;
      target.querySelector(":scope > .island-outline")?.remove();
      skeleton.replaceWith(template.content);
      target.dataset.islandState = "static";
      target.removeAttribute("aria-busy");
      rest = awaken(target);
    };
    const stop = arm(target, plan.fetch, () => {
      const strategy = untrack(() => when) ?? plan.when;
      if (strategy === "eager" || strategy === "visible") {
        void quietly(load(origin));
      }
      markupOf(file, origin.source).then(show, () => {
        if (isLive) {
          release();
        }
      });
    });
    stopWanting = whenWanted((want) => {
      if (want === "find") {
        rouse();
        return;
      }
      const html = markupNow(file, origin.source);
      if (html != null) {
        stop();
        show(html);
      }
    });
    return () => {
      isLive = false;
      stop();
      stopWanting();
      rest();
    };
  }

  function activate(target: HTMLElement) {
    if (adopted?.state === "static") {
      return awaken(target);
    }
    if (adopted?.file != null) {
      return reveal(target, adopted.file);
    }
    let job: ReturnType<typeof schedule> | null = null;
    const stop = arm(target, plan.when, () => {
      job = later(release);
    });
    const stopWanting =
      adopted?.isBusy === false
        ? whenWanted((want) => {
            if (want === "find") {
              rouse();
              return;
            }
            if (loadNow(origin) != null) {
              stop();
              job?.cancel();
              release();
              flushSync();
            }
          })
        : () => {};
    return () => {
      job?.cancel();
      stop();
      stopWanting();
    };
  }

  function learn(target: HTMLElement) {
    if (current != null) {
      return capture(key, target);
    }
  }

  onMount(boot);

  $effect(() => {
    if (when === "eager") {
      untrack(() => {
        rouse();
      });
    }
  });

  $effect(() => {
    if (isAdopted || current != null) {
      return;
    }
    const target = part;
    void attempt;
    let isLive = true;
    let job: ReturnType<typeof schedule> | null = null;
    load(target).then(
      (value) => {
        if (isLive) {
          job = later(() => {
            fetched = { hash: target.hash, value };
          });
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
      job?.cancel();
    };
  });
</script>

{#if isAdopted && adopted != null}
  <div
    class={["island", className]}
    data-island={origin.hash}
    data-island-state={adopted.state}
    data-island-file={adopted.file}
    data-island-needs={adopted.needs}
    aria-busy={adopted.isBusy ? "true" : undefined}
    {@attach activate}
  >
    <!-- svelte-ignore hydration_html_changed -->
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html adopted.html}
  </div>
{:else}
  <div
    class={["island", className]}
    data-island={part.hash}
    aria-busy={current == null ? "true" : undefined}
    {@attach learn}
  >
    {#if current != null}
      <Frame body={children} value={current.value} />
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
  </div>
{/if}
