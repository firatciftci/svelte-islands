import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const BASE = "http://127.0.0.1:5301";
const STATIC = "http://127.0.0.1:5303";
const isSplit = process.env.FIXTURE_PLUGIN !== "0";

async function visit(page: Page, name: string) {
  await page.context().addCookies([
    { name: "visitor", value: name, url: BASE },
    { name: "visitor", value: name, url: STATIC },
  ]);
}

function freshRequests(page: Page) {
  const found: Array<string> = [];
  page.on("request", (request) => {
    if (request.url().includes("/_parts/fresh")) {
      found.push(request.url());
    }
  });
  return found;
}

test.describe("fresh islands", () => {
  test("a cached page is the same for every visitor, with a skeleton where each fresh island goes", async ({
    request,
  }) => {
    const response = await request.get("/fresh/live", {
      headers: { cookie: "visitor=Ada" },
    });
    expect(response.headers()["cache-control"]).toBe("public, max-age=60");
    const html = await response.text();
    expect(html).toContain('data-island-state="fresh"');
    expect(html).not.toContain("Ada");
    expect(html).not.toContain('data-testid="visitor-name"');
  });

  test("a cached page fills every fresh island with one private request", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const requests = freshRequests(page);
    await visit(page, "Ada");
    const answered = page.waitForResponse((response) =>
      response.url().includes("/_parts/fresh"),
    );
    await page.goto("/fresh/live");
    const response = await answered;
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.getByTestId("visitor-name")).toHaveText("Ada");
    await expect(page.getByTestId("basket-name")).toHaveText("Ada item 0");
    await page.getByTestId("visitor-press").click();
    await expect(page.getByTestId("visitor-press")).toHaveText("pressed 1");
    expect(requests).toHaveLength(1);
    expect(errors).toStrictEqual([]);
  });

  test("a fresh island asks for its value after a client navigation too", async ({
    page,
  }) => {
    await visit(page, "Ada");
    await page.goto("/");
    await page.waitForFunction(
      () => document.documentElement.dataset.hydrated === "true",
    );
    await page.getByRole("link", { name: "Fresh" }).click();
    await expect(page.getByTestId("visitor-name")).toHaveText("Ada");
    await expect(page.getByTestId("basket-name")).toHaveText("Ada item 0");
  });

  test("a prerendered page can't be rendered again, so its fresh islands show the fallback", async ({
    page,
  }) => {
    await visit(page, "Ada");
    await page.goto("/fresh");
    await expect(page.getByTestId("visitor-name")).toHaveText("guest");
    await page.getByTestId("visitor-press").click();
    await expect(page.getByTestId("visitor-press")).toHaveText("pressed 1");
  });

  test("a fresh island's part is never published", async ({ page, request }) => {
    await visit(page, "Grace");
    const answered = page.waitForResponse((response) =>
      response.url().includes("/_parts/fresh"),
    );
    await page.goto("/fresh/live");
    const text = await (await answered).text();
    const hashes = [...text.matchAll(/\\?"([\w-]{22})\\?"/gu)].map(
      ([, hash = ""]) => hash,
    );
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect((await request.get(`/_parts/${hash}.json`)).status()).toBe(404);
    }
  });

  test("on a page with csr = false, the island boot fills fresh islands", async ({
    page,
  }) => {
    test.skip(!isSplit, "needs the Vite plugin");
    await visit(page, "Ada");
    await page.goto("/fresh/shell");
    await expect(page.getByTestId("visitor-name")).toHaveText("Ada");
    await page.getByTestId("visitor-press").click();
    await expect(page.getByTestId("visitor-press")).toHaveText("pressed 1");
  });

  test("on a static host, a fresh island renders the page's own value", async ({
    page,
  }) => {
    await visit(page, "Ada");
    await page.goto(`${STATIC}/fresh`);
    await expect(page.getByTestId("visitor-name")).toHaveText("guest");
    await page.getByTestId("visitor-press").click();
    await expect(page.getByTestId("visitor-press")).toHaveText("pressed 1");
  });
});
