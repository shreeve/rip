/**
 * Complete Grammar DSL Helper Functions (TypeScript)
 * For Rip parser generator with o/x distinction
 */

// Type definitions
type Pattern = string;
type Precedence = string | null;
type NodeSpec = any; // This could be more specific based on your AST types
type Production = [Pattern, MarkedSpec, Precedence];
type MarkedSpec = { $node: NodeSpec } | { $pass: any };

interface SpecialOperators {
  $concat?: any[];
  $slice?: any[];
  $array?: any[];
  $noType?: boolean;
}

interface ASTNode {
  type?: string;
  [key: string]: any;
}

/**
 * Split pattern on pipes for alternatives
 */
const alts = (pattern: Pattern): Pattern[] =>
  pattern.includes('|')
    ? pattern.split('|').map(p => p.trim()).filter(Boolean)
    : [pattern];

/**
 * Validate pattern string
 */
function validatePattern(pattern: any): asserts pattern is Pattern {
  if (typeof pattern !== 'string') {
    throw new Error(`Pattern must be string, got ${typeof pattern}`);
  }
  if (pattern.includes('  ')) {
    throw new Error(`Pattern "${pattern}" has double spaces - likely a typo`);
  }
}

/**
 * o() - BUILD/CREATE helper
 * Creates new AST nodes (with auto-typing in parser generator)
 */
export function o(pattern: Pattern, node?: NodeSpec, precedence?: Precedence): Production[] {
  validatePattern(pattern);
  return alts(pattern).map(p => [p, { $node: node }, precedence || null]);
}

/**
 * x() - FORWARD/PASS helper
 * Passes values through without modification
 */
export function x(pattern: Pattern, value: any = '$1'): Production[] {
  validatePattern(pattern);
  return alts(pattern).map(p => [p, { $pass: value }, null]);
}

/**
 * Binary operators helper
 */
export function binOp(operators: string, precedence?: Precedence): Production[] {
  return alts(operators).map(op => [
    `Expression ${op} Expression`,
    { $node: { left: '$1', op: op, right: '$3' } },
    precedence || op
  ]);
}

/**
 * Unary operators helper
 */
export function unaryOp(operators: string, precedence?: Precedence): Production[] {
  return alts(operators).map(op => [
    `${op} Expression`,
    { $node: { op: op, argument: '$2' } },
    precedence || null
  ]);
}

/**
 * Keywords/literals helper
 */
export function keywords(
  words: string,
  nodeTemplate?: NodeSpec | ((word: string) => NodeSpec)
): Production[] {
  return alts(words).map(word => {
    const node = typeof nodeTemplate === 'function'
      ? nodeTemplate(word)
      : nodeTemplate || { value: word };
    return [word, { $node: node }, null];
  });
}

/**
 * Optional elements helper (? in EBNF)
 */
export function opt(pattern: Pattern, presentValue: any = '$1', absentValue: any = null): Production[] {
  return [
    ...x('', absentValue),
    ...x(pattern, presentValue)
  ];
}

/**
 * One-or-more repetition (+ in EBNF)
 */
export function plus(itemName: string, separator?: string | null): Production[] {
  if (separator) {
    return [
      ...o(itemName, ['$1']),
      ...o(`${itemName}List ${separator} ${itemName}`, { $concat: ['$1', '$3'] })
    ];
  }
  return [
    ...o(itemName, ['$1']),
    ...o(`${itemName}List ${itemName}`, { $concat: ['$1', '$2'] })
  ];
}

/**
 * Zero-or-more repetition (* in EBNF)
 */
export function star(itemName: string, separator?: string | null): Production[] {
  if (separator) {
    return [
      ...o('', []),  // Empty produces empty array
      ...o(itemName, ['$1']),
      ...o(`${itemName}List ${separator} ${itemName}`, { $concat: ['$1', '$3'] })
    ];
  }
  return [
    ...o('', []),  // Empty produces empty array
    ...o(itemName, ['$1']),
    ...o(`${itemName}List ${itemName}`, { $concat: ['$1', '$2'] })
  ];
}

