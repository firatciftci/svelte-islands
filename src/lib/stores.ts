/** Where parts, deferred HTML, and learned skeletons persist. Values are strings. */
export type Store = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, text: string) => Promise<unknown>;
};

/**
 * Keeps entries as files in a directory, for one server or several sharing a
 * disk. Each write is atomic. Nothing is ever deleted, so prune old files
 * yourself if the directory grows too large.
 *
 * @param options Settings for the store.
 * @param options.directory The directory to use. It is created if missing.
 */
export function fileStore({ directory }: { directory: string }): Store {
  const pathOf = async (key: string) => {
    const { createHash } = await import("node:crypto");
    const name = createHash("sha256").update(key).digest("base64url");
    return `${directory}/${name}`;
  };
  return {
    get: async (key) => {
      const { readFile } = await import("node:fs/promises");
      try {
        return await readFile(await pathOf(key), "utf8");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }
    },
    set: async (key, text) => {
      const { mkdir, rename, writeFile } = await import("node:fs/promises");
      const path = await pathOf(key);
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, text);
      await rename(temporary, path);
    },
  };
}

type RedisClient = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<unknown>;
  setEx?: (key: string, seconds: number, value: string) => Promise<unknown>;
  setex?: (key: string, seconds: number, value: string) => Promise<unknown>;
};

/**
 * Keeps entries in Redis. Accepts a client from `ioredis` or `redis`.
 *
 * @param client A connected client.
 * @param options Settings for the store.
 * @param options.prefix Added to each key. The default is `islands:`.
 * @param options.ttl Seconds until an entry expires. By default entries don't expire.
 */
export function redisStore(
  client: RedisClient,
  { prefix = "islands:", ttl }: { prefix?: string; ttl?: number } = {},
): Store {
  return {
    get: async (key) => client.get(`${prefix}${key}`),
    set: async (key, text) => {
      const name = `${prefix}${key}`;
      if (ttl == null) {
        return client.set(name, text);
      }
      return client.setEx == null
        ? client.setex?.(name, ttl, text)
        : client.setEx(name, ttl, text);
    },
  };
}

type R2Bucket = {
  get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
  put: (key: string, value: string) => Promise<unknown>;
};

/**
 * Keeps entries in a Cloudflare R2 bucket.
 *
 * @param bucket The R2 binding, such as `platform.env.PARTS`.
 * @param options Settings for the store.
 * @param options.prefix Added to each key. The default is `islands/`.
 */
export function r2Store(
  bucket: R2Bucket,
  { prefix = "islands/" }: { prefix?: string } = {},
): Store {
  return {
    get: async (key) => {
      const found = await bucket.get(`${prefix}${key}`);
      return found == null ? null : found.text();
    },
    set: async (key, text) => bucket.put(`${prefix}${key}`, text),
  };
}

type S3Client<Command> = { send: (command: Command) => Promise<unknown> };

/**
 * Keeps entries in Amazon S3 or another service with the same API. Pass in the
 * client and command classes from `@aws-sdk/client-s3`, so this library doesn't
 * depend on the SDK.
 *
 * @param options Settings for the store.
 * @param options.client An `S3Client`.
 * @param options.bucket The bucket's name.
 * @param options.prefix Added to each key. The default is `islands/`.
 * @param options.GetObjectCommand The SDK's `GetObjectCommand` class.
 * @param options.PutObjectCommand The SDK's `PutObjectCommand` class.
 */
export function s3Store<Get, Put>({
  client,
  bucket,
  prefix = "islands/",
  GetObjectCommand,
  PutObjectCommand,
}: {
  client: S3Client<Get | Put>;
  bucket: string;
  prefix?: string;
  GetObjectCommand: new (input: { Bucket: string; Key: string }) => Get;
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    Body: string;
  }) => Put;
}): Store {
  return {
    get: async (key) => {
      try {
        const found = (await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: `${prefix}${key}` }),
        )) as { Body?: { transformToString: () => Promise<string> } };
        return (await found.Body?.transformToString()) ?? null;
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey") {
          return null;
        }
        throw error;
      }
    },
    set: async (key, text) =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${key}`,
          Body: text,
        }),
      ),
  };
}

const MARK = "gz:";
const CHUNK = 32_768;

async function deflate(text: string) {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(at, at + CHUNK));
  }
  return `${MARK}${btoa(binary)}`;
}

async function inflate(text: string) {
  if (!text.startsWith(MARK)) {
    return text;
  }
  const bytes = Uint8Array.from(
    atob(text.slice(MARK.length)),
    (character) => character.codePointAt(0) ?? 0,
  );
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Wraps a store so entries are gzipped at rest. Entries the store already
 * holds uncompressed keep working, so you can add this to a store in use.
 *
 * @param store The store to wrap.
 */
export function compressed(store: Store): Store {
  return {
    get: async (key) => {
      const text = await store.get(key);
      return text == null ? null : inflate(text);
    },
    set: async (key, text) => store.set(key, await deflate(text)),
  };
}
