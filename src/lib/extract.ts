import type { AST } from "svelte/compiler";
import MagicString from "magic-string";
import { createHash } from "node:crypto";
import { parse } from "svelte/compiler";

type Node = { type: string; start: number; end: number } & Record<
  string,
  unknown
>;

type Imported = {
  source: string;
  kind: "default" | "namespace" | "named";
  imported: string;
  attributes: string;
};

type Declaration = {
  name: string;
  scope: Scope;
  kind: "template" | "snippet" | "local" | "import" | "store";
  snippet?: { node: AST.SnippetBlock; scope: Scope };
  imported?: Imported;
};

type Reference = {
  name: string;
  start: number;
  end: number;
  role:
    | "expression"
    | "shorthand-property"
    | "shorthand-attribute"
    | "shorthand-directive"
    | "shorthand-style"
    | "component"
    | "directive"
    | "debug";
  owner: Node | null;
  isWrite: boolean;
  declaration: Declaration | null;
};

class Scope {
  readonly names = new Map<string, Declaration>();
  readonly parent: Scope | null;

  constructor(parent: Scope | null) {
    this.parent = parent;
  }

  declare(name: string, extra: Omit<Declaration, "name" | "scope">) {
    this.names.set(name, { name, scope: this, ...extra });
  }

  lookup(name: string): Declaration | null {
    return this.names.get(name) ?? this.parent?.lookup(name) ?? null;
  }
}

const SKIPPED_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "leadingComments",
  "trailingComments",
  "metadata",
  "decorators",
]);

const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

const RUNES = new Set([
  "$state",
  "$derived",
  "$effect",
  "$props",
  "$bindable",
  "$inspect",
  "$host",
]);

function asNode(value: object): Node {
  return value as Node;
}

function nodesOf(values: ReadonlyArray<object>): Array<Node> {
  return values.map((value) => asNode(value));
}

function isSnippetBlock(node: Node): node is Node & AST.SnippetBlock {
  return node.type === "SnippetBlock";
}

function isComponent(node: Node): node is Node & AST.Component {
  return node.type === "Component";
}

function isElement(
  node: Node,
): node is Node & (AST.RegularElement | AST.SvelteElement) {
  return node.type === "RegularElement" || node.type === "SvelteElement";
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value != null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function children(node: Node): Array<Node> {
  const found: Array<Node> = [];
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          found.push(item);
        }
      }
    } else if (isNode(value)) {
      found.push(value);
    }
  }
  return found;
}

function namesOf(pattern: Node | null | undefined, into: Array<string> = []) {
  if (pattern == null) {
    return into;
  }
  switch (pattern.type) {
    case "Identifier": {
      into.push(pattern.name as string);
      break;
    }
    case "ObjectPattern": {
      for (const property of pattern.properties as Array<Node>) {
        namesOf(
          property.type === "RestElement"
            ? (property.argument as Node)
            : (property.value as Node),
          into,
        );
      }
      break;
    }
    case "ArrayPattern": {
      for (const element of pattern.elements as Array<Node | null>) {
        namesOf(element, into);
      }
      break;
    }
    case "RestElement": {
      namesOf(pattern.argument as Node, into);
      break;
    }
    case "AssignmentPattern": {
      namesOf(pattern.left as Node, into);
      break;
    }
    case "TSParameterProperty": {
      namesOf(pattern.parameter as Node, into);
      break;
    }
  }
  return into;
}

const BLOCKS = new Set([
  "IfBlock",
  "EachBlock",
  "AwaitBlock",
  "KeyBlock",
  "SnippetBlock",
]);

const ELEMENT_LIKE = new Set([
  "RegularElement",
  "Component",
  "SvelteElement",
  "SvelteComponent",
  "SvelteBoundary",
  "SvelteFragment",
  "SvelteHead",
  "SvelteBody",
  "SvelteWindow",
  "SvelteDocument",
  "TitleElement",
  "SlotElement",
]);

const KEYED = new Set(["Property", "MethodDefinition", "PropertyDefinition"]);

const NAMED_DIRECTIVES = new Set([
  "UseDirective",
  "TransitionDirective",
  "AnimateDirective",
]);

const LEGACY_PROPS = new Set(["$$props", "$$restProps", "$$slots"]);

const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function isFunction(node: Node) {
  return FUNCTIONS.has(node.type);
}

function hoistVars(node: Node, into: Array<string>) {
  for (const child of children(node)) {
    if (isFunction(child)) {
      continue;
    }
    if (child.type === "VariableDeclaration" && child.kind === "var") {
      for (const declarator of child.declarations as Array<Node>) {
        namesOf(declarator.id as Node, into);
      }
    }
    hoistVars(child, into);
  }
}

class Walker {
  readonly references: Array<Reference> = [];
  readonly inner = new Set<Scope>();
  readonly problems: Array<string> = [];

  scope(parent: Scope) {
    const made = new Scope(parent);
    this.inner.add(made);
    return made;
  }

  reference(
    name: string,
    node: { start: number; end: number },
    scope: Scope,
    role: Reference["role"] = "expression",
    owner: Node | null = null,
    isWrite = false,
  ) {
    if (LEGACY_PROPS.has(name)) {
      this.problems.push(`it reads ${name}`);
      return;
    }
    let declaration = scope.lookup(name);
    if (declaration == null && name.startsWith("$") && !RUNES.has(name)) {
      const store = scope.lookup(name.slice(1));
      if (store != null && store.kind !== "template") {
        declaration = { name, scope: store.scope, kind: "store" };
      }
    }
    this.references.push({
      name,
      start: node.start,
      end: node.end,
      role,
      owner,
      isWrite,
      declaration,
    });
  }

