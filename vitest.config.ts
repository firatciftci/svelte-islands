import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function local(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "$app/env": local("tests/stubs/env.ts"),
      "$app/navigation": local("tests/stubs/navigation.ts"),
      "$app/server": local("tests/stubs/server.ts"),
    },
  },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"] },
});
