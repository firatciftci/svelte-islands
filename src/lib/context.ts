import { getContext, setContext } from "svelte";

/**
 * Makes a context with a named key. It works like `createContext` from
 * svelte, and it also reaches islands on pages with `csr = false`, which only
 * get contexts whose keys they can find again by name.
 *
 * ```ts
 * const [getTheme, setTheme] = context<"light" | "dark">("theme");
 * ```
 *
 * @param name A name that's unique in your app.
 * @returns A function that reads the context and one that sets it.
 */
export function context<T>(name: string): [get: () => T, set: (value: T) => T] {
  const key = Symbol.for(`svelte-islands:${name}`);
  return [() => getContext<T>(key), (value) => setContext(key, value)];
}