  declarePattern(pattern: Node | null | undefined, scope: Scope) {
    for (const name of namesOf(pattern)) {
      scope.declare(name, { kind: "template" });
    }
  }

  defaults(pattern: Node | null | undefined, scope: Scope) {
    if (pattern == null) {
      return;
    }
    switch (pattern.type) {
      case "AssignmentPattern": {
        this.defaults(pattern.left as Node, scope);
        this.expression(pattern.right as Node, scope);
        break;
      }
      case "ObjectPattern": {
        for (const property of pattern.properties as Array<Node>) {
          if (property.type === "RestElement") {
            this.defaults(property.argument as Node, scope);
          } else {
            if (property.computed === true) {
              this.expression(property.key as Node, scope);
            }
            this.defaults(property.value as Node, scope);
          }
        }
        break;
      }
      case "ArrayPattern": {
        for (const element of pattern.elements as Array<Node | null>) {
          this.defaults(element, scope);
        }
        break;
      }
      case "RestElement": {
        this.defaults(pattern.argument as Node, scope);
        break;
      }
    }
  }

  target(pattern: Node, scope: Scope) {
    switch (pattern.type) {
      case "Identifier": {
        this.reference(
          pattern.name as string,
          pattern,
          scope,
          "expression",
          null,
          true,
        );
        break;
      }
      case "ObjectPattern": {
        for (const property of pattern.properties as Array<Node>) {
          if (property.type === "RestElement") {
            this.target(property.argument as Node, scope);
          } else {
            if (property.computed === true) {
              this.expression(property.key as Node, scope);
            }
            this.target(property.value as Node, scope);
          }
        }
        break;
      }
      case "ArrayPattern": {
        for (const element of pattern.elements as Array<Node | null>) {
          if (element != null) {
            this.target(element, scope);
          }
        }
        break;
      }
      case "RestElement": {
        this.target(pattern.argument as Node, scope);
        break;
      }
      case "AssignmentPattern": {
        this.target(pattern.left as Node, scope);
        this.expression(pattern.right as Node, scope);
        break;
      }
      default: {
        this.expression(pattern, scope);
      }
    }
  }

  fn(node: Node, scope: Scope) {
    const inner = this.scope(scope);
    if (node.type === "FunctionExpression" && isNode(node.id)) {
      inner.declare(node.id.name as string, { kind: "template" });
    }
    for (const param of node.params as Array<Node>) {
      this.declarePattern(param, inner);
    }
    const vars: Array<string> = [];
    hoistVars(node.body as Node, vars);
    for (const name of vars) {
      inner.declare(name, { kind: "template" });
    }
    for (const param of node.params as Array<Node>) {
      this.defaults(param, inner);
    }
    const body = node.body as Node;
    if (body.type === "BlockStatement") {
      this.statements(body.body as Array<Node>, inner);
    } else {
      this.expression(body, inner);
    }
  }

  statements(body: Array<Node>, scope: Scope) {
    for (const statement of body) {
      if (
        statement.type === "VariableDeclaration" &&
        statement.kind !== "var"
      ) {
        for (const declarator of statement.declarations as Array<Node>) {
          this.declarePattern(declarator.id as Node, scope);
        }
      } else if (
        (statement.type === "FunctionDeclaration" ||
          statement.type === "ClassDeclaration") &&
        isNode(statement.id)
      ) {
        scope.declare(statement.id.name as string, { kind: "template" });
      }
    }
    for (const statement of body) {
      this.expression(statement, scope);
    }
  }

  expression(node: Node | null | undefined, scope: Scope): void {
    if (node == null) {
      return;
    }
    if (TYPE_WRAPPERS.has(node.type)) {
      this.expression(node.expression as Node, scope);
      return;
    }
    if (node.type.startsWith("TS")) {
      return;
    }
    switch (node.type) {
      case "Identifier": {
        this.reference(node.name as string, node, scope);
        return;
      }
      case "MemberExpression": {
        this.expression(node.object as Node, scope);
        if (node.computed === true) {
          this.expression(node.property as Node, scope);
        }
        return;
      }
      case "Property": {
        if (node.computed === true) {
          this.expression(node.key as Node, scope);
        }
        const value = node.value as Node;
        if (node.shorthand === true && value.type === "Identifier") {
          this.reference(
            value.name as string,
            value,
            scope,
            "shorthand-property",
          );
        } else {
          this.expression(value, scope);
        }
        return;
      }
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty": {
        if (node.computed === true) {
          this.expression(node.key as Node, scope);
        }
        this.expression(node.value as Node, scope);
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "FunctionDeclaration": {
        this.fn(node, scope);
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        const inner = this.scope(scope);
        if (isNode(node.id)) {
          inner.declare(node.id.name as string, { kind: "template" });
        }
        this.expression(node.superClass as Node, inner);
        this.expression(node.body as Node, inner);
        return;
      }
      case "BlockStatement":
      case "StaticBlock": {
        const inner = this.scope(scope);
        this.statements(node.body as Array<Node>, inner);
        return;
      }
      case "VariableDeclaration": {
        for (const declarator of node.declarations as Array<Node>) {
          this.defaults(declarator.id as Node, scope);
          this.expression(declarator.init as Node, scope);
        }
        return;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const inner = this.scope(scope);
        const head = (node.init ?? node.left) as Node | null;
        if (head?.type === "VariableDeclaration") {
          for (const declarator of head.declarations as Array<Node>) {
            this.declarePattern(declarator.id as Node, inner);
          }
          this.expression(head, inner);
        } else if (head != null) {
          if (node.type === "ForStatement") {
            this.expression(head, inner);
          } else {
            this.target(head, inner);
          }
        }
        this.expression(node.test as Node, inner);
        this.expression(node.update as Node, inner);
        this.expression(node.right as Node, inner);
        this.expression(node.body as Node, inner);
        return;
      }
      case "CatchClause": {
        const inner = this.scope(scope);
        this.declarePattern(node.param as Node, inner);
        this.defaults(node.param as Node, inner);
        this.expression(node.body as Node, inner);
        return;
      }
      case "SwitchStatement": {
        this.expression(node.discriminant as Node, scope);
        const inner = this.scope(scope);
        const cases = node.cases as Array<Node>;
        this.statements(
          cases.flatMap((each) => each.consequent as Array<Node>),
          inner,
        );
        for (const each of cases) {
          this.expression(each.test as Node | null, inner);
        }
        return;
      }
      case "LabeledStatement": {
        this.expression(node.body as Node, scope);
        return;
      }
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
      case "Literal":
      case "ThisExpression":
      case "Super":
      case "EmptyStatement":
      case "DebuggerStatement": {
        return;
      }
      case "AssignmentExpression": {
        this.target(node.left as Node, scope);
        this.expression(node.right as Node, scope);
        return;
      }
      case "UpdateExpression": {
        const argument = node.argument as Node;
        if (argument.type === "Identifier") {
          this.reference(
            argument.name as string,
            argument,
            scope,
            "expression",
            null,
            true,
          );
        } else {
          this.expression(argument, scope);
        }
        return;
      }
      default: {
        for (const child of children(node)) {
          this.expression(child, scope);
        }
      }
    }
  }

