import typescriptParser from "@typescript-eslint/parser";
import { Linter, RuleTester } from "eslint";
import svelteParser from "svelte-eslint-parser";
import { describe, expect, it } from "vitest";
import islands from "#lib/eslint.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const SERVER_FILE = "/app/src/routes/+page.server.ts";
const IMPORT = `import { part } from "svelte-islands/server";`;

describe("no-public-per-visitor-part", () => {
  tester.run(
    "no-public-per-visitor-part",
    islands.rules["no-public-per-visitor-part"],
    {
      valid: [
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = async ({ cookies }) => ({ a: part("a", await read(cookies), { private: true }) });`,
        },
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = async () => ({ a: part("a", await rows()) });`,
        },
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = async ({ cookies }) => ({ a: part("a", 1) });`,
        },
        {
          filename: SERVER_FILE,
          code: `${IMPORT} const options = get(); export const load = ({ locals }) => ({ a: part("a", locals.x, options) });`,
        },
        {
          filename: SERVER_FILE,
          code: `function part() {} export const load = ({ locals }) => ({ a: part("a", locals.x) });`,
        },
      ],
      invalid: [
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = async ({ cookies }) => ({ a: part("a", await read(cookies)) });`,
          errors: [
            {
              messageId: "perVisitor",
              data: { source: "cookies" },
              suggestions: [
                {
                  messageId: "markPrivate",
                  output: `${IMPORT} export const load = async ({ cookies }) => ({ a: part("a", await read(cookies), { private: true }) });`,
                },
              ],
            },
          ],
        },
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = (event) => ({ a: part("a", event.locals.user) });`,
          errors: [
            {
              messageId: "perVisitor",
              data: { source: "the request event" },
              suggestions: [
                {
                  messageId: "markPrivate",
                  output: `${IMPORT} export const load = (event) => ({ a: part("a", event.locals.user, { private: true }) });`,
                },
              ],
            },
          ],
        },
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = ({ locals }) => ({ a: part("a", locals.user, { fetch: "lazy" }) });`,
          errors: [
            {
              messageId: "perVisitor",
              suggestions: [
                {
                  messageId: "markPrivate",
                  output: `${IMPORT} export const load = ({ locals }) => ({ a: part("a", locals.user, { private: true, fetch: "lazy" }) });`,
                },
              ],
            },
          ],
        },
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = ({ locals }) => ({ a: part("a", locals.user, { private: false }) });`,
          errors: [{ messageId: "perVisitor", suggestions: 1 }],
        },
        {
          filename: SERVER_FILE,
          code: `${IMPORT} export const load = ({ locals }) => ({ a: part("a", locals.user, {}) });`,
          errors: [
            {
              messageId: "perVisitor",
              suggestions: [
                {
                  messageId: "markPrivate",
                  output: `${IMPORT} export const load = ({ locals }) => ({ a: part("a", locals.user, { private: true }) });`,
                },
              ],
            },
          ],
        },
        {
          filename: SERVER_FILE,
          code: `import { part as wrap } from "svelte-islands/server"; export const load = ({ cookies }) => ({ a: [1].map(() => wrap("a", cookies.get("x"))) });`,
          errors: [{ messageId: "perVisitor", suggestions: 1 }],
        },
      ],
    },
  );
});

describe("no-server-import-in-client", () => {
  tester.run(
    "no-server-import-in-client",
    islands.rules["no-server-import-in-client"],
    {
      valid: [
        { filename: SERVER_FILE, code: IMPORT },
        { filename: "/app/src/hooks.server.ts", code: IMPORT },
        { filename: "/app/src/lib/server/parts.ts", code: IMPORT },
        {
          filename: "/app/src/routes/+page.ts",
          code: `import { Island } from "svelte-islands";`,
        },
      ],
      invalid: [
        {
          filename: "/app/src/routes/+page.ts",
          code: IMPORT,
          errors: [{ messageId: "server" }],
        },
        {
          filename: "/app/src/routes/+layout.js",
          code: IMPORT,
          errors: [{ messageId: "server" }],
        },
        {
          filename: "/app/src/hooks.client.ts",
          code: IMPORT,
          errors: [{ messageId: "server" }],
        },
        {
          filename: String.raw`C:\app\src\routes\+page.ts`,
          code: IMPORT,
          errors: [{ messageId: "server" }],
        },
        {
          filename: "/app/src/lib/state.svelte.ts",
          code: IMPORT,
          errors: [{ messageId: "server" }],
        },
      ],
    },
  );
});

describe("no-loaded-in-client", () => {
  tester.run("no-loaded-in-client", islands.rules["no-loaded-in-client"], {
    valid: [
      {
        filename: SERVER_FILE,
        code: `import { Island } from "svelte-islands"; const a = data.loaded;`,
      },
      { filename: "/app/src/routes/+page.ts", code: `const a = image.loaded;` },
      {
        filename: "/app/src/routes/+page.ts",
        code: `import { peek } from "svelte-islands"; const a = peek(part);`,
      },
    ],
    invalid: [
      {
        filename: "/app/src/routes/+page.ts",
        code: `import { peek } from "svelte-islands"; const a = data.rows.loaded;`,
        errors: [{ messageId: "loaded" }],
      },
    ],
  });
});

describe("stable-part-name", () => {
  tester.run("stable-part-name", islands.rules["stable-part-name"], {
    valid: [
      { filename: SERVER_FILE, code: `${IMPORT} part("rows", 1);` },
      { filename: SERVER_FILE, code: `${IMPORT} part(\`rows\`, 1);` },
      { filename: SERVER_FILE, code: `${IMPORT} part(name, 1);` },
      { filename: SERVER_FILE, code: `other(\`rows-\${id}\`, 1);` },
    ],
    invalid: [
      {
        filename: SERVER_FILE,
        code: `${IMPORT} part(\`rows-\${id}\`, 1);`,
        errors: [{ messageId: "name" }],
      },
      {
        filename: SERVER_FILE,
        code: `${IMPORT} part("rows-" + id, 1);`,
        errors: [{ messageId: "name" }],
      },
    ],
  });
});

describe("in a Svelte component", () => {
  function lint(code: string) {
    const config = [
      islands.configs.recommended,
      {
        files: ["**/*.svelte"],
        languageOptions: {
          parser: svelteParser,
          parserOptions: { parser: typescriptParser },
        },
      },
    ];
    return new Linter({ configType: "flat", cwd: "/app" })
      .verify(code, config, { filename: "/app/src/routes/+page.svelte" })
      .map((message) => message.ruleId ?? message.message);
  }

  it("flags a server import in the script", () => {
    expect(
      lint(
        `<script lang="ts">import { part } from "svelte-islands/server"; let value: number = 1;</script>`,
      ),
    ).toEqual(["svelte-islands/no-server-import-in-client"]);
  });

  it("flags .loaded read in the markup", () => {
    expect(
      lint(
        '<script lang="ts">import { Island } from "svelte-islands"; let { data } = $props();</script><p>{data.rows.loaded}</p>',
      ),
    ).toEqual(["svelte-islands/no-loaded-in-client"]);
  });

  it("allows a type query on .loaded", () => {
    expect(
      lint(
        `<script lang="ts">import { Island } from "svelte-islands"; let { data } = $props(); type Rows = NonNullable<typeof data.rows.loaded>;</script>`,
      ),
    ).toEqual([]);
  });
});

describe("the recommended config", () => {
  it("turns on every rule", () => {
    expect(new Set(Object.keys(islands.configs.recommended.rules))).toEqual(
      new Set(
        Object.keys(islands.rules).map((name) => `svelte-islands/${name}`),
      ),
    );
  });
});