/**
 * List building helper (handles trailing separators)
 */
export function list(itemName: string, separator: string = ','): Production[] {
  return [
    ...o(itemName, ['$1']),
    ...o(`${itemName}List ${separator} ${itemName}`, { $concat: ['$1', '$3'] }),
    ...x(`${itemName}List ${separator}`)  // Pass through with trailing separator
  ];
}

/**
 * Wrapped/parenthetical expressions helper
 */
export function wrapped(
  openToken: string,
  closeToken: string,
  innerRule: string = 'Expression'
): Production[] {
  return [
    ...o(`${openToken} ${closeToken}`, null),  // Empty
    ...x(`${openToken} ${innerRule} ${closeToken}`, '$2')  // Pass through inner
  ];
}

/**
 * Type guard for marked node specs
 */
function isNodeSpec(spec: any): spec is { $node: NodeSpec } {
  return spec && typeof spec === 'object' && '$node' in spec;
}

/**
 * Type guard for pass specs
 */
function isPassSpec(spec: any): spec is { $pass: any } {
  return spec && typeof spec === 'object' && '$pass' in spec;
}

/**
 * Type guard for special operators
 */
function hasSpecialOperators(node: any): node is SpecialOperators {
  return node && typeof node === 'object' &&
    (node.$concat || node.$slice || node.$array);
}

/**
 * Parser generator's node expansion function
 * Interprets $node and $pass markers from o() and x()
 */
export function expandNodeSpec(lhs: string, nodeSpec: MarkedSpec | any): any {
  // Handle o() nodes - BUILD with auto-typing
  if (isNodeSpec(nodeSpec)) {
    const node = nodeSpec.$node;

    if (node == null) return '$1';
    if (Array.isArray(node)) return { $array: node };

    if (typeof node === 'object') {
      // Special operators pass through
      if (hasSpecialOperators(node)) return node;

      // AUTO-TYPE: Add type field if not present
      if (!node.type && !node.$noType) {
        return { type: lhs, ...node };
      }
      return node;
    }

    return node;
  }

  // Handle x() values - PASS without modification
  if (isPassSpec(nodeSpec)) {
    return nodeSpec.$pass;
  }

  throw new Error(`Production for ${lhs} missing o() or x() wrapper`);
}

/**
 * Grammar rule type
 */
type GrammarRule = Production[] | Production;
type Grammar = Record<string, GrammarRule>;
type ProcessedGrammar = Record<string, Production[]>;

/**
 * Process grammar for parser generator
 * Flattens arrays and validates structure
 */
export function processGrammar(grammar: Grammar): ProcessedGrammar {
  const processed: ProcessedGrammar = {};

  for (const [lhs, rule] of Object.entries(grammar)) {
    // Validate LHS
    if (!lhs || typeof lhs !== 'string') {
      throw new Error(`Invalid LHS: ${lhs}`);
    }

    // Simply flatten one level - helper functions return arrays, we just need to unwrap them
    // Example: Body: [o(...), x(...)] where o() returns [production]
    //          → Body: [production, production] after .flat()
    if (Array.isArray(rule)) {
      processed[lhs] = rule.flat();
    } else {
      throw new Error(`Invalid rule format for ${lhs} - all rules must be arrays`);
    }

    // Validate each production
    for (const production of processed[lhs]) {
      if (!Array.isArray(production) || production.length !== 3) {
        throw new Error(`Invalid production format in ${lhs}`);
      }
      const [pattern, spec, precedence] = production;
      if (typeof pattern !== 'string') {
        throw new Error(`Invalid pattern in ${lhs}: ${pattern}`);
      }
    }
  }

  return processed;
}

// Export all functions and types
export {
  type Pattern,
  type Precedence,
  type NodeSpec,
  type Production,
  type MarkedSpec,
  type Grammar,
  type ProcessedGrammar,
  type ASTNode,
  type SpecialOperators
};