  attribute(attribute: Node, scope: Scope, code: string) {
    switch (attribute.type) {
      case "Attribute": {
        const { value } = attribute;
        if (value === true) {
          return;
        }
        const parts = (Array.isArray(value) ? value : [value]) as Array<Node>;
        for (const part of parts) {
          if (part.type !== "ExpressionTag") {
            continue;
          }
          const expression = part.expression as Node;
          if (
            !Array.isArray(value) &&
            code[attribute.start] === "{" &&
            expression.type === "Identifier"
          ) {
            this.reference(
              expression.name as string,
              expression,
              scope,
              "shorthand-attribute",
              attribute,
            );
          } else {
            this.expression(expression, scope);
          }
        }
        return;
      }
      case "SpreadAttribute":
      case "AttachTag": {
        this.expression(attribute.expression as Node, scope);
        return;
      }
      case "BindDirective": {
        const expression = attribute.expression as Node;
        const isShorthand = code[attribute.end - 1] !== "}";
        if (expression.type === "Identifier") {
          this.reference(
            expression.name as string,
            expression,
            scope,
            isShorthand ? "shorthand-directive" : "expression",
            attribute,
            true,
          );
        } else {
          this.expression(expression, scope);
        }
        return;
      }
      case "ClassDirective": {
        const expression = attribute.expression as Node;
        if (
          code[attribute.end - 1] !== "}" &&
          expression.type === "Identifier"
        ) {
          this.reference(
            expression.name as string,
            expression,
            scope,
            "shorthand-directive",
            attribute,
          );
        } else {
          this.expression(expression, scope);
        }
        return;
      }
      case "StyleDirective": {
        const { value } = attribute;
        if (value === true) {
          this.reference(
            attribute.name as string,
            attribute,
            scope,
            "shorthand-style",
            attribute,
          );
          return;
        }
        const parts = (Array.isArray(value) ? value : [value]) as Array<Node>;
        for (const part of parts) {
          if (part.type === "ExpressionTag") {
            this.expression(part.expression as Node, scope);
          }
        }
        return;
      }
      case "OnDirective": {
        this.expression(attribute.expression as Node | null, scope);
        return;
      }
      case "UseDirective":
      case "TransitionDirective":
      case "AnimateDirective": {
        const [base = ""] = (attribute.name as string).split(".", 1);
        const start = code.indexOf(":", attribute.start) + 1;
        this.reference(
          base,
          { start, end: start + base.length },
          scope,
          "directive",
          attribute,
        );
        this.expression(attribute.expression as Node | null, scope);
        return;
      }
      case "LetDirective": {
        this.problems.push("it uses let:");
      }
    }
  }

  fragment(fragment: AST.Fragment, parent: Scope, code: string) {
    const scope = this.scope(parent);
    for (const node of fragment.nodes) {
      if (node.type === "SnippetBlock") {
        scope.declare(node.expression.name, {
          kind: "snippet",
          snippet: { node, scope },
        });
      } else if (node.type === "ConstTag" || node.type === "DeclarationTag") {
        for (const declarator of node.declaration.declarations) {
          this.declarePattern(asNode(declarator.id), scope);
        }
      }
    }
    for (const node of fragment.nodes) {
      this.node(asNode(node), scope, code);
    }
  }

  snippet(node: AST.SnippetBlock, parent: Scope, code: string) {
    const inner = this.scope(parent);
    for (const parameter of node.parameters) {
      this.declarePattern(asNode(parameter), inner);
    }
    for (const parameter of node.parameters) {
      this.defaults(asNode(parameter), inner);
    }
    this.fragment(node.body, inner, code);
  }

