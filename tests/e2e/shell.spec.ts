import { expect, test } from "@playwright/test";
import { reach, watchErrors } from "./helpers.ts";

const isSplit = process.env.FIXTURE_PLUGIN !== "0";
const DEV = "http://127.0.0.1:5304";

function seeded(path: string) {
  return `${path}?seed=${crypto.randomUUID()}`;
}

test.describe("pages with csr = false", () => {
  test.skip(!isSplit, "needs the Vite plugin");

  test("the page loads no SvelteKit client, only the island boot", async ({
    page,
  }) => {
    const scripts: Array<string> = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") {
        scripts.push(request.url());
      }
    });
    await page.goto(seeded("/shell"));
    await expect(page.locator("#svelte-islands")).toHaveCount(1);
    expect(scripts.some((url) => url.includes("/entry/start."))).toBe(false);
    expect(scripts.length).toBeGreaterThan(0);
  });

  test("a server island hydrates with its page values and contexts", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto(seeded("/shell"));
    await expect(page.getByTestId("shell-scope")).toHaveText("hello 5");
    await page.getByTestId("shell-bump").click();
    await expect(page.getByTestId("shell-bump")).toHaveText("bump 6");
    await expect(page.getByTestId("shell-scope")).toHaveText("hello 6");
    await expect(page.getByTestId("tone")).toHaveText("labeled warm none");
    await page.getByTestId("shell-static-press").click();
    await expect(page.getByTestId("shell-static-press")).toHaveText(
      "pressed 1",
    );
    expect(errors).toStrictEqual([]);
  });

  test("islands share the page's values", async ({ page }) => {
    await page.goto(seeded("/shell"));
    await page.getByTestId("shell-bump").click();
    await expect(page.getByTestId("shell-scope")).toHaveText("hello 6");
    const small = page.getByTestId("shell-small");
    await expect(small).toHaveText("3 5");
    await small.click();
    await expect(small).toHaveText("3 7");
    await expect(page.getByTestId("shell-scope")).toHaveText("hello 7");
    await expect(page.getByTestId("shell-bump")).toHaveText("bump 7");
  });

  test("a held press reaches the island after it hydrates", async ({
    page,
  }) => {
    await page.goto(seeded("/shell"));
    await page.getByTestId("shell-static-press").click();
    await expect(page.getByTestId("shell-static-press")).toHaveText(
      "pressed 1",
    );
  });

  test("deferred and client islands arrive and hydrate", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(seeded("/shell"));
    const deferred = await reach(page, "shell-deferred-press");
    await deferred.click();
    await expect(deferred).toHaveText("pressed 1");
    const client = await reach(page, "shell-client-press");
    await client.click();
    await expect(client).toHaveText("pressed 1");
    expect(errors).toStrictEqual([]);
  });

  test("speculation rules are added where SvelteKit doesn't route", async ({
    page,
  }) => {
    await page.goto(seeded("/shell"));
    await expect(page.locator("script[type=speculationrules]")).toHaveCount(1);
    await page.goto(seeded("/modes"));
    await expect(page.locator("script[type=speculationrules]")).toHaveCount(0);
    expect(await page.content()).toContain("@view-transition");
  });

  test("a captured function stays on the server and the island stays static", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto("/shell/function");
    await expect(page.getByTestId("shouted")).toHaveText("SHELL-FUNCTION 0");
    await expect(page.locator("#svelte-islands")).toHaveCount(0);
    expect(errors).toStrictEqual([]);
  });

  test("in dev, a captured function is an error that names it", async ({
    page,
  }) => {
    const response = await page.goto(`${DEV}/shell/function`);
    expect(response?.status()).toBe(500);
  });

  test("in dev, islands boot the same way", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${DEV}${seeded("/shell")}`);
    await page.getByTestId("shell-bump").click();
    await expect(page.getByTestId("shell-bump")).toHaveText("bump 6");
    await expect(page.getByTestId("tone")).toHaveText("labeled warm none");
    expect(errors.filter((error) => !error.includes("[vite]"))).toStrictEqual(
      [],
    );
  });
});

test("without the plugin, islands on a page with csr = false stay as server HTML", async ({
  page,
}) => {
  test.skip(isSplit, "checks the build without the Vite plugin");
  const errors = watchErrors(page);
  await page.goto(seeded("/shell"));
  await expect(page.getByTestId("shell-scope")).toHaveText("hello 5");
  await expect(page.locator("#svelte-islands")).toHaveCount(0);
  await expect(page.locator("script[type=speculationrules]")).toHaveCount(1);
  expect(errors).toStrictEqual([]);
});
