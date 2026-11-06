<!--
  @component
  Shows a promise from `load` with a skeleton learned from its finished content,
  so that the page holds its shape while the data streams in.
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { getAllContexts, tick, untrack } from "svelte";
  import { quietly, scope } from "./part.js";
  import Pending from "./pending.svelte";

  const {
    promise,
    name,
    key,
    reserve,
    private: isPrivate = false,
    children,
    pending,
    failed,
    class: className,
  }: {
    /** The promise to wait for, or a value that is already there. */
    promise: T;
    /** A stable name for this content. Skeletons are learned per name. */
    name: string;
    /**
     * What the content is about. While a new promise has the same `key` as the
     * last one that resolved, the old content stays on screen, marked busy,
     * until the new value arrives. With a different `key`, or none, the
     * skeleton shows instead.
     */
    key?: unknown;
    /** The height to hold before a skeleton is known, as a CSS length. */
    reserve?: string;
    /** Set to `true` if the content differs per visitor, so no skeleton is learned from it. */
    private?: boolean;
    /** Renders the resolved value. */
    children: Snippet<[Awaited<T>]>;
    /**
     * Shown right away while the promise is pending, in place of the skeleton.
     * It receives the skeleton as a snippet, which keeps its delay.
     */
    pending?: Snippet<[Snippet]>;
    /** Shown when the promise rejects. */
    failed?: Snippet<[unknown]>;
    /** A class for the wrapper. */
    class?: string;
  } = $props();

  type Outcome =
    | { from: unknown; isDone: true; value: Awaited<T> }
    | { from: unknown; isDone: false; error: unknown };

  function isThenable(value: unknown): value is PromiseLike<Awaited<T>> {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value != null &&
      "then" in value &&
      typeof value.then === "function"
    );
  }

  let outcome = $state.raw<Outcome | null>(null);
  let kept: { key: unknown; value: Awaited<T> } | null = null;

  function isPlain(value: unknown): value is Awaited<T> {
    return !isThenable(value);
  }

  const settled = $derived.by((): Outcome | null => {
    if (isPlain(promise)) {
      return { from: promise, isDone: true, value: promise };
    }
    return outcome?.from === promise ? outcome : null;
  });

  const shown = $derived.by(() => {
    if (settled?.isDone === true) {
      kept = { key, value: settled.value };
      return { value: settled.value, isStale: false };
    }
    if (settled == null && key !== undefined && kept?.key === key) {
      return { value: kept.value, isStale: true };
    }
    return null;
  });

  function hashTarget() {
    const id = decodeURIComponent(location.hash.slice(1));
    return id === "" ? null : document.getElementById(id);
  }

  async function reveal(found: Outcome, hadTarget: boolean, at: number) {
    outcome = found;
    if (hadTarget || scrollY !== at) {
      return;
    }
    await tick();
    hashTarget()?.scrollIntoView();
  }

  $effect(() => {
    const current = promise;
    if (!isThenable(current)) {
      return;
    }
    let isLive = true;
    const hadTarget = hashTarget() != null;
    const at = scrollY;
    current.then(
      (value) => {
        if (isLive) {
          void reveal({ from: current, isDone: true, value }, hadTarget, at);
        }
      },
      (error: unknown) => {
        if (isLive) {
          void reveal({ from: current, isDone: false, error }, hadTarget, at);
        }
      },
    );
    return () => {
      isLive = false;
    };
  });

  const server = scope();
  if (server != null && untrack(() => !isPrivate)) {
    const context = getAllContexts();
    const { body, label, waited } = untrack(() => ({
      body: children,
      label: name,
      waited: promise,
    }));
    const teach = async () => {
      const value = await waited;
      server.skeleton(label, label, () =>
        server.render(body, value, context, "a"),
      );
    };
    void quietly(teach());
  }
</script>

{#if settled != null && !settled.isDone}
  {@render failed?.(settled.error)}
{:else if shown != null}
  <Pending
    {name}
    {reserve}
    isPending={false}
    isStale={shown.isStale}
    class={className}
  >
    {@render children(shown.value)}
  </Pending>
{:else}
  {#snippet skeleton()}
    <Pending {name} {reserve} isPending={true} class={className} />
  {/snippet}
  {#if pending == null}
    {@render skeleton()}
  {:else}
    {@render pending(skeleton)}
  {/if}
{/if}