  node(node: Node, scope: Scope, code: string) {
    switch (node.type) {
      case "Text":
      case "Comment": {
        return;
      }
      case "ExpressionTag":
      case "HtmlTag":
      case "RenderTag":
      case "AttachTag":
      case "KeyBlock": {
        this.expression(node.expression as Node, scope);
        if (node.type === "KeyBlock") {
          this.fragment(node.fragment as AST.Fragment, scope, code);
        }
        return;
      }
      case "ConstTag":
      case "DeclarationTag": {
        this.expression(node.declaration as Node, scope);
        return;
      }
      case "DebugTag": {
        for (const identifier of node.identifiers as Array<Node>) {
          this.reference(identifier.name as string, identifier, scope, "debug");
        }
        return;
      }
      case "IfBlock": {
        this.expression(node.test as Node, scope);
        this.fragment(node.consequent as AST.Fragment, scope, code);
        if (node.alternate != null) {
          this.fragment(node.alternate as AST.Fragment, scope, code);
        }
        return;
      }
      case "EachBlock": {
        this.expression(node.expression as Node, scope);
        const inner = this.scope(scope);
        this.declarePattern(node.context as Node | null, inner);
        if (typeof node.index === "string") {
          inner.declare(node.index, { kind: "template" });
        }
        this.defaults(node.context as Node | null, inner);
        this.expression(node.key as Node | undefined, inner);
        this.fragment(node.body as AST.Fragment, inner, code);
        if (node.fallback != null) {
          this.fragment(node.fallback as AST.Fragment, scope, code);
        }
        return;
      }
      case "AwaitBlock": {
        this.expression(node.expression as Node, scope);
        if (node.pending != null) {
          this.fragment(node.pending as AST.Fragment, scope, code);
        }
        if (node.then != null) {
          const inner = this.scope(scope);
          this.declarePattern(node.value as Node | null, inner);
          this.defaults(node.value as Node | null, inner);
          this.fragment(node.then as AST.Fragment, inner, code);
        }
        if (node.catch != null) {
          const inner = this.scope(scope);
          this.declarePattern(node.error as Node | null, inner);
          this.defaults(node.error as Node | null, inner);
          this.fragment(node.catch as AST.Fragment, inner, code);
        }
        return;
      }
      case "SnippetBlock": {
        if (isSnippetBlock(node)) {
          this.snippet(node, scope, code);
        }
        return;
      }
      case "SvelteSelf": {
        this.problems.push("it uses <svelte:self>");
        return;
      }
      case "SlotElement": {
        this.problems.push("it uses <slot>");
        return;
      }
      default: {
        this.element(node, scope, code);
      }
    }
  }

  element(node: Node, scope: Scope, code: string) {
    switch (node.type) {
      case "Component": {
        const name = node.name as string;
        const [base = name] = name.split(".", 1);
        this.reference(
          base,
          { start: node.start + 1, end: node.start + 1 + base.length },
          scope,
          "component",
          node,
        );
        break;
      }
      case "SvelteElement": {
        this.expression(node.tag as Node, scope);
        break;
      }
      case "SvelteComponent": {
        this.expression(node.expression as Node, scope);
        break;
      }
    }
    const attributes = (node.attributes ?? []) as Array<Node>;
    for (const attribute of attributes) {
      this.attribute(attribute, scope, code);
    }
    if (node.fragment != null) {
      this.fragment(node.fragment as AST.Fragment, scope, code);
    }
  }
}

type Script = AST.Script | null;

function scriptScope(scripts: Array<Script>) {
  const scope = new Scope(null);
  const islands = new Set<string>();
  for (const script of scripts) {
    if (script == null) {
      continue;
    }
    for (const statement of nodesOf(script.content.body)) {
      const declared =
        statement.type === "ExportNamedDeclaration" &&
        isNode(statement.declaration)
          ? statement.declaration
          : statement;
      switch (declared.type) {
        case "ImportDeclaration": {
          if (declared.importKind === "type") {
            break;
          }
          const source = (declared.source as Node).value as string;
          const attributes = declared.attributes as Array<Node> | undefined;
          const tail =
            attributes != null && attributes.length > 0
              ? ` with { ${attributes
                  .map(
                    (attribute) =>
                      `${JSON.stringify(((attribute.key as Node).name ?? (attribute.key as Node).value) as string)}: ${JSON.stringify((attribute.value as Node).value)}`,
                  )
                  .join(", ")} }`
              : "";
          for (const specifier of declared.specifiers as Array<Node>) {
            if (specifier.importKind === "type") {
              continue;
            }
            const local = (specifier.local as Node).name as string;
            const kind =
              specifier.type === "ImportDefaultSpecifier"
                ? "default"
                : specifier.type === "ImportNamespaceSpecifier"
                  ? "namespace"
                  : "named";
            const imported =
              kind === "named"
                ? (((specifier.imported as Node).name ??
                    (specifier.imported as Node).value) as string)
                : kind;
            if (source === "svelte-islands" && imported === "Island") {
              islands.add(local);
            }
            scope.declare(local, {
              kind: "import",
              imported: { source, kind, imported, attributes: tail },
            });
          }
          break;
        }
        case "VariableDeclaration": {
          for (const declarator of declared.declarations as Array<Node>) {
            for (const name of namesOf(declarator.id as Node)) {
              scope.declare(name, { kind: "local" });
            }
          }
          break;
        }
        case "FunctionDeclaration":
        case "ClassDeclaration":
        case "TSEnumDeclaration": {
          if (isNode(declared.id)) {
            scope.declare(declared.id.name as string, { kind: "local" });
          }
          break;
        }
      }
    }
  }
  return { scope, islands };
}

type Compound = ReadonlyArray<AST.CSS.SimpleSelector>;

type Traits = {
  tag: string | null;
  classes: Set<string> | null;
  ids: Set<string> | null;
  attributes: Set<string> | null;
};

function isGlobal(selector: AST.CSS.SimpleSelector) {
  return selector.type === "PseudoClassSelector" && selector.name === "global";
}

function isBareGlobal(selector: AST.CSS.SimpleSelector) {
  return (
    isGlobal(selector) &&
    selector.type === "PseudoClassSelector" &&
    selector.args == null
  );
}

