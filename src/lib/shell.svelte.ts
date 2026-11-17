import type { Part, Shell, Strategy } from "./part.js";
import type { Body, Control, Wake } from "./wake.js";
import { deserialize } from "./part.js";
import { holdSwaps, markupNow, markupOf, partsOf } from "./runtime.js";
import { awaken, codeOf, render, reveal } from "./wake.js";

type Sent = Omit<Shell, "scope" | "context"> & {
  scope: Record<string, unknown> | null;
  context: Array<[isSymbol: boolean, name: string, value: unknown]>;
};

type Module = { body: Body; url?: string };

const GONE = "svelte-islands:gone:";

function reload(part: Part) {
  const key = `${GONE}${part.hash}`;
  try {
    if (sessionStorage.getItem(key) != null) {
      return;
    }
    sessionStorage.setItem(key, "1");
  } catch {
    return;
  }
  location.reload();
}

function scopeOf(values: Record<string, unknown> | null) {
  if (values == null) {
    return undefined;
  }
  const scope = $state(values);
  return scope;
}

function activate(
  target: HTMLElement,
  island: Sent,
  load: (id: string) => Promise<Module>,
) {
  const control: Control = { rouse: () => {} };
  const strategies: Array<Strategy> =
    island.hydrate ?? (island.state === "client" ? ["visible"] : ["interaction"]);
  const wake: Wake = {
    part: island.part,
    key: island.key,
    needs: partsOf(island.needs),
    hydrate: () => strategies,
    reveal: island.reveal,
    options: {
      margin: island.margin ?? undefined,
      media: island.media ?? undefined,
    },
    code: codeOf(undefined, async () => load(island.module)),
    scope: scopeOf(island.scope),
    context: new Map(
      island.context.map(([isSymbol, name, value]) => [
        isSymbol ? Symbol.for(name) : name,
        value,
      ]),
    ),
    prefetch: island.prefetch,
    onGone: () => {
      reload(island.part);
    },
    onRelease: () => {
      render(target, wake, control);
    },
  };
  const state = target.dataset.islandState;
  if (state === "static") {
    awaken(target, wake, control);
  } else if (state === "deferred" && island.file != null) {
    const { file, part } = island;
    reveal(
      target,
      {
        fetch: async () => markupOf(file, part.source, part),
        now: () => markupNow(file, part.source),
      },
      wake,
      control,
    );
  } else {
    render(target, wake, control);
  }
}

export function start(load: (id: string) => Promise<Module>) {
  const text = document.querySelector("#svelte-islands")?.textContent;
  if (text == null) {
    return;
  }
  holdSwaps();
  const queued = new Map<string, Array<Sent>>();
  for (const island of deserialize(text) as Array<Sent>) {
    const list = queued.get(island.part.hash) ?? [];
    list.push(island);
    queued.set(island.part.hash, list);
  }
  for (const target of document.querySelectorAll<HTMLElement>(
    "[data-island-module]",
  )) {
    const island = queued.get(target.dataset.island ?? "")?.shift();
    if (island != null && island.module === target.dataset.islandModule) {
      activate(target, island, load);
    }
  }
}
