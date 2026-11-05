import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

const B = "http://127.0.0.1:5302";
const STATIC = "http://127.0.0.1:5303";

function seeded() {
  return `/modes?seed=${crypto.randomUUID()}`;
}

function watchErrors(page: Page) {
  const errors: Array<string> = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

function partRequests(page: Page) {
  const urls: Array<string> = [];
  page.on("request", (request) => {
    if (request.url().includes("/_parts/")) {
      urls.push(request.url());
    }
  });
  return urls;
}

async function reach(page: Page, testId: string) {
  const island = page.getByTestId(testId);
  await expect(async () => {
    await page.evaluate(() => {
      const isAtEnd =
        scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
      scrollTo(0, isAtEnd ? 0 : scrollY + innerHeight);
    });
    await expect(island).toBeVisible({ timeout: 100 });
  }).toPass({ intervals: [50], timeout: 25_000 });
  return island;
}

async function hydrated(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelector("[data-island-state]") != null &&
      document.readyState === "complete",
  );
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("static HTML is in the page and outlines stand in for the rest", async ({
    page,
  }) => {
    await page.goto(seeded());
    await expect(
      page.getByRole("cell", { name: "static 299", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "deferred 299", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "deferred heading" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "client heading" }),
    ).toBeVisible();
    await expect(page.locator(".island-shell").first()).toBeHidden();
  });
});

test.describe("hydration", () => {
  test("a click on a static island hydrates it and counts", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto(seeded());
    await hydrated(page);
    const press = page.getByTestId("static-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
    await press.click();
    await expect(press).toHaveText("pressed 2");
    expect(errors).toStrictEqual([]);
  });

  test("a keyboard press counts once", async ({ page }) => {
    await page.goto(seeded());
    await hydrated(page);
    const press = page.getByTestId("static-press");
    await press.focus();
    await page.keyboard.press("Enter");
    await expect(press).toHaveText("pressed 1");
  });

  test("a never island stays as server HTML and asks for nothing", async ({
    page,
  }) => {
    const urls = partRequests(page);
    await page.goto(seeded());
    await hydrated(page);
    const press = page.getByTestId("never-press");
    await press.click();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 300)),
    );
    await expect(press).toHaveText("pressed 0");
    expect(urls.filter((url) => !url.endsWith("/skeletons"))).toStrictEqual([]);
  });
});

