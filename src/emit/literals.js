// Literals: spreads, arrays, objects, ranges, string templates, heregexes,
// tagged templates and map literals.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isIdentifierName } from '../ident.js';
import { isNode, isNone, isList, isStruct, wordOf } from '../sexpr.js';
import { isUpdate } from './tree.js';
import { Emitter } from './core.js';

export class LiteralMethods {
  // ["...", {}, value] — an ES spread/rest element (calls, arrays,
  // patterns). Valid only where JS accepts it; the surrounding
  // construct owns that context. The operand is an operand position
  // (`[...(a || b)]` groups); pattern payloads are plain names and
  // never group.
  spread(node) {
    this.mark(node, '$self', () => {
      this.b.emit('...');
      if (this.inPattern) this.mark(node, 'value', () => this.expr(node[2]));
      else this.operand(node, 'value', node[2]);
    });
  }

  // ["array", {}, ...items] — an elision is an absent item; it emits
  // as an empty slot between commas.
  array(node) {
    this.mark(node, '$self', () => {
      this.b.emit('[');
      this.mark(node, 'items', () => {
        const items = node.slice(2);
        items.forEach((item, i) => {
          if (i > 0) this.b.emit(', ');
          if (isNone(item)) {
            // A TRAILING elision needs its own comma to survive: JS
            // ignores one trailing comma, so `[1, 2, ]` has no final
            // hole where the source `[1, 2,,]` does. Interior
            // elisions are carried by the separators alone.
            if (i === items.length - 1) this.b.emit(',');
            return;
          }
          // The `rest x` sugar: in a BINDING pattern a rest-headed
          // element is a rest element and lowers to `...x`
          // (`([rest a]) ->` → `([...a])`). It takes the tail with a
          // plain name ONLY — any other spelling rejects loudly, and a
          // TARGET pattern rejects the shape outright.
          if (isNode(item) && item[0] === 'rest' && this.inPattern) {
            if (!this.bindingPattern) {
              throw this.positionedError(item, "emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')", node);
            }
            if (item.length !== 3 || i !== items.length - 1) {
              throw this.positionedError(item, "emitter: a `rest` element takes the pattern's tail alone", node);
            }
            const name = wordOf(item[2]);
            if (name === undefined) {
              throw this.positionedError(item, 'emitter: a `rest` element takes a plain name', node);
            }
            this.b.emit('...');
            this.b.emit(name);
            return;
          }
          // A middle rest has no JS destructuring form. The one
          // lowering — a statement `[a, ...mid, b] = src` — never emits
          // its pattern, so a pattern reaching here is a parameter, a
          // loop variable, a catch binding, or a nested element.
          if (isNode(item) && item[0] === '...' && this.inPattern && i !== items.length - 1) {
            throw this.positionedError(item,
              'emitter: a rest element must end its pattern — JavaScript destructuring has no middle rest, ' +
              'and only a statement `[a, ...mid, b] = src` (plain names, at the top) lowers one', node);
          }
          // Array elements are operand positions: compound items group
          // (spreads never do — `...` binds its operand; pattern
          // elements never do — they are binding positions, and
          // `[(a = 1)]` is invalid destructuring JS).
          const wrap = !this.inPattern && !(isNode(item) && item[0] === '...') && Emitter.needsGrouping(item, 'operand');
          if (wrap) this.b.emit('(');
          this.expr(item);
          if (wrap) this.b.emit(')');
        });
      });
      this.b.emit(']');
    });
  }

  // A symbol literal as a property key: `[Symbol.for("name")]`.
  symbolKey(node) {
    this.b.emit('[');
    this.expr(node);
    this.b.emit(']');
  }

  // A `':'` pair with a simple identifier key and a thin-arrow value
  // emits as ES6 method shorthand (`->` has dynamic `this`, matching
  // method semantics; `=>` values stay arrows). String keys never
  // shorthand.
  static isMethodPair(pair) {
    if (!isNode(pair) || pair[0] !== ':' || pair[1].shorthand === true) return false;
    const key = wordOf(pair[2]);
    return key !== undefined && isIdentifierName(key) && isNode(pair[3]) && pair[3][0] === '->';
  }

