import type { ESLint, Rule, Scope } from "eslint";

type Call = Parameters<NonNullable<Rule.RuleListener["CallExpression"]>>[0];
type Argument = Call["arguments"][number];
type Ancestor = ReturnType<
  Rule.RuleContext["sourceCode"]["getAncestors"]
>[number];

const SERVER = "svelte-islands/server";
const LIBRARY = "svelte-islands";
const CLIENT_FILE =
  /(?:\.svelte(?:\.[jt]s)?|[/\\]\+(?:page|layout)\.[jt]s|[/\\]hooks\.client\.[jt]s)$/u;
const PER_VISITOR = new Set(["cookies", "locals"]);
const FUNCTIONS = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

function keyName(key: { type: string; name?: string; value?: unknown }) {
  if (key.type === "Identifier") {
    return key.name ?? null;
  }
  return typeof key.value === "string" ? key.value : null;
}

function partNames(context: Rule.RuleContext) {
  const names = new Set<string>();
  for (const statement of context.sourceCode.ast.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== SERVER
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        keyName(specifier.imported) === "part"
      ) {
        names.add(specifier.local.name);
      }
    }
  }
  return names;
}

function isPublic(options: Argument | undefined) {
  if (options == null) {
    return true;
  }
  if (options.type !== "ObjectExpression") {
    return false;
  }
  for (const property of options.properties) {
    if (property.type !== "Property") {
      return false;
    }
    if (keyName(property.key) !== "private") {
      continue;
    }
    return property.value.type === "Literal" && property.value.value === false;
  }
  return true;
}

function isReadPerVisitor(variable: Scope.Variable) {
  return variable.references.some((reference) => {
    const { parent } = reference.identifier as Rule.Node;
    return (
      parent?.type === "MemberExpression" &&
      parent.object === reference.identifier &&
      !parent.computed &&
      parent.property.type === "Identifier" &&
      PER_VISITOR.has(parent.property.name)
    );
  });
}

function readsPerVisitor(context: Rule.RuleContext, fn: Ancestor) {
  if (!FUNCTIONS.has(fn.type)) {
    return null;
  }
  for (const variable of context.sourceCode.getDeclaredVariables(fn)) {
    if (variable.references.length === 0) {
      continue;
    }
    if (PER_VISITOR.has(variable.name)) {
      return variable.name;
    }
    if (isReadPerVisitor(variable)) {
      return "the request event";
    }
  }
  return null;
}

const noPublicPerVisitorPart: Rule.RuleModule = {
  meta: {
    type: "problem",
    hasSuggestions: true,
    docs: {
      description:
        "Require `private: true` on a part made in a function that reads cookies or locals",
    },
    messages: {
      perVisitor:
        "This part gets a public, immutable URL, and this function reads {{source}}. If the value differs per visitor, pass { private: true }.",
      markPrivate: "Mark this part private",
    },
    schema: [],
  },
  create(context) {
    const names = partNames(context);
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !names.has(node.callee.name)) {
          return;
        }
        const options = node.arguments[2];
        const value = node.arguments[1];
        if (value == null || !isPublic(options)) {
          return;
        }
        for (const ancestor of context.sourceCode.getAncestors(node)) {
          const source = readsPerVisitor(context, ancestor);
          if (source == null) {
            continue;
          }
          context.report({
            node,
            messageId: "perVisitor",
            data: { source },
            suggest: [
              {
                messageId: "markPrivate",
                fix: (fixer) =>
                  options?.type === "ObjectExpression"
                    ? fixer.replaceText(
                        options,
                        options.properties.length === 0
                          ? "{ private: true }"
                          : `{ private: true, ${context.sourceCode
                              .getText(options)
                              .slice(1)
                              .trimStart()}`,
                      )
                    : fixer.insertTextAfter(value, ", { private: true }"),
              },
            ],
          });
          return;
        }
      },
    };
  },
};

const noServerImportInClient: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep `svelte-islands/server` out of components and universal load files",
    },
    messages: {
      server:
        "svelte-islands/server only runs on the server. Make parts in a +page.server or +layout.server file, and import the components from svelte-islands.",
    },
    schema: [],
  },
  create(context) {
    if (!CLIENT_FILE.test(context.filename)) {
      return {};
    }
    return {
      ImportDeclaration(node) {
        if (node.source.value === SERVER) {
          context.report({ node: node.source, messageId: "server" });
        }
      },
    };
  },
};

const noLoadedInClient: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Read a part's value with `peek` or `load`, not `.loaded`",
    },
    messages: {
      loaded:
        "part.loaded is only set where the part was made, so it's null in the browser for most parts. Read the value through <Island>, peek(), or load().",
    },
    schema: [],
  },
  create(context) {
    if (!CLIENT_FILE.test(context.filename)) {
      return {};
    }
    let isLibraryFile = false;
    const reads: Array<Rule.Node> = [];
    return {
      ImportDeclaration(node) {
        isLibraryFile ||= node.source.value === LIBRARY;
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === "Identifier" &&
          node.property.name === "loaded"
        ) {
          reads.push(node);
        }
      },
      "Program:exit": () => {
        if (!isLibraryFile) {
          return;
        }
        for (const read of reads) {
          context.report({ node: read, messageId: "loaded" });
        }
      },
    };
  },
};

function isBuilt(argument: Argument) {
  if (argument.type === "TemplateLiteral") {
    return argument.expressions.length > 0;
  }
  return argument.type === "BinaryExpression" && argument.operator === "+";
}

const stablePartName: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Use one fixed name per kind of data, so skeletons can be learned",
    },
    messages: {
      name: "Skeletons are learned per part name, so a name built from data never reuses one and the server keeps learning new ones. Use a fixed name for this kind of data.",
    },
    schema: [],
  },
  create(context) {
    const names = partNames(context);
    return {
      CallExpression(node) {
        const [name] = node.arguments;
        if (
          name != null &&
          node.callee.type === "Identifier" &&
          names.has(node.callee.name) &&
          isBuilt(name)
        ) {
          context.report({ node: name, messageId: "name" });
        }
      },
    };
  },
};

const rules = {
  "no-public-per-visitor-part": noPublicPerVisitorPart,
  "no-server-import-in-client": noServerImportInClient,
  "no-loaded-in-client": noLoadedInClient,
  "stable-part-name": stablePartName,
};

const plugin = {
  meta: { name: "svelte-islands" },
  rules,
} satisfies ESLint.Plugin;

/**
 * ESLint rules for svelte-islands, as a flat config plugin.
 *
 * Spread `configs.recommended` into your config to turn them all on:
 *
 * ```js
 * import islands from "svelte-islands/eslint";
 *
 * export default [islands.configs.recommended];
 * ```
 *
 * Rules also run on `<script>` blocks and markup once `eslint-plugin-svelte`
 * or `svelte-eslint-parser` handles your `.svelte` files.
 */
export default {
  ...plugin,
  configs: {
    recommended: {
      name: "svelte-islands/recommended",
      plugins: { "svelte-islands": plugin },
      rules: {
        "svelte-islands/no-public-per-visitor-part": "warn",
        "svelte-islands/no-server-import-in-client": "error",
        "svelte-islands/no-loaded-in-client": "error",
        "svelte-islands/stable-part-name": "warn",
      },
    },
  },
} satisfies ESLint.Plugin;
