// Minimal AST nodes for Rip - just enough to support the grammar

class Base {
  constructor() {
    this.children = [];
  }

  compile(options = {}) {
    const code = this.compileNode(options);
    if (options.level === 'top') {
      return code;
    } else {
      return code;
    }
  }

  compileNode(options) {
    throw new Error(`${this.constructor.name} has no compileNode method`);
  }

  makeCode(code) {
    return code;
  }

  wrapInParens(code) {
    return `(${code})`;
  }
}

export class Block extends Base {
  constructor(expressions = []) {
    super();
    this.expressions = expressions;
  }

  push(expr) {
    this.expressions.push(expr);
    return this;
  }

  compileNode(options) {
    return this.expressions.map(e => e.compile(options)).join('\n');
  }

  static wrap(nodes) {
    if (nodes.length === 1 && nodes[0] instanceof Block) {
      return nodes[0];
    }
    return new Block(nodes);
  }
}

export class Literal extends Base {
  constructor(value) {
    super();
    this.value = value;
  }

  compileNode() {
    return this.value;
  }
}

export class Identifier extends Base {
  constructor(name) {
    super();
    this.name = name;
  }

  compileNode() {
    return this.name;
  }
}

export class Assign extends Base {
  constructor(variable, value) {
    super();
    this.variable = variable;
    this.value = value;
  }

  compileNode(options) {
    return `${this.variable.compile(options)} = ${this.value.compile(options)}`;
  }
}

export class Call extends Base {
  constructor(variable, args = []) {
    super();
    this.variable = variable;
    this.args = args;
  }

  compileNode(options) {
    const func = this.variable.compile(options);
    const args = this.args.map(a => a.compile(options)).join(', ');
    return `${func}(${args})`;
  }
}

export class Access extends Base {
  constructor(object, property, soak) {
    super();
    this.object = object;
    this.property = property;
    this.soak = soak;
  }

  compileNode(options) {
    const obj = this.object.compile(options);
    const prop = this.property.compile(options);
    const op = this.soak ? '?.' : '.';
    return `${obj}${op}${prop}`;
  }
}

export class Index extends Base {
  constructor(object, index, soak) {
    super();
    this.object = object;
    this.index = index;
    this.soak = soak;
  }

  compileNode(options) {
    const obj = this.object.compile(options);
    const idx = this.index.compile(options);
    if (this.soak) {
      return `${obj}?.[${idx}]`;
    }
    return `${obj}[${idx}]`;
  }
}

export class Arr extends Base {
  constructor(objects = []) {
    super();
    this.objects = objects;
  }

  compileNode(options) {
    const items = this.objects.map(o => o.compile(options)).join(', ');
    return `[${items}]`;
  }
}

export class Obj extends Base {
  constructor(properties = []) {
    super();
    this.properties = properties;
  }

  compileNode(options) {
    const props = this.properties.map(p => p.compile(options)).join(', ');
    return `{${props}}`;
  }
}

export class Prop extends Base {
  constructor(key, value) {
    super();
    this.key = key;
    this.value = value;
  }

  compileNode(options) {
    const key = this.key.compile(options);
    const val = this.value.compile(options);
    return `${key}: ${val}`;
  }
}

export class Parens extends Base {
  constructor(body) {
    super();
    this.body = body;
  }

  compileNode(options) {
    return `(${this.body.compile(options)})`;
  }
}

export class This extends Base {
  compileNode() {
    return 'this';
  }
}

export class Super extends Base {
  compileNode() {
    return 'super';
  }
}

export class Return extends Base {
  constructor(expression) {
    super();
    this.expression = expression;
  }

  compileNode(options) {
    if (this.expression) {
      return `return ${this.expression.compile(options)}`;
    }
    return 'return';
  }
}

export class Throw extends Base {
  constructor(expression) {
    super();
    this.expression = expression;
  }

  compileNode(options) {
    return `throw ${this.expression.compile(options)}`;
  }
}

export class Break extends Base {
  compileNode() {
    return 'break';
  }
}

export class Continue extends Base {
  compileNode() {
    return 'continue';
  }
}

export class Comment extends Base {
  constructor(text) {
    super();
    this.text = text;
  }

  compileNode() {
    return `// ${this.text}`;
  }
}

export class Import extends Base {
  constructor(path, specifiers, defaultSpecifier, namespace) {
    super();
    this.path = path;
    this.specifiers = specifiers;
    this.defaultSpecifier = defaultSpecifier;
    this.namespace = namespace;
  }

  compileNode(options) {
    const path = this.path.compile(options);
    if (this.namespace) {
      return `import * as ${this.defaultSpecifier.compile(options)} from ${path}`;
    }
    if (this.defaultSpecifier) {
      return `import ${this.defaultSpecifier.compile(options)} from ${path}`;
    }
    if (this.specifiers) {
      const specs = this.specifiers.map(s => s.compile(options)).join(', ');
      return `import { ${specs} } from ${path}`;
    }
    return `import ${path}`;
  }
}

export class Export extends Base {
  constructor(expression, isDefault) {
    super();
    this.expression = expression;
    this.isDefault = isDefault;
  }

  compileNode(options) {
    const expr = this.expression.compile(options);
    if (this.isDefault) {
      return `export default ${expr}`;
    }
    return `export ${expr}`;
  }
}

export class Code extends Base {
  constructor(params, body, bound) {
    super();
    this.params = params || [];
    this.body = body;
    this.bound = bound;
  }

  compileNode(options) {
    const params = this.params.map(p => p.compile(options)).join(', ');
    const body = this.body.compile(options);
    const arrow = this.bound ? '=>' : '->';
    return `(${params}) ${arrow} ${body}`;
  }
}

export class Param extends Base {
  constructor(name, defaultValue, splat) {
    super();
    this.name = name;
    this.defaultValue = defaultValue;
    this.splat = splat;
  }

  compileNode(options) {
    let param = this.name.compile(options);
    if (this.splat) {
      param = `...${param}`;
    }
    if (this.defaultValue) {
      param = `${param} = ${this.defaultValue.compile(options)}`;
    }
    return param;
  }
}

export class Splat extends Base {
  constructor(expression) {
    super();
    this.expression = expression;
  }

  compileNode(options) {
    return `...${this.expression.compile(options)}`;
  }
}

export class Class extends Base {
  constructor(name, parent, body) {
    super();
    this.name = name;
    this.parent = parent;
    this.body = body;
  }

  compileNode(options) {
    let result = `class ${this.name.compile(options)}`;
    if (this.parent) {
      result += ` extends ${this.parent.compile(options)}`;
    }
    if (this.body) {
      result += ` {\n${this.body.compile(options)}\n}`;
    } else {
      result += ' {}';
    }
    return result;
  }
}

// Provide all node classes as default export too
const nodes = {
  Base,
  Block,
  Literal,
  Identifier,
  Assign,
  Call,
  Access,
  Index,
  Arr,
  Obj,
  Prop,
  Parens,
  This,
  Super,
  Return,
  Throw,
  Break,
  Continue,
  Comment,
  Import,
  Export,
  Code,
  Param,
  Splat,
  Class
};

export default nodes;