  // ["object", {}, ...pairs]; pair = [":", {}, key, value], or the
  // shorthand [":", {shorthand}, key, key] (key and value are the same
  // text, so both role marks nest around the one emission).
  object(node) {
    // A regex KEY exists for Map literals only — a plain object would
    // stringify it into a property name nobody can spell back.
    for (let i = 2; i < node.length; i++) {
      const pair = node[i];
      if (isNode(pair) && pair[0] === ':' && wordOf(pair[2])?.[0] === '/') {
        throw this.positionedError(pair, 'emitter: a regex key needs a MAP literal (`*{ /re/: v }`) — object property names are strings');
      }
      // `a = 1` is a destructuring DEFAULT: legal in a pattern, and
      // in a literal it emits `({a = 1})`, which no engine parses.
      if (!this.inPattern && !this.tolerant && isNode(pair) && pair[0] === '=' && pair.length === 4) {
        throw this.positionedError(pair, 'emitter: `a = 1` inside an object literal is a destructuring default, which only a pattern can carry — spell the pair `a: 1`', node);
      }
    }
    const comp = this.inPattern ? null : Emitter.objectComprehension(node);
    // A dynamicKey comprehension key accumulates through its inner
    // expression (`result[k] = v`).
    if (comp) {
      const keyNode = isStruct(comp[2]) ? comp[2] : null;
      const keySpec = { expr: keyNode !== null ? keyNode[2] : comp[2], pair: comp, keyNode };
      return this.mark(node, '$self', () => this.mark(node, 'pairs', () =>
        this.mark(comp, '$self', () => this.mark(comp, 'value', () =>
          this.comprehension(comp[3], this.ind, keySpec)))));
    }
    const pairs = node.slice(2);
    if (this.inPattern) {
      const restAt = pairs.findIndex((pair) => isNode(pair) && pair[0] === '...');
      if (restAt !== -1 && restAt < pairs.length - 1) {
        throw this.positionedError(pairs[restAt],
          'emitter: a rest element must end its pattern — JavaScript destructuring takes `...rest` last', node);
      }
    }
    // Capture the statement indent ONCE: emitting an earlier pair's
    // method body mutates this.ind.
    const objInd = this.ind;
    // The pair join: `, ` until the first method; the method and every
    // pair after it start their own line (`,\n`, no indent).
    const firstMethod = this.inPattern ? -1 : pairs.findIndex(Emitter.isMethodPair);
    this.mark(node, '$self', () => {
      this.b.emit('{');
      this.mark(node, 'pairs', () => {
        pairs.forEach((pair, i) => {
          if (i > 0) this.b.emit(firstMethod !== -1 && i >= firstMethod ? ',\n' : ', ');
          if (!this.inPattern && Emitter.isMethodPair(pair)) this.objectMethod(pair, objInd);
          else this.objectPair(node, pair);
        });
      });
      this.b.emit('}');
    });
  }

  // A method-shorthand pair. A void pair is a VOID method (`fn!: ->`):
  // implicit return suppressed; its voidMarker role covers the whole
  // emitted method.
  objectMethod(pair, objInd) {
    const [, { void: isVoid }, key, value] = pair;
    this.mark(pair, 'voidMarker', () => this.mark(pair, '$self', () => this.withThisBoundary(() => {
      const [, , params, block] = value;
      const name = wordOf(key);
      if (this.containsAwait(block)) this.b.emit('async ');
      if (this.containsYield(block)) this.b.emit('*');
      this.mark(pair, 'key', () => this.b.emit(name));
      // A method of a contextually-typed literal takes its param
      // types from the annotation the literal sits under; JS arity
      // must not widen them (same rule as the arrow path).
      const inArgs = this.ts && this.contextuallyTyped(value);
      this.b.emit('(');
      this.mark(value, 'params', () => this.emitParams(params, null, !inArgs));
      this.b.emit(')');
      this.tsReturnAnnotation(value, this.containsAwait(block), isVoid === true, this.containsYield(block), pair);
      this.b.emit(' ');
      this.mark(pair, 'value', () => {
        this.methodBlock(value, block, objInd, { isConstructor: false, binds: [], methodName: name, voidBody: isVoid === true });
      });
    })));
  }

