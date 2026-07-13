import { generate, walk } from 'css-tree';
import { compile } from './engine.js';

const registeredRoots = [];

function isFragment(node) {
  return node && Array.isArray(node.childNodes) && !node.tag && !node.attributes;
}

function isElement(node) {
  return node && node.tag && node.attributes && node.style;
}

function collectClasses(node, classes = new Set()) {
  if (!isFragment(node) && !isElement(node)) return classes;
  if (isElement(node) && node.className) {
    for (const name of node.className.split(/\s+/)) {
      if (name) classes.add(name);
    }
  }
  for (const child of node.childNodes) collectClasses(child, classes);
  return classes;
}

function variablesOf(styleSheet) {
  const variables = new Map();
  walk(styleSheet, {
    visit: 'Atrule',
    enter(atrule) {
      if (atrule.name === 'property' && atrule.prelude) {
        const name = generate(atrule.prelude);
        if (!name.startsWith('--')) return;
        walk(atrule, {
          visit: 'Declaration',
          enter(declaration) {
            if (declaration.property === 'initial-value') {
              variables.set(name, generate(declaration.value).trim());
            }
          },
        });
        return;
      }
      if (atrule.name !== 'layer' || generate(atrule.prelude).trim() !== 'theme') return;
      walk(atrule, {
        visit: 'Declaration',
        enter(declaration) {
          if (declaration.property.startsWith('--')) {
            variables.set(declaration.property, generate(declaration.value).trim());
          }
        },
      });
    },
  });
  return variables;
}