function scopedCompounds(css: AST.CSS.StyleSheet | null) {
  const found: Array<Compound> = [];
  const fromList = (list: AST.CSS.SelectorList) => {
    for (const complex of list.children) {
      for (const relative of complex.children) {
        if (relative.selectors.some((selector) => isBareGlobal(selector))) {
          break;
        }
        const isOwn = relative.selectors.some(
          (selector) =>
            !isGlobal(selector) && selector.type !== "NestingSelector",
        );
        if (isOwn) {
          found.push(relative.selectors);
        }
        for (const selector of relative.selectors) {
          if (
            selector.type === "PseudoClassSelector" &&
            selector.args != null &&
            !isGlobal(selector)
          ) {
            fromList(selector.args);
          }
        }
      }
    }
  };
  const visit = (nodes: ReadonlyArray<AST.CSS.Node>) => {
    for (const node of nodes) {
      if (node.type === "Atrule") {
        if (!node.name.endsWith("keyframes") && node.block != null) {
          visit(node.block.children);
        }
      } else if (node.type === "Rule") {
        fromList(node.prelude);
        const isGlobalBlock = node.prelude.children.every((complex) =>
          complex.children.some((relative) =>
            relative.selectors.some((selector) => isBareGlobal(selector)),
          ),
        );
        if (!isGlobalBlock) {
          visit(node.block.children);
        }
      }
    }
  };
  visit(css?.children ?? []);
  return found;
}

function wordsOf(value: AST.Attribute["value"]) {
  if (value === true) {
    return [];
  }
  if (!Array.isArray(value) || value.some((piece) => piece.type !== "Text")) {
    return null;
  }
  return value
    .map((piece) => (piece.type === "Text" ? piece.data : ""))
    .join("")
    .split(/\s+/u)
    .filter((word) => word !== "");
}

function traitsOf(element: AST.RegularElement | AST.SvelteElement): Traits {
  const traits: Traits = {
    tag: element.type === "RegularElement" ? element.name.toLowerCase() : null,
    classes: new Set(),
    ids: new Set(),
    attributes: new Set(),
  };
  for (const attribute of element.attributes) {
    if (attribute.type === "SpreadAttribute") {
      return { tag: traits.tag, classes: null, ids: null, attributes: null };
    }
    switch (attribute.type) {
      case "ClassDirective": {
        traits.classes?.add(attribute.name);
        traits.attributes?.add("class");

        break;
      }
      case "StyleDirective": {
        traits.attributes?.add("style");

        break;
      }
      case "BindDirective": {
        traits.attributes?.add(attribute.name.toLowerCase());

        break;
      }
      case "Attribute": {
        const name = attribute.name.toLowerCase();
        traits.attributes?.add(name);
        if (name === "class" || name === "id") {
          const words = wordsOf(attribute.value);
          const key = name === "class" ? "classes" : "ids";
          if (words == null) {
            traits[key] = null;
          } else {
            for (const word of words) {
              traits[key]?.add(word);
            }
          }
        }

        break;
      }
      // No default
    }
  }
  return traits;
}

function isMatchable(traits: Traits, compound: Compound) {
  return compound.every((selector) => {
    switch (selector.type) {
      case "TypeSelector": {
        return (
          selector.name === "*" ||
          traits.tag == null ||
          selector.name.toLowerCase() === traits.tag
        );
      }
      case "ClassSelector": {
        return traits.classes == null || traits.classes.has(selector.name);
      }
      case "IdSelector": {
        return traits.ids == null || traits.ids.has(selector.name);
      }
      case "AttributeSelector": {
        return (
          traits.attributes == null ||
          traits.attributes.has(selector.name.toLowerCase())
        );
      }
      case "PseudoClassSelector": {
        return selector.name !== "root" && selector.name !== "host";
      }
      default: {
        return true;
      }
    }
  });
}

