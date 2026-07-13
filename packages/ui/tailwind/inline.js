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

function customPropertiesOf(styleSheet) {
  const properties = new Map();
  walk(styleSheet, {
    visit: 'Atrule',
    enter(atrule) {
      if (atrule.name !== 'property' || !atrule.prelude) return;
      const name = generate(atrule.prelude);
      if (!name.startsWith('--')) return;
      let initialValue;
      walk(atrule, {
        visit: 'Declaration',
        enter(declaration) {
          if (declaration.property === 'initial-value') initialValue = declaration;
        },
      });
      properties.set(name, { initialValue });
    },
  });
  return properties;
}

function classifyRules(styleSheet, classes) {
  const wanted = new Set(classes);
  const inlineable = new Map();
  const supported = new Set();
  const residual = [];

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
        matched.forEach((name) => inlineable.set(name, rule));
      } else {
        residual.push(rule);
      }
    },
  });

  walk(styleSheet, {
    visit: 'Atrule',
    enter(atrule) {
      if (atrule.name === 'theme') residual.push(atrule);
      if (atrule.name === 'layer' && generate(atrule.prelude).includes('base')) {
        residual.push(atrule);
      }
      if (atrule.name === 'media') residual.push(atrule);
    },
  });

  return { inlineable, supported, residual };
}

function inlineStyles(rules, customProperties) {
  const styles = {};
  const localProperties = new Map();

  for (const rule of rules) {
    walk(rule, {
      visit: 'Declaration',
      enter(declaration) {
        if (declaration.property.startsWith('--')) {
          localProperties.set(declaration.property, declaration);
        }
      },
    });
  }

  for (const rule of rules) {
    walk(rule, {
      visit: 'Function',
      enter(fn, item) {
        if (fn.name !== 'var') return;
        let name;
        walk(fn, {
          visit: 'Identifier',
          enter(identifier) {
            name = identifier.name;
            return this.break;
          },
        });
        if (!name) return;
        const local = localProperties.get(name);
        if (local) {
          item.data = local.value;
          return;
        }
        const custom = customProperties.get(name);
        if (custom?.initialValue) item.data = custom.initialValue.value;
      },
    });

    walk(rule, {
      visit: 'Declaration',
      enter(declaration) {
        if (declaration.property.startsWith('--')) return;
        const key = declaration.property.replace(/-([a-z])/g, (_, letter) =>
          letter.toUpperCase());
        styles[key] = generate(declaration.value) +
          (declaration.important ? '!important' : '');
      },
    });
  }
  return styles;
}

function applyInline(node, inlineable, customProperties, unsupported = []) {
  if (isFragment(node)) {
    for (const child of node.childNodes) {
      applyInline(child, inlineable, customProperties, unsupported);
    }
    return unsupported;
  }
  if (!isElement(node)) return unsupported;

  if (node.className) {
    const retained = [];
    for (const name of node.className.split(/\s+/)) {
      if (!name) continue;
      const rule = inlineable.get(name);
      if (rule) {
        Object.assign(node.style, inlineStyles([rule], customProperties));
      } else {
        retained.push(name);
        if (!unsupported.includes(name)) unsupported.push(name);
      }
    }
    if (retained.length) node.className = retained.join(' ');
    else node.removeAttribute('class');
  }

  for (const child of node.childNodes) {
    applyInline(child, inlineable, customProperties, unsupported);
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
  const customProperties = customPropertiesOf(styleSheet);
  const { inlineable, supported, residual } = classifyRules(styleSheet, classes);
  const unsupported = applyInline(root, inlineable, customProperties);
  const headCss = residual.map((node) => generate(node)).join('\n');

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