  // Every pair but a method: keyed, computed, string- or symbol-keyed,
  // shorthand, a pattern default, or a rest/spread.
  objectPair(node, pair) {
    const [head, { void: isVoid, shorthand }, key, value] = pair;
    const dynamicKey = isNode(key) && key[0] === 'dynamicKey';
    // An INTERPOLATED string key is a computed key: the template IS the
    // key expression (`{"#{k}": v}` → `[\`${k}\`]: v`). A symbol key
    // (`{ :sym: v }`) is a computed key too.
    const strKey = isNode(key) && key[0] === 'str';
    const symKey = isNode(key) && key[0] === 'symbol';
    // `@`-keys are class-body syntax (static members) — no valid JS
    // emission exists in a plain object literal; the key parses
    // (SimpleObjAssignable) so class bodies can use it, and rejects
    // loudly here. The this-index key form (`{@[k]: v}`) has no valid
    // JS emission anywhere and rejects with it. Rest elements
    // (`{...rest}`) pass — their payload is a name.
    if (head !== '...' && isStruct(key) && !dynamicKey && !strKey && !symKey) {
      throw this.positionedError(pair, 'emitter: @-keys are only supported in class bodies', node);
    }
    if (symKey) {
      this.mark(pair, '$self', () => {
        this.mark(pair, 'key', () => this.symbolKey(key));
        this.b.emit(': ');
        this.mark(pair, 'value', () => this.expr(value));
      });
      return;
    }
    if (strKey) {
      this.mark(pair, '$self', () => {
        this.b.emit('[');
        this.mark(pair, 'key', () => this.strTemplate(key));
        this.b.emit(']: ');
        this.mark(pair, 'value', () => this.expr(value));
      });
      return;
    }
    this.mark(pair, '$self', () => {
      if (head === ':' && dynamicKey) {
        // `[key]:` — the key expression is an operand position.
        this.mark(pair, 'key', () => {
          this.mark(key, '$self', () => {
            this.b.emit('[');
            this.withExpression(() => this.operand(key, 'key', key[2]));
            this.b.emit(']');
          });
        });
        this.b.emit(': ');
        if (this.inPattern || (isNode(value) && value[0] === '=>')) this.mark(pair, 'value', () => this.expr(value));
        else this.operand(pair, 'value', value);
      } else if (head === ':' && shorthand !== true) {
        // A non-method void pair is a void definition whose value must
        // still be a function (a '=>' here — the '->' form took the
        // method-shorthand path); in a destructuring pattern the marker
        // has no meaning and rejects.
        if (isVoid === true) {
          if (this.inPattern) {
            throw this.positionedError(pair, "emitter: the void marker has no meaning in a destructuring pattern — a pattern key takes no trailing '!'", node);
          }
          this.registerVoidValue(value, pair);
        }
        this.mark(pair, 'voidMarker', () => {
          this.mark(pair, 'key', () => this.b.emit(wordOf(key)));
          this.b.emit(': ');
          // Object pair values are operand positions: compound values
          // group — EXCEPT inside a pattern, where the value is a binding
          // position (a rename target, a nested pattern, or a default
          // like `{a: x = 2}`) and grouping is invalid destructuring JS.
          // Fat-arrow values emit BARE (`n: () => this.a` — an arrow
          // needs no grouping in value position).
          if (this.inPattern || (isNode(value) && value[0] === '=>')) this.mark(pair, 'value', () => this.expr(value));
          else this.operand(pair, 'value', value);
        });
      } else if (head === '=') {
        // Pattern default: {a = 1}. The default VALUE is an expression
        // position again.
        this.mark(pair, 'key', () => this.b.emit(wordOf(key)));
        this.b.emit(' = ');
        this.withExpression(() => this.operand(pair, 'value', value));
      } else if (head === '...') {
        // Rest element: {...rest} — the dots are the pair's syntax; the
        // value mark stays exact on the name. An ObjSpreadExpr payload
        // (member chains, calls, indexing, parentheticals, this) is an
        // object-LITERAL spread only: in a destructuring pattern the
        // rest target must be a plain name — `this` is a word but no
        // rest target either.
        if (this.inPattern && (isStruct(key) || wordOf(key) === 'this')) {
          throw this.positionedError(pair, 'emitter: object rest in a destructuring pattern takes a plain name — chained-accessor rest targets are not supported', node);
        }
        this.b.emit('...');
        // The payload is an operand position (`{...(a || b)}` groups);
        // pattern payloads are plain names.
        if (this.inPattern) this.mark(pair, 'value', () => this.expr(key));
        else this.operand(pair, 'value', key);
      } else if (this.bareRewrite(wordOf(key)) !== null) {
        // Reactive/member shorthand expands — the KEY stays the bare
        // name, the VALUE is the rewritten read (`{count}` → `{count:
        // count.value}`; a component member → `{count:
        // this.count.value}`). In a BINDING pattern the shorthand is a
        // new name and bareRewrite already declines.
        this.mark(pair, 'key', () => this.b.emit(wordOf(key)));
        this.b.emit(': ');
        this.mark(pair, 'value', () => this.expr(key));
      } else {
        this.mark(pair, 'value', () => this.mark(pair, 'key', () => this.b.emit(wordOf(key))));
      }
    });
  }

