---
title: ESLint rules
---

The library comes with four rules for mistakes that type checking can't catch. You'll need ESLint 9 or later:

```js
/// file: eslint.config.js
import islands from "svelte-islands/eslint";

export default [islands.configs.recommended];
```

## `no-public-per-visitor-part`

Warns when a function that reads `cookies` or `locals` makes a part without `private: true`, because [parts have public URLs](../60-best-practices/10-private-data.md). It can suggest adding the option:

```ts
export async function load({ cookies }) {
  const account = await get_account(cookies.get("session"));

  return {
    account: part("account", account), // warning
  };
}
```

## `no-server-import-in-client`

Flags an import of `svelte-islands/server` in a component or a universal `load` file. This one is an error, since `part` only runs on the server.

## `no-loaded-in-client`

Flags a read of `.loaded` in browser code, also as an error. That value is only set where the part was made, so it's `null` in the browser for most parts. You should use [`peek` or `load`](../20-core-concepts/50-reading-parts.md) instead.

## `stable-part-name`

Warns when a part's name is built from data, because skeletons are [learned per name](../20-core-concepts/10-parts.md#names) and a new name never reuses one:

```ts
part(`results.${election.id}`, rows); // warning
```
