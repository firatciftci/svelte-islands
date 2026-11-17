import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function local(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: "boot",
      transform(code) {
        return code.replaceAll(
          '"__svelte_islands_boot__"',
          JSON.stringify(JSON.stringify(["_app/islands.js", "_app/shared.js"])),
        );
      },
    },
  ],
  resolve: {
    alias: {
      "$app/env": local("tests/stubs/env.ts"),
      "$app/navigation": local("tests/stubs/navigation.ts"),
      "$app/paths": local("tests/stubs/paths.ts"),
      "$app/server": local("tests/stubs/server.ts"),
    },
  },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"] },
});