test.describe("deferred and client islands", () => {
  test("deferred HTML arrives near the viewport and then hydrates", async ({
    page,
    request,
  }) => {
    const path = seeded();
    const html = await (await request.get(path)).text();
    expect(html).not.toContain("deferred 299");
    await page.goto(path);
    await hydrated(page);
    const island = await reach(page, "deferred");
    await expect(
      island.getByRole("cell", { name: "deferred 299", exact: true }),
    ).toBeAttached();
    const press = page.getByTestId("deferred-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
  });

  test("a client island renders only in the browser", async ({
    page,
    request,
  }) => {
    const path = seeded();
    const html = await (await request.get(path)).text();
    expect(html).not.toContain("client 299");
    await page.goto(path);
    await hydrated(page);
    const island = await reach(page, "client");
    await expect(
      island.getByRole("cell", { name: "client 299", exact: true }),
    ).toBeAttached();
    const press = page.getByTestId("client-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
  });

  test("printing brings in everything before the print dialog", async ({
    page,
  }) => {
    await page.goto(seeded());
    await hydrated(page);
    const text = await page.evaluate(() => {
      dispatchEvent(new Event("beforeprint"));
      return document.body.textContent;
    });
    expect(text).toContain("static 299");
    expect(text).toContain("deferred 299");
    expect(text).toContain("client 299");
  });
});

test.describe("navigation", () => {
  test("client navigation, back, and forward keep every island working", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Modes", exact: true }).click();
    await expect(page).toHaveTitle("Modes");
    await expect(
      page
        .getByTestId("static")
        .getByRole("cell", { name: "static 299", exact: true }),
    ).toBeAttached();
    await page.goBack();
    await expect(page).toHaveTitle("Fixture");
    await page.goForward();
    await expect(page).toHaveTitle("Modes");
    const press = page.getByTestId("static-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
    expect(errors).toStrictEqual([]);
  });

  test("hovering a preload link fetches page data, and its parts load by the time it opens", async ({
    page,
  }) => {
    const data: Array<string> = [];
    page.on("request", (request) => {
      if (request.url().includes("__data.json")) {
        data.push(request.url());
      }
    });
    const urls = partRequests(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    urls.length = 0;
    const link = page.getByRole("link", { name: "Hover modes" });
    await expect(async () => {
      await page.mouse.move(0, 0);
      await link.hover();
      await page.waitForTimeout(200);
      expect(data.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
    await link.click();
    await expect
      .poll(() => urls.filter((url) => !url.endsWith("/skeletons")).length)
      .toBeGreaterThan(0);
  });
});

test.describe("recovery", () => {
  async function throughB(route: Route) {
    const { pathname, search } = new URL(route.request().url());
    const response = await route.fetch({ url: `${B}${pathname}${search}` });
    await route.fulfill({ response });
  }

  test("another server rebuilds a part it has never seen", async ({ page }) => {
    const statuses: Array<number> = [];
    page.on("response", (response) => {
      if (
        response.url().includes("/_parts/") &&
        !response.url().endsWith("/skeletons")
      ) {
        statuses.push(response.status());
      }
    });
    await page.route("**/_parts/*", throughB);
    await page.goto(seeded());
    await hydrated(page);
    const press = page.getByTestId("static-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
    expect(statuses).toContain(404);
    expect(statuses).toContain(200);
  });

  test("a part that stays gone reloads the page's data once", async ({
    page,
  }) => {
    let refused = 0;
    await page.route("**/_parts/*", async (route) => {
      if (route.request().url().endsWith("/skeletons") || refused >= 2) {
        await route.continue();
        return;
      }
      refused += 1;
      await route.fulfill({ status: 404 });
    });
    const data = page.waitForRequest((request) =>
      request.url().includes("__data.json"),
    );
    await page.goto(seeded());
    await hydrated(page);
    await page.getByTestId("static-press").click();
    await data;
    expect(refused).toBe(2);
  });

  test("a 503 is retried", async ({ page }) => {
    test.slow();
    let refused = 0;
    await page.route("**/_parts/*", async (route) => {
      if (route.request().url().endsWith("/skeletons") || refused >= 1) {
        await route.continue();
        return;
      }
      refused += 1;
      await route.fulfill({ status: 503 });
    });
    await page.goto(seeded());
    await hydrated(page);
    const press = page.getByTestId("static-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
    expect(refused).toBe(1);
  });

  test("a client island shows failed and retries from there", async ({
    page,
  }) => {
    test.slow();
    let isDown = true;
    await page.route("**/_parts/*", async (route) => {
      if (isDown && !route.request().url().endsWith("/skeletons")) {
        await route.fulfill({ status: 500 });
        return;
      }
      await route.continue();
    });
    await page.goto(seeded());
    await hydrated(page);
    const retry = await reach(page, "retry");
    isDown = false;
    await retry.click();
    await expect(page.getByTestId("client")).toBeVisible();
  });
});

test.describe("private parts", () => {
  test("stay in the page and never touch a public URL", async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    await context.addCookies([
      { name: "who", value: "alice", url: baseURL ?? "" },
    ]);
    const urls = partRequests(page);
    await page.goto("/private");
    await expect(page.getByTestId("secret")).toHaveText("secret-for-alice");
    const press = page.getByTestId("private-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
    expect(urls.filter((url) => !url.endsWith("/skeletons"))).toStrictEqual([]);
    const html = await page.content();
    expect(html).not.toContain("data-island-file");
    const shapes = await (await request.get("/_parts/skeletons")).text();
    expect(shapes).not.toContain("secret-for");
  });

  test("differ per visitor", async ({ request, baseURL }) => {
    const bob = await request.get("/private", {
      headers: { cookie: "who=bob" },
    });
    const carol = await request.get(`${baseURL}/private`, {
      headers: { cookie: "who=carol" },
    });
    expect(await bob.text()).toContain("secret-for-bob");
    const other = await carol.text();
    expect(other).toContain("secret-for-carol");
    expect(other).not.toContain("secret-for-bob");
  });
});

test.describe("the part route", () => {
  async function partOf(page: Page, path: string) {
    const url = page.waitForResponse((response) =>
      /\/_parts\/[\w-]{22}$/u.test(new URL(response.url()).pathname),
    );
    await page.goto(path);
    await hydrated(page);
    await page.getByTestId("static-press").hover();
    return new URL((await url).url()).pathname;
  }

  test("serves parts immutably, with Brotli and revalidation", async ({
    page,
    request,
  }) => {
    const path = await partOf(page, seeded());
    const plain = await request.get(path, {
      headers: { "accept-encoding": "identity" },
    });
    expect(plain.status()).toBe(200);
    expect(plain.headers()["cache-control"]).toContain("immutable");
    const squeezed = await request.get(path, {
      headers: { "accept-encoding": "br" },
    });
    expect(squeezed.headers()["content-encoding"]).toBe("br");
    const again = await request.get(path, {
      headers: { "if-none-match": plain.headers().etag ?? "" },
    });
    expect(again.status()).toBe(304);
  });

  test("won't fetch outside the site or back at itself", async ({
    request,
  }) => {
    const missing = "aaaaaaaaaaaaaaaaaaaaaa";
    for (const source of [
      "//evil.test/",
      String.raw`/\evil.test/`,
      "https://evil.test/",
      "/_parts/x",
      "/x/../_parts/x",
      "/%2e/_parts/x",
    ]) {
      for (const file of [missing, `${missing}.html`]) {
        const response = await request.get(
          `/_parts/${file}?u=${encodeURIComponent(source)}`,
        );
        expect(response.status(), `${file} ${source}`).toBe(404);
      }
    }
  });

  test("refuses other methods and malformed names", async ({ request }) => {
    expect(
      (
        await request.post("/_parts/aaaaaaaaaaaaaaaaaaaaaa", { data: {} })
      ).status(),
    ).toBe(404);
    expect((await request.get("/_parts/short")).status()).toBe(404);
  });
});

test.describe("prerendered pages", () => {
  for (const [host, base] of [
    ["a Node server", ""],
    ["a static host", STATIC],
  ] as const) {
    test(`work from ${host}`, async ({ page, request }) => {
      const errors = watchErrors(page);
      const html = await (await request.get(`${base}/prerendered`)).text();
      expect(html).toContain("static 299");
      expect(html).not.toContain("deferred 299");
      await page.goto(`${base}/prerendered`);
      await hydrated(page);
      const press = page.getByTestId("static-press");
      await press.click();
      await expect(press).toHaveText("pressed 1");
      const deferred = await reach(page, "deferred");
      await expect(
        deferred.getByRole("cell", { name: "deferred 299", exact: true }),
      ).toBeAttached();
      const client = await reach(page, "client");
      await expect(
        client.getByRole("cell", { name: "client 299", exact: true }),
      ).toBeAttached();
      expect(errors).toStrictEqual([]);
    });
  }
});

test.describe("rendering that waits", () => {
  test("islands whose children await still reach the page", async ({
    page,
    request,
  }) => {
    const errors = watchErrors(page);
    const response = await request.get("/waiting");
    expect(response.status()).toBe(200);
    await page.goto("/waiting");
    await hydrated(page);
    for (const label of ["static", "deferred", "client"]) {
      const island = await reach(page, label);
      await expect(island).toContainText(`${label} waited`);
    }
    expect(errors).toStrictEqual([]);
  });
});
