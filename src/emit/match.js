// Switch statements and match arms.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isIdentifierName } from '../ident.js';
import { isNode, isNone, mkCall, mkNode, mkLeaf, wordOf } from '../sexpr.js';
import { CTRL_BREAK } from './helpers.js';
import { Emitter } from './core.js';

export class MatchMethods {
  // A `when` arm whose condition is a regex literal or a range is a
  // MATCH test, not a value: `case /re/:` compares the subject to the
  // RegExp object and `case [1..3]:` to a fresh array — neither ever
  // matches. A switch carrying one lowers whole to an if/else chain
  // over the subject (bound once when it is not a plain read), each
  // arm testing `re.test(s)`, `s >= a && s <= b`, or `s === v`.
  static isMatchArm(c) {
    const w = wordOf(c);
    if (w !== undefined) return w.startsWith('/');
    return isNode(c) && (c[0] === 'here-regex' || ((c[0] === '..' || c[0] === '...') && c.length === 4));
  }

  static hasMatchArms(cases) {
    return cases.some((when) => when[2].some((c) => Emitter.isMatchArm(c)));
  }

  // The match lowering's preconditions: a subject to test, and arms
  // whose `break` still means what it meant. A `break` in an arm's
  // body that no loop or switch INSIDE the arm binds left the JS
  // switch; in the if-chain lowering it would leave the enclosing
  // loop (or be invalid).
  checkMatchSwitch(node) {
    const [, , subject, cases, dflt] = node;
    if (isNone(subject)) {
      throw this.positionedError(node, 'emitter: a regex or range `when` tests the switch subject, and this switch has none — give it one (`switch x`) or spell the test out (`when /re/.test(x)`)');
    }
    for (const body of [...cases.map((when) => when[3]), dflt]) {
      if (this.containsCtrl(body) && Emitter.findCapturedCtrl(body, CTRL_BREAK) !== null) {
        throw this.positionedError(node, 'emitter: `break` in an arm of a switch with a regex or range `when` has nothing to leave — the switch is an if-chain and each arm ends on its own; drop the `break`');
      }
    }
  }

  // The tree of one arm's test against the discriminant (the render
  // path rewrites its switch into an if-chain).
  static matchArmSexpr(disc, t) {
    if (!Emitter.isMatchArm(t)) return mkNode('==', disc, t);
    if (isNode(t) && (t[0] === '..' || t[0] === '...')) {
      return mkNode('&&', mkNode('>=', disc, t[2]), mkNode(t[0] === '..' ? '<=' : '<', disc, t[3]));
    }
    return mkCall(mkNode('.', t, mkLeaf('name', 'test')), disc);
  }

  // One arm's test, emitted; `subj` emits the subject read.
  matchArmTest(c, subj) {
    if (wordOf(c)?.startsWith('/')) {
      this.expr(c);
      this.b.emit('.test(');
      subj();
      this.b.emit(')');
    } else if (isNode(c) && c[0] === 'here-regex') {
      this.b.emit('(');
      this.expr(c);
      this.b.emit(').test(');
      subj();
      this.b.emit(')');
    } else if (isNode(c) && (c[0] === '..' || c[0] === '...') && c.length === 4) {
      this.b.emit('(');
      subj();
      this.b.emit(' >= ');
      this.expr(c[2]);
      this.b.emit(' && ');
      subj();
      this.b.emit(c[0] === '..' ? ' <= ' : ' < ');
      this.expr(c[3]);
      this.b.emit(')');
    } else {
      subj();
      this.b.emit(' === ');
      this.expr(c);
    }
  }

