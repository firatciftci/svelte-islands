import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Buffer } from "node:buffer";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compressed,
  fileStore,
  r2Store,
  redisStore,
  s3Store,
} from "#lib/stores.js";

function memory() {
  const entries = new Map<string, string>();
  return {
    entries,
    store: {
      get: async (key: string) => entries.get(key) ?? null,
      set: async (key: string, text: string) => entries.set(key, text),
    },
  };
}

describe("fileStore", () => {
  let directory = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "islands-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("returns what it was given, and null for a missing key", async () => {
    const store = fileStore({
      directory: join(directory, "made", "on", "use"),
    });
    expect(await store.get("missing")).toBeNull();
    await store.set("p:abc", "héllo ☃");
    expect(await store.get("p:abc")).toBe("héllo ☃");
    await store.set("p:abc", "second");
    expect(await store.get("p:abc")).toBe("second");
  });

  it("keeps every key inside the directory", async () => {
    const inside = join(directory, "keys");
    const store = fileStore({ directory: inside });
    const keys = [
      "../../escape",
      "a/b/c",
      ".",
      "..",
      "x".repeat(5000),
      String.raw`\w`,
    ];
    for (const key of keys) {
      await store.set(key, key);
    }
    for (const key of keys) {
      expect(await store.get(key)).toBe(key);
    }
    expect(await readdir(inside)).toHaveLength(keys.length);
    expect(await readdir(directory)).not.toContain("escape");
  });

  it("never leaves a partial file behind concurrent writes", async () => {
    const inside = join(directory, "racing");
    const store = fileStore({ directory: inside });
    const texts = Array.from({ length: 40 }, (_, at) =>
      String(at).repeat(5000),
    );
    await Promise.all(texts.map(async (text) => store.set("same", text)));
    expect(texts).toContain(await store.get("same"));
    expect(await readdir(inside)).toHaveLength(1);
  });

  it("reports errors other than a missing file", async () => {
    const store = fileStore({ directory: join(directory, "as-file") });
    await store.set("key", "text");
    const blocked = fileStore({
      directory: join(
        directory,
        "as-file",
        (await readdir(join(directory, "as-file")))[0] ?? "",
      ),
    });
    await expect(blocked.set("key", "text")).rejects.toThrow();
  });
});

describe("redisStore", () => {
  it("uses setEx on a node-redis client when there is a ttl", async () => {
    const calls: Array<unknown> = [];
    const store = redisStore(
      {
        get: async (key) => key,
        set: async (...args) => {
          calls.push(["set", ...args]);
        },
        setEx: async (...args) => {
          calls.push(["setEx", ...args]);
        },
      },
      { ttl: 60 },
    );
    await store.set("a", "b");
    expect(calls).toEqual([["setEx", "islands:a", 60, "b"]]);
    expect(await store.get("a")).toBe("islands:a");
  });

  it("uses setex on an ioredis client when there is a ttl", async () => {
    const calls: Array<unknown> = [];
    const store = redisStore(
      {
        get: async () => null,
        set: async (...args) => {
          calls.push(["set", ...args]);
        },
        setex: async (...args) => {
          calls.push(["setex", ...args]);
        },
      },
      { ttl: 60, prefix: "x:" },
    );
    await store.set("a", "b");
    expect(calls).toEqual([["setex", "x:a", 60, "b"]]);
  });

  it("uses set when there is no ttl", async () => {
    const calls: Array<unknown> = [];
    const store = redisStore({
      get: async () => null,
      set: async (...args) => {
        calls.push(["set", ...args]);
      },
    });
    await store.set("a", "b");
    expect(calls).toEqual([["set", "islands:a", "b"]]);
  });
});

