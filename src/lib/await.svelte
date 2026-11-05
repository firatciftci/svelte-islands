<!--
  @component
  Shows a promise from `load` with a skeleton learned from its finished content,
  so that the page holds its shape while the data streams in.
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { getAllContexts, untrack } from "svelte";
  import { quietly, scope } from "./part.js";
  import Pending from "./pending.svelte";

  const {
    promise,
    name,
    reserve,
    private: isPrivate = false,
    children,
    failed,
    class: className,
  }: {
    /** The promise to wait for. */
    promise: T;
    /** A stable name for this content. Skeletons are learned per name. */
    name: string;
    /** The height to hold before a skeleton is known, as a CSS length. */
    reserve?: string;
    /** Set to `true` if the content differs per visitor, so no skeleton is learned from it. */
    private?: boolean;
    /** Renders the resolved value. */
    children: Snippet<[Awaited<T>]>;
    /** Shown when the promise rejects. */
    failed?: Snippet<[unknown]>;
    /** A class for the wrapper. */
    class?: string;
  } = $props();

  const server = scope();
  if (server != null && untrack(() => !isPrivate)) {
    const context = getAllContexts();
    const { body, key, waited } = untrack(() => ({
      body: children,
      key: name,
      waited: promise,
    }));
    const teach = async () => {
      const value = await waited;
      server.skeleton(key, key, () => server.render(body, value, context, "a"));
    };
    void quietly(teach());
  }
</script>

{#await promise}
  <Pending {name} {reserve} isPending={true} class={className} />
{:then value}
  <Pending {name} {reserve} isPending={false} class={className}>
    {@render children(value)}
  </Pending>
{:catch error}
  {@render failed?.(error)}
{/await}
