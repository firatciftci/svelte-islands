import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

const A = "http://127.0.0.1:5301";
const B = "http://127.0.0.1:5302";
const REQUESTS = 20;

async function freshPart(request: APIRequestContext) {
  const source = `/modes?seed=${crypto.randomUUID()}`;
  const html = await (await request.get(`${A}${source}`)).text();
  const hash = /data-island="([^"]+)" [^>]*data-island-state="static"/u.exec(
    html,
  )?.[1];
  if (hash == null) {
    throw new Error("The page has no static island.");
  }
  return { hash, source };
}

async function statuses(
  run: (at: number) => Promise<{ status: () => number }>,
) {
  const responses = await Promise.all(
    Array.from({ length: REQUESTS }, async (_, at) => run(at)),
  );
  return new Set(responses.map((response) => response.status()));
}

test("a part written on one server reads from R2 on another", async ({
  request,
}) => {
  test.skip(process.env.FIXTURE_STORE !== "r2", "This needs the R2 store.");
  const { hash } = await freshPart(request);
  await expect
    .poll(async () => (await request.get(`${B}/_parts/${hash}`)).status(), {
      timeout: 15_000,
    })
    .toBe(200);
  const body = await (await request.get(`${B}/_parts/${hash}`)).text();
  expect(body.length).toBeGreaterThan(100);
});

test("simultaneous requests for one part all succeed", async ({ request }) => {
  const { hash } = await freshPart(request);
  const seen = await statuses(async () =>
    request.get(`${A}/_parts/${hash}`, {
      headers: { "accept-encoding": "br" },
    }),
  );
  expect(seen).toEqual(new Set([200]));
});

test("simultaneous rebuilds of one page all succeed", async ({ request }) => {
  const { hash, source } = await freshPart(request);
  const seen = await statuses(async () =>
    request.get(`${B}/_parts/${hash}?u=${encodeURIComponent(source)}`),
  );
  expect(seen).toEqual(new Set([200]));
});

test("simultaneous page requests share the skeleton names", async ({
  request,
}) => {
  const seen = await statuses(async (at) =>
    request.get(`${B}/modes?seed=${crypto.randomUUID()}-${at}`),
  );
  expect(seen).toEqual(new Set([200]));
});
