import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { hydrated, observed, watchErrors } from "./helpers.ts";

function seeded() {
  return `/input?seed=${crypto.randomUUID()}`;
}

async function slowParts(page: Page, delay: number) {
  await page.route("**/_parts/*.json", async (route) => {
    if (route.request().url().endsWith("/skeletons.json")) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.continue();
  });
}

function stateOf(page: Page, testId: string) {
  return page.locator("[data-island]", { has: page.getByTestId(testId) });
}

test.describe("held input", () => {
  test("text typed before hydration stays and reaches the component", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await slowParts(page, 1500);
    await page.goto(seeded());
    await hydrated(page);
    const island = stateOf(page, "form");
    await page.getByLabel("Name").pressSequentially("Ada");
    await page.getByLabel("Note").pressSequentially("ships at dawn");
    await page.getByLabel("Harbor").selectOption("south");
    await page.getByLabel("Urgent").check();
    await expect(island).toHaveAttribute("data-island-state", "static");
    await expect(island).toHaveAttribute("data-island-state", "live", {
      timeout: 10_000,
    });
    await expect(page.getByLabel("Name")).toHaveValue("Ada");
    await expect(page.getByLabel("Note")).toHaveValue("ships at dawn");
    await expect(page.getByLabel("Harbor")).toHaveValue("south");
    await expect(page.getByLabel("Urgent")).toBeChecked();
    await expect(page.getByTestId("echo")).toHaveText(
      "Ada|ships at dawn|south|true",
    );
    await page.getByLabel("Name").evaluate((field: HTMLInputElement) => {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    await page.keyboard.type(" L.");
    await expect(page.getByTestId("echo")).toHaveText(
      "Ada L.|ships at dawn|south|true",
    );
    expect(errors).toStrictEqual([]);
  });

  test("a form submitted before hydration is submitted again once it's live", async ({
    page,
  }) => {
    await slowParts(page, 1500);
    const path = seeded();
    await page.goto(path);
    await hydrated(page);
    await page.getByLabel("Name").pressSequentially("Grace");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("sent")).toHaveText("unsent");
    await expect(page.getByTestId("sent")).toHaveText("Grace||north|false", {
      timeout: 10_000,
    });
    expect(new URL(page.url()).search).toBe(new URL(path, page.url()).search);
  });

  test("pressing Enter in a field submits once", async ({ page }) => {
    await slowParts(page, 1000);
    await page.goto(seeded());
    await hydrated(page);
    await page.getByLabel("Note").pressSequentially("tide");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sent")).toHaveText("|tide|north|false", {
      timeout: 10_000,
    });
  });
});

test.describe("strategies", () => {
  test("with several strategies the first to fire wins", async ({ page }) => {
    await page.goto(seeded());
    await hydrated(page);
    await expect(stateOf(page, "either")).toHaveAttribute(
      "data-island-state",
      "live",
    );
    const events = await observed(page);
    expect(
      events.find(
        (event) => event.type === "hydrate" && event.name === "either.rows",
      ),
    ).toMatchObject({ when: "idle" });
  });
});

test.describe("prefetch", () => {
  test("an island near the viewport fetches its part when the browser is idle", async ({
    page,
  }) => {
    await page.goto(seeded());
    await hydrated(page);
    await expect
      .poll(async () =>
        (await observed(page)).some(
          (event) =>
            event.type === "load" &&
            event.name === "near.rows" &&
            event.isPrefetch === true,
        ),
      )
      .toBe(true);
    await expect(stateOf(page, "near")).toHaveAttribute(
      "data-island-state",
      "static",
    );
    const press = page.getByTestId("near-press");
    await press.click();
    await expect(press).toHaveText("pressed 1");
    const events = await observed(page);
    expect(
      events.find(
        (event) => event.type === "hydrate" && event.name === "near.rows",
      ),
    ).toMatchObject({ when: "interaction", isPrefetched: true });
  });

  test("an island with prefetch off waits for the visitor", async ({
    page,
  }) => {
    await page.goto(seeded());
    await hydrated(page);
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 500)),
    );
    const events = await observed(page);
    expect(
      events.some(
        (event) => event.type === "load" && event.name === "form.rows",
      ),
    ).toBe(false);
  });

  test("Save-Data turns prefetching off", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true, effectiveType: "4g" },
      });
    });
    await page.goto(seeded());
    await hydrated(page);
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 500)),
    );
    const events = await observed(page);
    expect(
      events.some(
        (event) => event.type === "load" && event.name === "near.rows",
      ),
    ).toBe(false);
  });
});