  // A unary-minus key with a plain digit operand: `a[-1]` reads lower
  // to `.at(-n)` (last-element semantics).
  static negativeLiteralKey(key) {
    return isNode(key) && key[0] === '-' && key.length === 3 && /^\d+$/.test(wordOf(key[2]) ?? '');
  }

  // Standalone range: an IIFE lowering.
  range(node) {
    const [dots, , from, to] = node;
    const helper = dots === '..'
      ? '((s, e) => Array.from({length: Math.abs(e - s) + 1}, (_, i) => s + (i * (s <= e ? 1 : -1))))'
      : '((s, e) => Array.from({length: Math.max(0, Math.abs(e - s))}, (_, i) => s + (i * (s <= e ? 1 : -1))))';
    this.mark(node, '$self', () => {
      this.b.emit(helper);
      this.b.emit('(');
      this.mark(node, 'from', () => this.expr(from));
      this.b.emit(', ');
      this.mark(node, 'to', () => this.expr(to));
      this.b.emit(')');
    });
  }

  // ["str", {}, ...chunks] — template literal.
  strTemplate(node) {
    this.mark(node, '$self', () => {
      this.b.emit('`');
      this.templateChunks(node.slice(2));
      this.b.emit('`');
    });
  }

  // The chunk sequence of a template-lowered literal (interpolated
  // strings and heregexes): string chunks are quoted values (empty ones
  // drop); interpolation chunks are Body lists whose single expression
  // emits inside ${…} (compounds group) — the Body list's own $self
  // mark makes each interpolated expression bidirectionally mapped
  // with real source spans. An empty interpolation (#{}) is absent.
  templateChunks(chunks) {
    for (const chunk of chunks) {
      if (isNone(chunk)) continue;
      if (isList(chunk)) {
        if (chunk.length !== 1) {
          throw this.positionedError(chunk, 'emitter: multi-statement interpolations are not supported yet');
        }
        this.b.emit('${');
        this.mark(chunk, '$self', () => {
          const wrap = Emitter.needsGrouping(chunk[0], 'operand') || isUpdate(chunk[0]);
          if (wrap) this.b.emit('(');
          this.expr(chunk[0]);
          if (wrap) this.b.emit(')');
        });
        this.b.emit('}');
      } else {
        const content = wordOf(chunk).slice(1, -1);
        if (content !== '') this.b.emit(Emitter.escapeTemplate(content));
      }
    }
  }

