import antfu, {
  GLOB_HTML,
  GLOB_MARKDOWN,
  GLOB_STYLE,
  GLOB_XML,
  parserPlain,
} from "@antfu/eslint-config";

/** @type {import('@antfu/eslint-config').OptionsOverrides['overrides']} */
const tsSyntacticOverrides = {
  "ts/array-type": ["error", { default: "generic" }],
  "ts/consistent-indexed-object-style": ["error", "record"],
  "ts/consistent-type-definitions": ["error", "type"],
  "ts/consistent-type-imports": [
    "warn",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],
  "ts/no-dynamic-delete": "error",
  "ts/no-explicit-any": "error",
  "ts/no-inferrable-types": "error",
};

/** @type {import('@antfu/eslint-config').OptionsOverrides['overrides']} */
const tsTypeAwareOverrides = {
  "ts/non-nullable-type-assertion-style": "error",
  "ts/no-array-delete": "error",
  "ts/no-duplicate-type-constituents": "error",
  "ts/no-redundant-type-constituents": "error",
  "ts/no-unnecessary-boolean-literal-compare": "error",
  "ts/no-unnecessary-condition": "error",
  "ts/prefer-includes": "warn",
  "ts/prefer-nullish-coalescing": "error",
  "ts/prefer-optional-chain": "warn",
  "ts/prefer-regexp-exec": "error",
  "ts/prefer-string-starts-ends-with": "error",
  "ts/switch-exhaustiveness-check": [
    "warn",
    { considerDefaultExhaustiveForUnions: true },
  ],
  "ts/use-unknown-in-catch-callback-variable": "error",
};

export default antfu({
  ignores: ["fixtures/**", "site/**"],
  stylistic: false,
  markdown: false,
  antislop: true,
  svelte: {
    overrides: {
      "svelte/block-lang": ["error", { script: "ts" }],
      "svelte/button-has-type": "error",
      "svelte/html-closing-bracket-spacing": "error",
      "svelte/html-quotes": ["error", { prefer: "double" }],
      "svelte/html-self-closing": "error",
      "svelte/no-add-event-listener": "error",
      "svelte/no-top-level-browser-globals": "error",
      "svelte/no-useless-mustaches": "off",
      "svelte/prefer-class-directive": "error",
      "svelte/prefer-const": "error",
      "svelte/prefer-derived-over-derived-by": "error",
      "svelte/prefer-style-directive": "error",
      "svelte/valid-compile": "error",
      ...tsSyntacticOverrides,
      ...tsTypeAwareOverrides,
    },
  },
  typescript: {
    tsconfigPath: "tsconfig.json",
    filesTypeAware: ["**/*.?([cm])ts?(x)", "**/*.svelte"],
    parserOptions: { extraFileExtensions: [".svelte"] },
    erasableOnly: true,
    overrides: tsSyntacticOverrides,
    overridesTypeAware: tsTypeAwareOverrides,
  },
  unicorn: {
    allRecommended: true,
    overrides: {
      "unicorn/better-regex": "error",
      "unicorn/filename-case": [
        "error",
        {
          case: "kebabCase",
          ignore: ["README.md", "CHANGELOG.md", "LICENSE", "CONTRIBUTING.md"],
        },
      ],
      "unicorn/max-nested-calls": "off",
      "unicorn/name-replacements": "off",
      "unicorn/no-break-in-nested-loop": "off",
      "unicorn/no-nested-ternary": "off",
      "unicorn/no-non-function-verb-prefix": "off",
      "unicorn/no-null": "off",
      "unicorn/no-negated-condition": "off",
      "unicorn/no-top-level-side-effects": "off",
      "unicorn/no-thenable": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/prefer-ternary": "off",
      "unicorn/single-line-block-comment-style": "off",
    },
  },
  imports: {
    overrides: {
      "perfectionist/sort-imports": [
        "error",
        {
          tsconfig: { rootDir: import.meta.dirname, filename: "tsconfig.json" },
          internalPattern: ["^#lib(/.+)?$"],
          newlinesBetween: 0,
          order: "asc",
          type: "natural",
        },
      ],
    },
  },
  rules: {
    "antfu/no-top-level-await": ["off"],
    "jsdoc/check-param-names": ["warn", { checkDestructured: false }],
    "jsonc/sort-keys": "off",
    "node/no-process-env": "error",
    "no-console": ["warn"],
    "no-restricted-imports": ["error", { patterns: ["..*"] }],
    "no-unused-vars": "off",
    "pnpm/yaml-enforce-settings": "off",
    "prefer-const": "off",
  },
}).append(
  {
    name: "local/sw",
    files: ["src/lib/sw.ts"],
    rules: { "unicorn/consistent-boolean-name": "off" },
  },
  {
    name: "local/docs",
    files: ["docs/**", "README.md"],
    rules: { "slop/no-em-dash": "off" },
  },
  {
    name: "local/tests",
    files: ["tests/**", "playwright.config.ts", "playwright.workers.config.ts"],
    rules: {
      "node/no-process-env": "off",
      "node/prefer-global/process": "off",
      "ts/promise-function-async": "off",
      "unicorn/import-style": "off",
      "e18e/prefer-array-fill": "off",
      "no-sparse-arrays": "off",
      "slop/no-chained-type-assertions": "off",
      "unicorn/consistent-boolean-name": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-await-expression-member": "off",
      "unicorn/prefer-structured-clone": "off",
    },
  },
  {
    name: "local/decoder",
    files: ["src/lib/pack.ts"],
    rules: { "unicorn/no-new-array": "off" },
  },
  {
    name: "local/plain-text-parser",
    files: [GLOB_STYLE, GLOB_MARKDOWN, GLOB_XML, GLOB_HTML],
    languageOptions: { parser: parserPlain },
  },
);
