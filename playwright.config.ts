import { defineConfig } from "@playwright/test";

const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const A = 5301;
const B = 5302;
const STATIC = 5303;
const DEV = 5304;

function node(port: number) {
  return {
    command: "node fixtures/app/build/index.js",
    port,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      HOST: "127.0.0.1",
      ORIGIN: `http://127.0.0.1:${port}`,
    },
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${A}`,
    ...(chromium != null && { launchOptions: { executablePath: chromium } }),
  },
  webServer: [
    node(A),
    node(B),
    {
      command: `npx vite dev --host 127.0.0.1 --port ${DEV} --strictPort`,
      cwd: "fixtures/app",
      port: DEV,
      reuseExistingServer: false,
    },
    {
      command: `node tests/e2e/static-server.ts fixtures/app/build-static ${STATIC}`,
      port: STATIC,
      reuseExistingServer: false,
    },
  ],
});