function styledElement(
  node: unknown,
  compounds: ReadonlyArray<Compound>,
): string | null {
  if (compounds.length === 0) {
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = styledElement(item, compounds);
      if (found != null) {
        return found;
      }
    }
    return null;
  }
  if (!isNode(node)) {
    return null;
  }
  if (isElement(node)) {
    const traits = traitsOf(node);
    if (compounds.some((compound) => isMatchable(traits, compound))) {
      return node.type === "RegularElement"
        ? `<${node.name}>`
        : "<svelte:element>";
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "metadata" || typeof value !== "object" || value == null) {
      continue;
    }

    const found = styledElement(value, compounds);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function fresh(base: string, code: string) {
  let name = base;
  while (
    new RegExp(
      String.raw`\b${name.replaceAll("$", String.raw`\$`)}\b`,
      "u",
    ).test(code)
  ) {
    name += "_";
  }
  return name;
}

function importLine(
  name: string,
  { source, kind, imported, attributes }: Imported,
) {
  const from = JSON.stringify(source);
  if (kind === "default") {
    return `import ${name} from ${from}${attributes};`;
  }
  if (kind === "namespace") {
    return `import * as ${name} from ${from}${attributes};`;
  }
  const specifier =
    imported === name
      ? name
      : `${/^[\p{ID_Start}$_][\p{ID_Continue}$\u{200C}\u{200D}]*$/u.test(imported) ? imported : JSON.stringify(imported)} as ${name}`;
  return `import { ${specifier} } from ${from}${attributes};`;
}

type Analysis = {
  captures: Map<string, Declaration & { isWritten: boolean }>;
  imports: Map<string, Imported>;
  copies: Array<AST.SnippetBlock>;
  references: Array<Reference>;
  problems: Array<string>;
};

function analyze(
  snippet: AST.SnippetBlock,
  declared: Scope,
  at: Scope,
  code: string,
  compounds: ReadonlyArray<Compound>,
): Analysis {
  const result: Analysis = {
    captures: new Map(),
    imports: new Map(),
    copies: [],
    references: [],
    problems: [],
  };
  const seen = new Set<AST.SnippetBlock>();
  const visit = (node: AST.SnippetBlock, scope: Scope, isCopy: boolean) => {
    if (seen.has(node)) {
      return;
    }
    seen.add(node);
    if (isCopy) {
      result.copies.push(node);
    }
    const styled = styledElement(node.body, compounds);
    if (styled != null) {
      result.problems.push(
        `its ${styled} matches a selector in the page's scoped styles; move the markup into a component, or make the selector :global`,
      );
    }
    const walker = new Walker();
    walker.snippet(node, scope, code);
    result.problems.push(...walker.problems);
    for (const reference of walker.references) {
      const { declaration } = reference;
      if (declaration == null || walker.inner.has(declaration.scope)) {
        continue;
      }
      if (
        declaration.kind !== "store" &&
        at.lookup(reference.name) !== declaration
      ) {
        result.problems.push(
          `"${reference.name}" means something else where the island is`,
        );
        continue;
      }
      if (declaration.kind === "snippet" && declaration.snippet != null) {
        visit(declaration.snippet.node, declaration.snippet.scope, true);
        continue;
      }
      if (declaration.kind === "import" && declaration.imported != null) {
        result.imports.set(reference.name, declaration.imported);
        continue;
      }
      if (reference.role === "debug") {
        result.problems.push(`it uses {@debug ${reference.name}}`);
        continue;
      }
      const known = result.captures.get(reference.name);
      if (known != null && known.scope !== declaration.scope) {
        result.problems.push(`"${reference.name}" means two different things`);
        continue;
      }
      result.captures.set(reference.name, {
        ...declaration,
        isWritten: (known?.isWritten ?? false) || reference.isWrite,
      });
      result.references.push(reference);
    }
  };
  visit(snippet, declared, false);
  return result;
}

function rewrite(
  text: MagicString,
  reference: Reference,
  scope: string,
  code: string,
) {
  const member = `${scope}.${reference.name}`;
  const owner = reference.owner;
  switch (reference.role) {
    case "expression": {
      text.overwrite(reference.start, reference.end, member);
      return;
    }
    case "shorthand-property": {
      text.overwrite(
        reference.start,
        reference.end,
        `${reference.name}: ${member}`,
      );
      return;
    }
    case "shorthand-attribute": {
      if (owner != null) {
        text.overwrite(owner.start, owner.end, `${reference.name}={${member}}`);
      }
      return;
    }
    case "shorthand-directive": {
      if (owner != null) {
        text.overwrite(
          owner.start,
          owner.end,
          `${code.slice(owner.start, owner.end)}={${member}}`,
        );
      }
      return;
    }
    case "shorthand-style": {
      if (owner != null) {
        text.overwrite(
          owner.start,
          owner.end,
          `style:${reference.name}={${member}}`,
        );
      }
      return;
    }
    case "component": {
      text.overwrite(reference.start, reference.end, member);
      if (owner != null) {
        const name = owner.name as string;
        const closing = `</${name}>`;
        const at = owner.end - closing.length;
        if (code.slice(at, owner.end) === closing) {
          text.overwrite(at + 2, at + 2 + reference.name.length, member);
        }
      }
      return;
    }
    case "directive": {
      text.overwrite(reference.start, reference.end, member);
      break;
    }
    case "debug": {
      break;
    }
  }
}

function scopeObject(
  captures: Analysis["captures"],
  value: string,
  isServer: boolean,
) {
  const members: Array<string> = [];
  for (const [name, capture] of captures) {
    members.push(`get ${name}() { return ${name}; }`);
    if (!isServer && capture.isWritten) {
      members.push(`set ${name}(${value}) { ${name} = ${value}; }`);
    }
  }
  return `{ ${members.join(", ")} }`;
}

function headerEnd(snippet: AST.SnippetBlock, code: string) {
  const parameter = snippet.parameters.at(-1);
  const last = parameter == null ? undefined : asNode(parameter);
  const from = last?.end ?? code.indexOf("(", asNode(snippet.expression).end);
  return code.indexOf("}", code.indexOf(")", from)) + 1;
}

export type Extracted = {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
  modules: Array<{ id: string; file: string; source: string }>;
  warnings: Array<string>;
};

/**
 * Moves each island's snippet into its own module for the browser build, or
 * marks each island for the server build so shell pages can boot it.
 *
 * @param code The component's source.
 * @param filename The component's path, used for the island modules' paths.
 * @param name The component's path relative to the project, used for stable ids.
 * @param target Which build this is for.
 * @returns The rewritten component and its island modules, or `null` if it has no islands.
 */
export function extract(
  code: string,
  filename: string,
  name: string,
  target: "client" | "server",
): Extracted | null {
  if (!code.includes("svelte-islands")) {
    return null;
  }
  const root = parse(code, { modern: true, filename });
  const { scope: top, islands } = scriptScope([root.module, root.instance]);
  if (islands.size === 0) {
    return null;
  }
  const isServer = target === "server";
  const compounds = scopedCompounds(root.css);
  const isTypeScript = [root.instance, root.module].some((script) =>
    script?.attributes.some(
      (attribute) =>
        attribute.name === "lang" &&
        Array.isArray(attribute.value) &&
        attribute.value.some(
          (part) => part.type === "Text" && part.data === "ts",
        ),
    ),
  );
  const page = new MagicString(code);
  const moduleText = new MagicString(code);
  const scopeName = fresh("scope", code);
  const valueName = fresh("value", code);
  const modules: Extracted["modules"] = [];
  const warnings: Array<string> = [];
  const rewritten = new Set<number>();
  const removed: Array<[number, number]> = [];
  const moved = new Map<string, Imported>();
  const prunable = new Set<AST.SnippetBlock>();

  const visitIsland = (island: AST.Component, at: Scope) => {
    const inline = island.fragment.nodes.find(
      (node): node is AST.SnippetBlock =>
        node.type === "SnippetBlock" && node.expression.name === "children",
    );
    const attribute = island.attributes.find(
      (item): item is AST.Attribute =>
        item.type === "Attribute" && item.name === "children",
    );
    let snippet: AST.SnippetBlock | null = null;
    let declared: Scope | null = null;
    if (inline != null) {
      snippet = inline;
      const holder = new Scope(at);
      for (const node of island.fragment.nodes) {
        if (node.type === "SnippetBlock") {
          holder.declare(node.expression.name, {
            kind: "snippet",
            snippet: { node, scope: holder },
          });
        }
      }
      declared = holder;
    } else if (
      attribute != null &&
      !Array.isArray(attribute.value) &&
      attribute.value !== true &&
      attribute.value.expression.type === "Identifier"
    ) {
      const found = at.lookup(attribute.value.expression.name);
      if (found?.kind === "snippet" && found.snippet != null) {
        snippet = found.snippet.node;
        declared = found.snippet.scope;
      }
    }
    const line = code.slice(0, island.start).split("\n").length;
    if (snippet == null || declared == null) {
      warnings.push(
        `${name}:${line}: the island stays in the page, because its children aren't a snippet the plugin can find`,
      );
      return false;
    }
    const analysis = analyze(snippet, declared, at, code, compounds);
    if (analysis.problems.length > 0) {
      warnings.push(
        `${name}:${line}: the island stays in the page, because ${[...new Set(analysis.problems)].join(", ")}`,
      );
      return false;
    }
    const index = modules.length;
    const id = createHash("sha256")
      .update(`${name}:${index}`)
      .digest("base64url")
      .slice(0, 12);
    const scope =
      analysis.captures.size === 0
        ? ""
        : ` scope={${scopeObject(analysis.captures, valueName, isServer)}}`;
    const nameEnd = island.start + 1 + island.name.length;
    if (isServer) {
      page.appendLeft(nameEnd, ` module="${id}"${scope}`);
      modules.push({ id, file: "", source: "" });
      return true;
    }
    for (const reference of analysis.references) {
      if (rewritten.has(reference.start)) {
        continue;
      }

      rewritten.add(reference.start);
      rewrite(moduleText, reference, scopeName, code);
    }

    const end = headerEnd(snippet, code);
    const close = code.lastIndexOf("{/snippet", snippet.end - 1);
    const parameters = nodesOf(snippet.parameters);
    const first = parameters[0];
    const last = parameters.at(-1);
    const params =
      first != null && last != null
        ? `${moduleText.slice(first.start, last.end)}, ${scopeName}`
        : `_${valueName}, ${scopeName}`;
    const copies = analysis.copies
      .map((copy) => moduleText.slice(copy.start, copy.end))
      .join("");
    const imports = [...analysis.imports]
      .map(([local, imported]) => importLine(local, imported))
      .join("\n  ");
    const source = `<script module${isTypeScript ? ' lang="ts"' : ""}>
  ${imports}
  export { body };
  export const url = import.meta.url;
</script>

{#snippet body(${params})}${copies}${moduleText.slice(end, close)}{/snippet}
`;
    const file = `${filename}.__island-${createHash("sha256").update(source).digest("base64url").slice(0, 10)}.svelte`;
    modules.push({ id, file, source });
    for (const copy of analysis.copies) {
      prunable.add(copy);
    }
    for (const [local, imported] of analysis.imports) {
      moved.set(local, imported);
    }
    if (inline == null) {
      if (attribute != null) {
        page.remove(attribute.start, attribute.end);
        removed.push([attribute.start, attribute.end]);
      }
      prunable.add(snippet);
    } else {
      page.remove(inline.start, inline.end);
      removed.push([inline.start, inline.end]);
    }
    page.appendLeft(
      nameEnd,
      ` code={() => import(${JSON.stringify(file)})} module="${id}"${scope}`,
    );
    return true;
  };

  const walk = (node: Node, scope: Scope): void => {
    if (
      isComponent(node) &&
      islands.has(node.name) &&
      visitIsland(node, scope)
    ) {
      return;
    }
    if (node.type === "Fragment") {
      const inner = new Scope(scope);
      const nodes = node.nodes as Array<Node>;
      for (const child of nodes) {
        if (isSnippetBlock(child)) {
          inner.declare(child.expression.name, {
            kind: "snippet",
            snippet: { node: child, scope: inner },
          });
        } else if (
          child.type === "ConstTag" ||
          child.type === "DeclarationTag"
        ) {
          for (const declarator of (child.declaration as Node)
            .declarations as Array<Node>) {
            for (const declaredName of namesOf(declarator.id as Node)) {
              inner.declare(declaredName, { kind: "template" });
            }
          }
        }
      }
      for (const child of nodes) {
        walk(child, inner);
      }
      return;
    }
    let inner = scope;
    if (node.type === "EachBlock") {
      inner = new Scope(scope);
      for (const declaredName of namesOf(node.context as Node | null)) {
        inner.declare(declaredName, { kind: "template" });
      }
      if (typeof node.index === "string") {
        inner.declare(node.index, { kind: "template" });
      }
      walk(node.body as Node, inner);
      if (node.fallback != null) {
        walk(node.fallback as Node, scope);
      }
      return;
    }
    if (node.type === "AwaitBlock") {
      for (const [fragment, pattern] of [
        [node.pending, null],
        [node.then, node.value],
        [node.catch, node.error],
      ] as Array<[Node | null, Node | null]>) {
        if (fragment == null) {
          continue;
        }
        const branch = new Scope(scope);
        for (const declaredName of namesOf(pattern)) {
          branch.declare(declaredName, { kind: "template" });
        }
        walk(fragment, branch);
      }
      return;
    }
    if (node.type === "SnippetBlock") {
      inner = new Scope(scope);
      for (const parameter of node.parameters as Array<Node>) {
        for (const declaredName of namesOf(parameter)) {
          inner.declare(declaredName, { kind: "template" });
        }
      }
      walk(node.body as Node, inner);
      return;
    }
    for (const child of children(node)) {
      if (
        child.type === "Fragment" ||
        ELEMENT_LIKE.has(child.type) ||
        BLOCKS.has(child.type)
      ) {
        walk(child, inner);
      }
    }
  };

  walk(asNode(root.fragment), top);
  if (modules.length === 0) {
    return warnings.length > 0
      ? { code, map: page.generateMap({ hires: true }), modules, warnings }
      : null;
  }
  if (!isServer) {
    pruneSnippets(prunable, root, code, page, removed);
    pruneImports(moved, root, code, page, removed);
  }
  return {
    code: page.toString(),
    map: page.generateMap({ hires: true, source: filename }),
    modules,
    warnings,
  };
}

function isRemoved(start: number, removed: Array<[number, number]>) {
  return removed.some(([from, to]) => start >= from && start < to);
}

function usedNames(
  root: AST.Root,
  code: string,
  removed: Array<[number, number]>,
) {
  const used = new Map<string, number>();
  const count = (name: string, start: number) => {
    if (!isRemoved(start, removed)) {
      used.set(name, (used.get(name) ?? 0) + 1);
    }
  };
  const visit = (node: unknown, parent: Node | null, key: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, parent, key);
      }
      return;
    }
    if (!isNode(node) || isRemoved(node.start, removed)) {
      return;
    }
    if (node.type === "Identifier") {
      const isProperty =
        parent != null &&
        ((parent.type === "MemberExpression" &&
          key === "property" &&
          parent.computed !== true) ||
          (KEYED.has(parent.type) &&
            key === "key" &&
            parent.computed !== true &&
            parent.shorthand !== true) ||
          parent.type === "ImportSpecifier" ||
          parent.type === "ImportDefaultSpecifier" ||
          parent.type === "ImportNamespaceSpecifier");
      if (!isProperty) {
        const name = node.name as string;
        count(name, node.start);
        if (name.startsWith("$")) {
          count(name.slice(1), node.start);
        }
      }
      return;
    }
    if (node.type === "Component" || NAMED_DIRECTIVES.has(node.type)) {
      count((node.name as string).split(".", 1)[0] ?? "", node.start);
    }
    if (node.type === "StyleDirective" && node.value === true) {
      count(node.name as string, node.start);
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === "metadata" || childKey === "loc") {
        continue;
      }
      if (typeof value === "object" && value != null) {
        visit(value, node, childKey);
      }
    }
  };
  visit(root.fragment, null, "");
  visit(root.instance?.content, null, "");
  visit(root.module?.content, null, "");
  void code;
  return used;
}

