import type { Transport } from "@sveltejs/kit/hooks";
import type { Snippet } from "svelte";
import { parse, stringify } from "devalue";
import { claim, isPackable, pack, unpack } from "./pack.js";

export type Strategy =
  | "visible"
  | "idle"
  | "interaction"
  | "media"
  | "eager"
  | "never";

export type Fetch = "auto" | "lazy" | "preload";

export const settings = { inline: 4096, prefix: "/_parts/" };

export class Part<T = unknown> {
  readonly name: string;
  readonly hash: string;
  readonly source: string;
  readonly bytes: number;
  readonly isEager: boolean;
  readonly fetch: Fetch;
  readonly loaded: { value: T } | null;

  constructor({
    name,
    hash,
    source,
    bytes,
    isEager = false,
    fetch = "auto",
    loaded = null,
  }: {
    name: string;
    hash: string;
    source: string;
    bytes: number;
    isEager?: boolean;
    fetch?: Fetch;
    loaded?: { value: T } | null;
  }) {
    this.name = name;
    this.hash = hash;
    this.source = source;
    this.bytes = bytes;
    this.isEager = isEager;
    this.fetch = fetch;
    this.loaded = loaded;
  }

  get isInline() {
    return this.loaded != null && this.bytes <= settings.inline;
  }
}

export type Scope = {
  isData: boolean;
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
};

const state: {
  read: () => Scope | null;
  arrived: (part: Part) => void;
  reducers: Record<string, (value: unknown) => unknown>;
  revivers: Record<string, (value: unknown) => unknown>;
} = { read: () => null, arrived: () => {}, reducers: {}, revivers: {} };

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

function encode(value: unknown, isData: boolean) {
  if (!(value instanceof Part)) {
    return false;
  }
  const head: Head = [
    value.name,
    value.hash,
    value.source,
    value.bytes,
    (isData && value.fetch === "auto") || value.fetch === "preload" ? 1 : 0,
  ];
  const encoded: Encoded =
    value.isInline && value.loaded != null
      ? [...head, value.loaded.value]
      : head;
  return encoded;
}

function decode(encoded: Encoded) {
  const [name, hash, source, bytes, isEager] = encoded;
  const part = new Part({
    name,
    hash,
    source,
    bytes,
    isEager: isEager === 1,
    loaded: encoded.length > 5 ? { value: encoded[5] } : null,
  });
  state.arrived(part);
  return part;
}

const codec = {
  encode: (value: unknown) => encode(value, scope()?.isData === true),
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

const nested = { encode: (value: unknown) => encode(value, false), decode };

function index(codecs: Transport) {
  claim(Object.values(codecs).map(({ encode: reduce }) => reduce));
  const merged: Transport = { ...codecs, ...compact, part: nested };
  const all = Object.entries(merged);
  state.reducers = Object.fromEntries(
    all.map(([key, { encode: reduce }]) => [
      key,
      (value: unknown): unknown => reduce(value),
    ]),
  );
  state.revivers = Object.fromEntries(
    all.map(([key, { decode: revive }]) => [
      key,
      (value: unknown): unknown => revive(value),
    ]),
  );
}

index({});

export function islands({
  codecs = {},
  inline = settings.inline,
  prefix = settings.prefix,
}: { codecs?: Transport; inline?: number; prefix?: string } = {}) {
  settings.inline = inline;
  settings.prefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  index(codecs);
  return { ...codecs, ...compact, part: codec } satisfies Transport;
}

export function serialize(value: unknown) {
  return isPackable(value)
    ? `~${JSON.stringify(pack(value))}`
    : stringify(value, state.reducers);
}

export function deserialize(text: string): unknown {
  return text.startsWith("~")
    ? unpack(JSON.parse(text.slice(1)))
    : parse(text, state.revivers);
}