function resolveVariables(source, variables, resolving = new Set()) {
  let text = source;
  for (let pass = 0; pass < 100; pass++) {
    const start = text.indexOf('var(');
    if (start === -1) break;

    let depth = 1;
    let quote = null;
    let end = start + 4;
    for (; end < text.length && depth > 0; end++) {
      const char = text[end];
      if (quote) {
        if (char === quote && text[end - 1] !== '\\') quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      }
    }
    if (depth !== 0) break;

    const body = text.slice(start + 4, end - 1);
    let comma = -1;
    depth = 0;
    quote = null;
    for (let index = 0; index < body.length; index++) {
      const char = body[index];
      if (quote) {
        if (char === quote && body[index - 1] !== '\\') quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      } else if (char === ',' && depth === 0) {
        comma = index;
        break;
      }
    }

    const name = (comma === -1 ? body : body.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : body.slice(comma + 1).trim();
    let replacement;
    if (variables.has(name)) {
      if (resolving.has(name)) {
        throw new Error(`circular Tailwind CSS variable '${name}'`);
      }
      resolving.add(name);
      replacement = resolveVariables(variables.get(name), variables, resolving);
      resolving.delete(name);
    } else {
      replacement = resolveVariables(fallback, variables, resolving);
    }
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  return text;
}

function classifyRules(styleSheet, classes) {
  const wanted = new Set(classes);
  const inlineable = new Set();
  const inlineRules = [];
  const supported = new Set();
  const residual = [];
  const global = [];

  walk(styleSheet, {
    visit: 'Rule',
    enter(rule) {
      const selectors = [];
      walk(rule, {
        visit: 'ClassSelector',
        enter(selector) {
          selectors.push(selector.name.replace(/\\/g, ''));
        },
      });
      const matched = selectors.filter((name) => wanted.has(name));
      if (matched.length === 0) return;
      matched.forEach((name) => supported.add(name));

      const simple = generate(rule.prelude)
        .trim()
        .split(',')
        .map((selector) => selector.trim())
        .every((selector) =>
          selector.startsWith('.') && !/[\s>+~:#\[]/.test(selector.slice(1)));

      if (simple) {
        matched.forEach((name) => inlineable.add(name));
        inlineRules.push({ names: matched, rule });
      } else {
        residual.push(rule);
      }
    },
  });

  walk(styleSheet, {
    visit: 'Atrule',
    enter(atrule) {
      if (atrule.name !== 'layer' || !atrule.block) return;
      const name = generate(atrule.prelude).trim();
      if (name === 'base') {
        const block = generate(atrule.block);
        global.push(block.slice(1, -1));
      }
    },
  });

  return { global, inlineable, inlineRules, supported, residual };
}

function inlineStyles(rules, variables) {
  const styles = {};
  const localProperties = new Map();

  for (const rule of rules) {
    walk(rule, {
      visit: 'Declaration',
      enter(declaration) {
        if (declaration.property.startsWith('--')) {
          localProperties.set(declaration.property, generate(declaration.value).trim());
        }
      },
    });
  }

  const available = new Map([...variables, ...localProperties]);
  for (const rule of rules) {
    walk(rule, {
      visit: 'Declaration',
      enter(declaration) {
        if (declaration.property.startsWith('--')) return;
        const key = declaration.property.replace(/-([a-z])/g, (_, letter) =>
          letter.toUpperCase());
        styles[key] = resolveVariables(generate(declaration.value), available) +
          (declaration.important ? '!important' : '');
      },
    });
  }
  return styles;
}

function residualRuleText(rule, variables) {
  const children = [];
  rule.block.children.forEach((child) => children.push(child));
  const responsive = children.length > 0 && children.every((child) =>
    child.type === 'Atrule' &&
    child.name === 'media' &&
    child.block &&
    [...child.block.children].every((nested) => nested.type === 'Declaration'));
  if (!responsive) return resolveVariables(generate(rule), variables);

  const selector = generate(rule.prelude);
  return children.map((media) => {
    const declarations = resolveVariables(generate(media.block), variables);
    return `@media ${generate(media.prelude)}{${selector}${declarations}}`;
  }).join('\n');
}

function applyInline(node, inlineable, inlineRules, variables, unsupported = []) {
  if (isFragment(node)) {
    for (const child of node.childNodes) {
      applyInline(child, inlineable, inlineRules, variables, unsupported);
    }
    return unsupported;
  }
  if (!isElement(node)) return unsupported;

  if (node.className) {
    const names = node.className.split(/\s+/).filter(Boolean);
    const wanted = new Set(names);
    const rules = inlineRules
      .filter((entry) => entry.names.some((name) => wanted.has(name)))
      .map((entry) => entry.rule);
    const generated = inlineStyles(rules, variables);
    const explicit = { ...node.style };
    Object.assign(node.style, generated);
    for (const [key, value] of Object.entries(explicit)) {
      const classValue = generated[key];
      const classImportant = String(classValue ?? '').endsWith('!important');
      const inlineImportant = String(value ?? '').endsWith('!important');
      if (!classImportant || inlineImportant) node.style[key] = value;
    }

    const retained = [];
    for (const name of names) {
      if (!inlineable.has(name)) {
        retained.push(name);
        if (!unsupported.includes(name)) unsupported.push(name);
      }
    }
    if (retained.length) node.className = retained.join(' ');
    else node.removeAttribute('class');
  }

  for (const child of node.childNodes) {
    applyInline(child, inlineable, inlineRules, variables, unsupported);
  }
  return unsupported;
}

function firstTag(node, tag) {
  if (isElement(node) && node.tag === tag) return node;
  if (isElement(node) || isFragment(node)) {
    for (const child of node.childNodes) {
      const found = firstTag(child, tag);
      if (found) return found;
    }
  }
  return null;
}

export function inlineEmailTree(root, config = {}) {
  const classes = [...collectClasses(root)];
  if (classes.length === 0) return { unsupported: [], headCss: '' };

  const { styleSheet } = compile(classes, config);
  const variables = variablesOf(styleSheet);
  const {
    global,
    inlineable,
    inlineRules,
    supported,
    residual,
  } = classifyRules(styleSheet, classes);
  const unsupported = applyInline(root, inlineable, inlineRules, variables);
  const headCss = [
    ...global,
    ...residual.map((rule) => residualRuleText(rule, variables)),
  ].join('\n');

  if (headCss) {
    const head = firstTag(root, 'head');
    if (head) {
      const style = new head.constructor('style');
      style.innerHTML = headCss;
      head.appendChild(style);
    }
  }

  return {
    unsupported: unsupported.filter((name) => !supported.has(name)),
    headCss,
  };
}

export function registerEmailTailwindRoot(component, config) {
  const root = component?._root ?? component;
  if (root) registeredRoots.push({ root, config });
}

export function takeEmailTailwindRoots() {
  const roots = registeredRoots.slice();
  registeredRoots.length = 0;
  return roots;
}