function pruneSnippets(
  shared: Set<AST.SnippetBlock>,
  root: AST.Root,
  code: string,
  page: MagicString,
  removed: Array<[number, number]>,
) {
  const left = new Set(shared);
  let isChanged = left.size > 0;
  while (isChanged) {
    isChanged = false;
    const used = usedNames(root, code, removed);
    for (const snippet of left) {
      if (isRemoved(snippet.start, removed)) {
        left.delete(snippet);
      } else if ((used.get(snippet.expression.name) ?? 0) <= 1) {
        page.remove(snippet.start, snippet.end);
        removed.push([snippet.start, snippet.end]);
        left.delete(snippet);
        isChanged = true;
      }
    }
  }
}

function pruneImports(
  moved: Map<string, Imported>,
  root: AST.Root,
  code: string,
  page: MagicString,
  removed: Array<[number, number]>,
) {
  if (moved.size === 0) {
    return;
  }
  const used = usedNames(root, code, removed);
  for (const script of [root.instance, root.module]) {
    if (script == null) {
      continue;
    }
    for (const statement of nodesOf(script.content.body)) {
      if (
        statement.type !== "ImportDeclaration" ||
        statement.importKind === "type"
      ) {
        continue;
      }
      const specifiers = statement.specifiers as Array<Node>;
      const kept = specifiers.filter((specifier) => {
        const local = (specifier.local as Node).name as string;
        return !moved.has(local) || (used.get(local) ?? 0) > 0;
      });
      if (kept.length === specifiers.length) {
        continue;
      }
      if (kept.length === 0) {
        const lineEnd = code.indexOf("\n", statement.end);
        const isAlone =
          lineEnd !== -1 && code.slice(statement.end, lineEnd).trim() === "";
        const lineStart = code.lastIndexOf("\n", statement.start - 1) + 1;
        const isLineStart =
          code.slice(lineStart, statement.start).trim() === "";
        page.remove(
          isAlone && isLineStart ? lineStart : statement.start,
          isAlone && isLineStart ? lineEnd + 1 : statement.end,
        );
        continue;
      }
      const defaults = kept.filter(
        (specifier) => specifier.type !== "ImportSpecifier",
      );
      const named = kept.filter(
        (specifier) => specifier.type === "ImportSpecifier",
      );
      const parts = defaults.map((specifier) =>
        code.slice(specifier.start, specifier.end),
      );
      if (named.length > 0) {
        parts.push(
          `{ ${named.map((specifier) => code.slice(specifier.start, specifier.end)).join(", ")} }`,
        );
      }
      const source = statement.source as Node;
      page.overwrite(
        statement.start,
        source.start,
        `import ${parts.join(", ")} from `,
      );
    }
  }
}