describe.skipIf(process.env.REDIS_URL == null)("redisStore on Redis", () => {
  const url = process.env.REDIS_URL ?? "";
  const key = crypto.randomUUID();

  it("works with an ioredis client", async () => {
    const { Redis } = await import("ioredis");
    const client = new Redis(url);
    try {
      const store = redisStore(client, { ttl: 60 });
      await store.set(key, "from ioredis ☃");
      expect(await store.get(key)).toBe("from ioredis ☃");
      expect(await client.ttl(`islands:${key}`)).toBeGreaterThan(0);
      expect(await store.get(crypto.randomUUID())).toBeNull();
    } finally {
      client.disconnect();
    }
  });

  it("works with a redis client", async () => {
    const { createClient } = await import("redis");
    const client = await createClient({ url }).connect();
    try {
      const store = redisStore(client, { ttl: 60 });
      await store.set(key, "from redis ☃");
      expect(await store.get(key)).toBe("from redis ☃");
      expect(await client.ttl(`islands:${key}`)).toBeGreaterThan(0);
      expect(await store.get(crypto.randomUUID())).toBeNull();
    } finally {
      client.destroy();
    }
  });
});

describe("r2Store", () => {
  it("reads and writes through the bucket with a prefix", async () => {
    const objects = new Map<string, string>();
    const store = r2Store({
      get: async (key) => {
        const text = objects.get(key);
        return text == null ? null : { text: async () => text };
      },
      put: async (key, value) => objects.set(key, value),
    });
    expect(await store.get("a")).toBeNull();
    await store.set("a", "text");
    expect(objects.get("islands/a")).toBe("text");
    expect(await store.get("a")).toBe("text");
  });
});

describe("s3Store", () => {
  const objects = new Map<string, string>();
  const server = createServer((request, response) => {
    const key = (request.url ?? "").split("?", 1)[0] ?? "";
    if (request.method === "PUT") {
      const chunks: Array<Buffer> = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        objects.set(key, Buffer.concat(chunks).toString());
        response.writeHead(200, { etag: '"x"' }).end();
      });
      return;
    }
    const text = objects.get(key);
    if (text == null) {
      response
        .writeHead(404, { "content-type": "application/xml" })
        .end("<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" }).end(text);
  });
  let client: S3Client;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    client = new S3Client({
      region: "auto",
      forcePathStyle: true,
      endpoint: `http://127.0.0.1:${typeof address === "object" ? address?.port : 0}`,
      credentials: { accessKeyId: "id", secretAccessKey: "secret" },
    });
  });

  afterAll(() => {
    client.destroy();
    server.close();
  });

  it("works with the AWS SDK", async () => {
    const store = s3Store({
      client,
      bucket: "parts",
      GetObjectCommand,
      PutObjectCommand,
    });
    expect(await store.get("missing")).toBeNull();
    await store.set("p:abc", "héllo ☃");
    expect(objects.get("/parts/islands/p%3Aabc")).toBe("héllo ☃");
    expect(await store.get("p:abc")).toBe("héllo ☃");
  });

  it("reports errors other than a missing key", async () => {
    const store = s3Store({
      client: {
        send: async () => {
          throw new Error("denied");
        },
      },
      bucket: "parts",
      GetObjectCommand: class {},
      PutObjectCommand: class {},
    });
    await expect(store.get("key")).rejects.toThrow("denied");
  });
});

describe("compressed", () => {
  it("round-trips text of any size and shrinks what repeats", async () => {
    const { entries, store } = memory();
    const wrapped = compressed(store);
    const large = "row,☃,1234\n".repeat(200_000);
    for (const text of ["", "short", "héllo ☃ 🗳️", large]) {
      await wrapped.set("key", text);
      expect(await wrapped.get("key")).toBe(text);
    }
    expect(entries.get("key")?.length).toBeLessThan(large.length / 50);
  });

  it("returns null for a missing key and reads entries stored uncompressed", async () => {
    const { store } = memory();
    await store.set("old", "[0,1,2]");
    const wrapped = compressed(store);
    expect(await wrapped.get("missing")).toBeNull();
    expect(await wrapped.get("old")).toBe("[0,1,2]");
  });
});