  // ["here-regex", {}, flags, ...chunks] — an interpolated heregex lowers to a
  // RegExp call over a template literal (chunks already stripped by the
  // lexer), with the flags as a second argument when present.
  heregex(node) {
    const [, , flags, ...chunks] = node;
    this.mark(node, '$self', () => {
      this.b.emit('RegExp(`');
      this.templateChunks(chunks);
      this.b.emit('`');
      if (flags !== '') this.b.emit(`, '${flags}'`);
      this.b.emit(')');
    });
  }

  // ["tagged-template", {}, tag, str] — the tag calls the template:
  // `tag"x"` / `sh $"cmd #{c}"` → tag`x` / sh`cmd ${c}`. The tag is a
  // head position (a non-primary tag would rebind the template onto
  // its last sub-expression); the template re-emits the string in
  // backtick form — a plain value's quotes swap (its escapes carry),
  // a single-quote heredoc is already backtick-delimited, and an
  // interpolated string's own emission is the template.
  taggedTemplate(node) {
    this.mark(node, '$self', () => {
      const tag = node[2];
      this.mark(node, 'tag', () => {
        if (Emitter.needsGrouping(tag, 'head')) {
          this.b.emit('(');
          this.expr(tag);
          this.b.emit(')');
        } else this.expr(tag);
      });
      const s = node[3];
      const text = wordOf(s);
      this.mark(node, 'str', () => {
        if (text !== undefined) {
          if (text[0] === '`') this.b.emit(text);
          else this.b.emit('`' + Emitter.escapeTemplate(text.slice(1, -1).replace(/\\"/g, '"')) + '`');
        } else {
          this.expr(s);
        }
      });
    });
  }

  // ["map", {}, ...pairs] — `*{ k: v, … }` builds a Map: identifier keys
  // read as strings (the object-key convention); literal keys of any
  // other kind — strings, numbers, booleans, null, undefined,
  // regexes — pass through as themselves; a computed key ([k]: v)
  // passes its expression. Values are plain expressions.
  mapLiteral(node) {
    this.mark(node, '$self', () => {
      const pairs = node.slice(2);
      if (pairs.length === 0) {
        this.b.emit('new Map()');
        return;
      }
      this.b.emit('new Map([');
      pairs.forEach((pair, i) => {
        if (i > 0) this.b.emit(', ');
        if (isNode(pair) && pair[0] === '...' && pair.length === 3) {
          // A spread contributes its ENTRIES: `*{ a: 1, ...other }`
          // spreads an iterable of [key, value] pairs (another Map).
          this.mark(pair, '$self', () => {
            this.b.emit('...');
            this.expr(pair[2]);
          });
          return;
        }
        if (!isNode(pair) || pair[0] !== ':' || pair.length !== 4 || pair[1].shorthand === true || pair[1].void === true) {
          throw this.positionedError(isNode(pair) ? pair : node, 'emitter: a map literal takes explicit `key: value` pairs — shorthand has no Map reading');
        }
        this.mark(pair, '$self', () => {
          this.b.emit('[');
          const key = pair[2];
          const word = wordOf(key);
          this.mark(pair, 'key', () => {
            if (word !== undefined && isIdentifierName(word) &&
                word !== 'true' && word !== 'false' && word !== 'null' && word !== 'undefined') {
              // Re-rendered quoted, so the pair's cover breaks at the quote —
              // the name itself is still verbatim inside it.
              this.b.emit('"');
              this.emitLeaf(key, word);
              this.b.emit('"');
            } else if (isNode(key) && key[0] === 'dynamicKey') {
              this.expr(key[2]);
            } else {
              this.expr(key);
            }
          });
          this.b.emit(', ');
          this.mark(pair, 'value', () => this.expr(pair[3]));
          this.b.emit(']');
        });
      });
      this.b.emit('])');
    });
  }
}
