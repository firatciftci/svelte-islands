import type { Transport } from "@sveltejs/kit/hooks";
import type { Snippet } from "svelte";
import { parse, stringify } from "devalue";
import { claim, isPackable, pack, unpack } from "./pack.js";

/**
 * When an island hydrates, or when a deferred island brings in its HTML.
 *
 * - `"visible"`: when it comes within `margin` of the viewport.
 * - `"idle"`: when the browser is idle.
 * - `"interaction"`: on the first pointer, focus, or touch inside it.
 * - `"media"`: when the island's `media` query matches.
 * - `"eager"`: right away.
 * - `"never"`: never, so it stays as server HTML.
 */
export type Strategy =
  | "visible"
  | "idle"
  | "interaction"
  | "media"
  | "eager"
  | "never";

/**
 * When the browser downloads a part's data.
 *
 * - `"auto"`: on a first page load, when the island needs it. When someone
 *   navigates to the page from elsewhere in the app, as soon as navigation starts.
 * - `"lazy"`: only when the island needs it or you call `load(part)`.
 * - `"preload"`: as soon as the page arrives.
 */
export type Fetch = "auto" | "lazy" | "preload";

export const settings = { inline: 4096, prefix: "/_parts/" };

/**
 * A value that travels outside the page's data. Make one with `part()` in a
 * server `load`, then read it with `<Island>`, `peek()`, or `load()`.
 */
export class Part<T = unknown> {
  /** The name given to `part()`. Skeletons are learned per name. */
  readonly name: string;
  /** A hash of the contents. The file under the prefix is this hash plus `.json`. */
  readonly hash: string;
  /** The page that can make this part again if it's missing from the store. */
  readonly source: string;
  /** The size of the serialized value, in characters. */
  readonly bytes: number;
  /** Whether the browser starts downloading this part as soon as the page arrives. */
  readonly isEager: boolean;
  /** When the browser requests this part. */
  readonly fetch: Fetch;
  /** Whether the part stays in the page's data and off public URLs. */
  readonly isPrivate: boolean;
  /**
   * The value, where it's already at hand. It's `null` in the browser for most
   * parts, so read values with `<Island>`, `peek()`, or `load()`.
   */
  readonly loaded: { value: T } | null;

  constructor({
    name,
    hash,
    source,
    bytes,
    isEager = false,
    fetch = "auto",
    isPrivate = false,
    loaded = null,
  }: {
    name: string;
    hash: string;
    source: string;
    bytes: number;
    isEager?: boolean;
    fetch?: Fetch;
    isPrivate?: boolean;
    loaded?: { value: T } | null;
  }) {
    this.name = name;
    this.hash = hash;
    this.source = source;
    this.bytes = bytes;
    this.isEager = isEager;
    this.fetch = fetch;
    this.isPrivate = isPrivate;
    this.loaded = loaded;
  }

  /** Whether the value is small enough, or private, to stay in the page's data. */
  get isInline(): boolean {
    return (
      this.loaded != null && (this.isPrivate || this.bytes <= settings.inline)
    );
  }
}

export type Scope = {
  render: (
    body: Snippet<[never]>,
    value: unknown,
    context: Map<unknown, unknown>,
    prefix: string,
  ) => string;
  skeleton: (name: string, key: string, html: () => string) => string | null;
  shape: (name: string) => string | null;
  stash: (html: string) => string;
  outline: (identity: string, html: () => string, view?: string) => string;
  awaited: (error: unknown, name: string) => boolean;
};

const state: {
  read: () => Scope | null;
  arrived: (part: Part) => void;
  reducers: Record<string, (value: unknown) => unknown>;
  sealed: Record<string, (value: unknown) => unknown>;
  revivers: Record<string, (value: unknown) => unknown>;
} = {
  read: () => null,
  arrived: () => {},
  reducers: {},
  sealed: {},
  revivers: {},
};

export function provide(reader: () => Scope | null) {
  state.read = reader;
}

export function scope() {
  return state.read();
}

export function onArrival(handler: (part: Part) => void) {
  state.arrived = handler;
}

export async function quietly<T>(
  promise: Promise<T> | undefined,
): Promise<T | null> {
  try {
    return (await promise) ?? null;
  } catch {
    return null;
  }
}

type Head = [
  name: string,
  hash: string,
  source: string,
  bytes: number,
  isEager: 0 | 1,
];

type Encoded = Head | [...Head, unknown];

function encoded(value: Part, isEager: boolean) {
  const head: Head = [
    value.name,
    value.hash,
    value.source,
    value.bytes,
    isEager ? 1 : 0,
  ];
  const result: Encoded =
    value.isInline && value.loaded != null
      ? [...head, value.loaded.value]
      : head;
  return result;
}

function decode(sent: Encoded) {
  const [name, hash, source, bytes, isEager] = sent;
  const part = new Part({
    name,
    hash,
    source,
    bytes,
    isEager: isEager === 1,
    loaded: sent.length > 5 ? { value: sent[5] } : null,
  });
  state.arrived(part);
  return part;
}

const codec = {
  encode: (value: unknown) =>
    value instanceof Part && encoded(value, value.isEager),
  decode,
};

const packed = {
  encode: (value: unknown) =>
    Array.isArray(value) && value.length >= 4 && isPackable(value)
      ? JSON.stringify(pack(value))
      : false,
  decode: (text: string) => unpack(JSON.parse(text)),
};

const compact = { pack: packed };

const nested = {
  encode: (value: unknown) =>
    value instanceof Part && encoded(value, value.fetch === "preload"),
  decode,
};

function index(codecs: Transport) {
  claim(Object.values(codecs).map(({ encode: reduce }) => reduce));
  const merged: Transport = { ...codecs, ...compact, part: nested };
  const all = Object.entries(merged);
  state.sealed = Object.fromEntries(
    all.map(([key, { encode: reduce }]) => [
      key,
      (value: unknown): unknown => reduce(value),
    ]),
  );
  state.reducers = {
    ...state.sealed,
    part: (value: unknown): unknown => {
      if (value instanceof Part && value.isPrivate) {
        throw new Error(
          `svelte-islands: the private part "${value.name}" is inside a public part, which would publish it. Make the outer part private too.`,
        );
      }
      return nested.encode(value);
    },
  };
  state.revivers = Object.fromEntries(
    all.map(([key, { decode: revive }]) => [
      key,
      (value: unknown): unknown => revive(value),
    ]),
  );
}

index({});

/**
 * The transport hook that carries parts through SvelteKit's page data. Export
 * its result as `transport` from `src/hooks.ts`.
 *
 * @param options Settings shared by the server and the browser.
 * @param options.codecs Your own `transport` entries, kept alongside the library's.
 * @param options.inline Values up to this many characters stay in the page's data.
 * @param options.prefix The URL prefix of parts. Include your base path if you have one.
 * @returns The value to export as `transport`.
 */
export function islands({
  codecs = {},
  inline = settings.inline,
  prefix = settings.prefix,
}: { codecs?: Transport; inline?: number; prefix?: string } = {}): Transport {
  settings.inline = inline;
  settings.prefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  index(codecs);
  return { ...codecs, ...compact, part: codec } satisfies Transport;
}

export function serialize(value: unknown, isPrivate = false) {
  return isPackable(value)
    ? `~${JSON.stringify(pack(value))}`
    : stringify(value, isPrivate ? state.sealed : state.reducers);
}

export function deserialize(text: string): unknown {
  return text.startsWith("~")
    ? unpack(JSON.parse(text.slice(1)))
    : parse(text, state.revivers);
}
