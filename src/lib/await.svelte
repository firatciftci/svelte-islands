<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { getAllContexts, untrack } from "svelte";
  import { quietly, scope } from "./part.js";
  import Pending from "./pending.svelte";

  const {
    promise,
    name,
    reserve,
    children,
    failed,
    class: className,
  }: {
    promise: T;
    name: string;
    reserve?: string;
    children: Snippet<[Awaited<T>]>;
    failed?: Snippet<[unknown]>;
    class?: string;
  } = $props();

  const server = scope();
  if (server != null) {
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