  // The if/else chain a match switch lowers to. The subject binds
  // once unless it is a plain (non-reactive) name, which every test
  // reads directly; `arm(body)` lays out one arm's body (a brace
  // block in statement position, a returning block in value position).
  matchChain(node, ind, arm) {
    const [, , subject, cases, dflt] = node;
    const pad = '  '.repeat(ind);
    const word = wordOf(subject);
    const plainRead = word !== undefined && isIdentifierName(word) && !this.isReactiveName(word);
    const ref = plainRead ? null : this.loopTempName('_switch');
    const subj = () => (ref !== null ? this.b.emit(ref) : this.mark(node, 'subject', () => this.expr(subject)));
    if (ref !== null) {
      this.temps.used.add(ref);
      this.b.emit(`const ${ref} = `);
      this.mark(node, 'subject', () => this.expr(subject));
      this.b.emit(`;\n${pad}`);
    }
    this.mark(node, 'cases', () => {
      cases.forEach((when, i) => {
        this.mark(when, '$self', () => {
          const [, , conditions, body] = when;
          if (i > 0) this.b.emit(' else ');
          this.b.emit('if (');
          conditions.forEach((c, k) => {
            if (k > 0) this.b.emit(' || ');
            this.matchArmTest(c, subj);
          });
          this.b.emit(') ');
          arm(body);
        });
      });
    });
    if (!isNone(dflt)) {
      this.b.emit(' else ');
      arm(dflt);
    }
  }

  // The tests of one `when` of a subjectless switch, as an `if`
  // condition: one test stands bare; several are ORed, each in its own
  // parentheses so a test of lower precedence keeps its meaning.
  whenTests(conditions) {
    if (conditions.length === 1) {
      this.expr(conditions[0]);
      return;
    }
    conditions.forEach((c, k) => {
      this.b.emit(k > 0 ? ') || (' : '(');
      this.expr(c);
    });
    this.b.emit(')');
  }

  // `into` names an accumulator: the switch is the tail of a collecting
  // loop's body, and each arm pushes its own tail value.
  switchStatement(node, ind, into = null) {
    const [, , subject, cases, dflt] = node;
    const pad = '  '.repeat(ind);
    const block = (body) => (into === null ? this.braceBlock(body, ind) : this.accumulateBlock(body, ind, into));
    if (Emitter.hasMatchArms(cases)) {
      this.checkMatchSwitch(node);
      this.mark(node, '$self', () => {
        this.matchChain(node, ind, block);
        if (into !== null && isNone(dflt)) this.accumulateMissingArm(ind, into);
      });
      return;
    }
    this.mark(node, '$self', () => {
      if (!isNone(subject)) this.liveScope(() => {
        this.b.emit('switch (');
        this.mark(node, 'subject', () => this.expr(subject));
        this.b.emit(') {\n');
        this.mark(node, 'cases', () => {
          for (const when of cases) {
            this.mark(when, '$self', () => {
              const [, , conditions, body] = when;
              for (const c of conditions) {
                this.b.emit(`${pad}  case `);
                this.expr(c);
                this.b.emit(':\n');
              }
              this.caseBody(body, ind, into);
            });
          }
        });
        if (!isNone(dflt)) {
          this.b.emit(`${pad}  default:\n`);
          this.caseBody(dflt, ind, into);
        } else if (into !== null) {
          this.b.emit(`${pad}  default:\n${pad}    ${into}.push(undefined);\n`);
        }
        this.b.emit(`${pad}}`);
      }, 'switch');
      else {
        // Subjectless switch lowers to an if/else chain: a `when` of one
        // test is that test, and a `when` of several ORs them, each in
        // its own parentheses.
        cases.forEach((when, i) => {
          const [, , conditions, body] = when;
          if (i > 0) this.b.emit(' else ');
          this.b.emit('if (');
          this.whenTests(conditions);
          this.b.emit(') ');
          block(body);
        });
        if (!isNone(dflt)) {
          this.b.emit(' else ');
          block(dflt);
        } else if (into !== null) {
          this.accumulateMissingArm(ind, into);
        }
      }
    });
  }

  caseBody(block, ind, into = null) {
    this.inCtrl(() => this.caseBodyCtrl(block, ind, into), false);
  }

  caseBodyCtrl(block, ind, into) {
    if (into !== null) {
      this.accumulateBody(block, ind + 1, into);
      this.b.emit('  '.repeat(ind + 2) + 'break;\n');
      return;
    }
    const all = this.isBlock(block) ? block.slice(2) : [block];
    const stmts = this.liveStmts(all);
    this.emitTsTypeDecls(all, '  '.repeat(ind + 2));
    for (const stmt of stmts) {
      this.b.emit('  '.repeat(ind + 2));
      this.statement(stmt, ind + 2);
      this.b.emit('\n');
    }
    this.b.emit('  '.repeat(ind + 2) + 'break;\n');
  }
}
