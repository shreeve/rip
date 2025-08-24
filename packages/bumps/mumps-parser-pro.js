// mumps-parser-pro.js (consolidated)
// Pure JS, Bun-friendly. High-performance M (MUMPS) line-first scanner+parser.
// Includes: char-based parser, token-driven top-level parsing (from Zig lexer),
// pattern-literal parsing, interning, and a flexible formatter.
//
// Exports:
//   - parseMumps(input)                      // char-scanner path
//   - parseMumpsWithTokens(buffer, toks)     // token-driven top-level path
//   - formatMumps(ast, opts)
//   - NodeKind, TokenKind
//   - text(buffer, start, end)
//
// Notes:
// - Input is best as Uint8Array; strings are encoded once.
// - Expressions follow M left-to-right evaluation (no precedence).
// - Commands normalized; single-letter abbreviations handled. 'H' resolved via args.
// - Pattern operator (?) parsed into NodeKind.Pattern mini-AST while preserving spans.

"use strict";

/** Public API ***************************************************************/
export function parseMumps(input /* string|Uint8Array */) {
  const buf = toBytes(input);
  const P = new Program(buf);
  const program = P.parseProgram();
  return makeAstResult(buf, program, P);
}

/** Parse using tokens from a Zig lexer
 * toks: Uint32Array of length n*3 with triplets [kind,start,end]
 * kind values mirror TokenKind below.
 */
export function parseMumpsWithTokens(buffer /* Uint8Array|string */, toks /* Uint32Array */) {
  const buf = toBytes(buffer);
  const P = new Program(buf);
  const program = P.parseProgramFromTokens(toks);
  return makeAstResult(buf, program, P);
}

/** Export a safe slice → string helper */
export function text(buf, start, end) {
  return new TextDecoder().decode(buf.subarray(start, end));
}

function makeAstResult(buf, program, P) {
  return {
    kind: NodeKind.Program,
    buffer: buf,
    program,
    lines: program.lines,
    nodes: P.nodes,
    symbols: P.intern,
    format: (opts) => formatMumps({ buffer: buf, program, symbols: P.intern }, opts),
  };
}

/** Node kinds ***************************************************************/
export const NodeKind = Object.freeze({
  Program: 1, Line: 2, Command: 3, ArgList: 4, Assign: 5,
  ExprBinary: 6, ExprUnary: 7, Number: 8, String: 9,
  Local: 10, Global: 11, Subscript: 12, Indirect: 13,
  Dollar: 14, DblDollar: 15, Paren: 16,
  WriteNL: 17, WriteTab: 18, Comment: 19,
  Pattern: 20
});

/** Token kinds (to mirror the Zig lexer) ************************************/
export const TokenKind = Object.freeze({
  Ident:1, Number:2, String:3, Space:4, Newline:5, Semi:6, LParen:7, RParen:8, Comma:9,
  Caret:10, Dollar:11, At:12, Colon:13, Plus:14, Minus:15, Star:16, Slash:17, BSlash:18,
  Hash:19, Und:20, Amp:21, Bang:22, Tick:23, Lt:24, Gt:25, Eq:26, QMark:27, LBr:28, RBr:29, Dot:30, Other:31
});

/** Utilities ****************************************************************/
function toBytes(x) { return x instanceof Uint8Array ? x : new TextEncoder().encode(String(x)); }
const C = {
  NL:10, CR:13, SP:32, TAB:9, QUOTE:34, SEMI:59, LP:40, RP:41, COMMA:44,
  CARET:94, DOLLAR:36, AT:64, COLON:58, PLUS:43, MINUS:45, STAR:42,
  SLASH:47, BSLASH:92, HASH:35, UND:95, AMP:38, BANG:33, TICK:39,
  LT:60, GT:62, EQ:61, QMARK:63, LBR:91, RBR:93, PERC:37, DOT:46
};
const isSpace = b => b === C.SP || b === C.TAB;
const isDigit = b => b >= 48 && b <= 57;
const isAlpha = b => (b >= 65 && b <= 90) || (b >= 97 && b <= 122);
const isIdentStart = b => isAlpha(b) || b === C.PERC;
const isIdentPart  = b => isAlpha(b) || isDigit(b) || b === C.PERC;

/** Commands *****************************************************************/
const CMD = Object.freeze({
  BREAK:"BREAK", CLOSE:"CLOSE", DO:"DO", ELSE:"ELSE", FOR:"FOR", GOTO:"GOTO",
  HALT:"HALT", HANG:"HANG", IF:"IF", JOB:"JOB", KILL:"KILL", LOCK:"LOCK",
  MERGE:"MERGE", NEW:"NEW", OPEN:"OPEN", QUIT:"QUIT", READ:"READ", SET:"SET",
  USE:"USE", VIEW:"VIEW", WRITE:"WRITE", XECUTE:"XECUTE"
});

const CMD_MAP = (() => {
  const m = Object.create(null), add = (k,v)=>m[k]=v;
  for (const k of Object.keys(CMD)) add(k,k);
  // single-letter abbreviations
  add("B",CMD.BREAK); add("C",CMD.CLOSE); add("D",CMD.DO); add("E",CMD.ELSE);
  add("F",CMD.FOR); add("G",CMD.GOTO); add("I",CMD.IF); add("J",CMD.JOB);
  add("K",CMD.KILL); add("L",CMD.LOCK); add("M",CMD.MERGE); add("N",CMD.NEW);
  add("O",CMD.OPEN); add("Q",CMD.QUIT); add("R",CMD.READ); add("S",CMD.SET);
  add("U",CMD.USE); add("V",CMD.VIEW); add("W",CMD.WRITE); add("X",CMD.XECUTE);
  return m;
})();

/** Abbreviation table for formatter *****************************************/
const CMD_ABBR = Object.freeze({
  BREAK:"B", CLOSE:"C", DO:"D", ELSE:"E", FOR:"F", GOTO:"G",
  HALT:"H", HANG:"H", IF:"I", JOB:"J", KILL:"K", LOCK:"L",
  MERGE:"M", NEW:"N", OPEN:"O", QUIT:"Q", READ:"R", SET:"S",
  USE:"U", VIEW:"V", WRITE:"W", XECUTE:"X"
});

/** String Interner **********************************************************/
class Interner {
  constructor(buf) { this.buf = buf; this.map = new Map(); this.syms = [""]; this.dec = new TextDecoder(); }
  intern(start, end) {
    // Cheap uniqueness key that avoids slicing: length:start
    const key = (end - start) + ":" + start;
    let id = this.map.get(key);
    if (id !== undefined) return id;
    const s = this.dec.decode(this.buf.subarray(start, end));
    id = this.syms.length;
    this.syms.push(s);
    this.map.set(key, id);
    return id;
  }
  get(id) { return this.syms[id] || ""; }
}

/** Parser *******************************************************************/
class Program {
  constructor(buf) {
    this.b = buf; this.n = buf.length;
    this.nodes = [];
    this.lines = [];
    this.intern = new Interner(buf);
    this._indexLines(); // for char-based path
    this.td = new TextDecoder();
  }

  /** Char-scanner path */
  parseProgram() {
    const program = this._node(NodeKind.Program, { lines: [] });
    for (let k = 0; k < this.lines.length; k++) {
      const { start, end, indent } = this.lines[k];
      const lineNode = this._parseLine(start, end, indent);
      program.lines.push(lineNode);
    }
    return program;
  }

  /** Token-stream (Zig) path for top-level structure */
  parseProgramFromTokens(toks /* Uint32Array */) {
    const K = TokenKind;
    const lines = [];
    let byteStart = 0;
    for (let i = 0; i < toks.length; i += 3) {
      const kind = toks[i] & 0xFFFF;
      if (kind === K.Newline) {
        const end = toks[i + 1];
        const indent = this._leadingIndent(byteStart, end);
        lines.push({ start: byteStart, end, indent });
        byteStart = toks[i + 2];
      }
    }
    if (byteStart < this.n) {
      const end = this.n;
      const indent = this._leadingIndent(byteStart, end);
      lines.push({ start: byteStart, end, indent });
    }

    const program = this._node(NodeKind.Program, { lines: [] });
    for (const L of lines) program.lines.push(this._parseLineWithTokens(L, toks));
    return program;
  }

  /** Line-indexing for char path */
  _indexLines() {
    const b = this.b, n = this.n;
    let i = 0, lineStart = 0;
    for (; i < n; i++) {
      if (b[i] === C.NL) {
        let end = i; if (end > lineStart && b[end - 1] === C.CR) end--;
        const indent = this._leadingIndent(lineStart, end);
        this.lines.push({ start: lineStart, end, indent });
        lineStart = i + 1;
      }
    }
    if (lineStart < n) {
      let end = n; if (end > lineStart && b[end - 1] === C.CR) end--;
      const indent = this._leadingIndent(lineStart, end);
      this.lines.push({ start: lineStart, end, indent });
    }
  }
  _leadingIndent(s, e) {
    const b = this.b; let i = s, col = 0;
    for (; i < e; i++) { const ch = b[i]; if (ch === C.SP || ch === C.TAB) col++; else break; }
    return col;
  }
  _slice(s,e){ return this.td.decode(this.b.subarray(s,e)); }
  _node(kind, fields) { const n = Object.assign({ kind }, fields); this.nodes.push(n); return n; }

  /** Token-path line parse (top-level), delgating expressions to char parser */
  _parseLineWithTokens(line, toks) {
    const { start, end, indent } = line;
    const K = TokenKind;
    const tIdx = [];
    for (let i = 0; i < toks.length; i += 3) {
      const s = toks[i + 1], e = toks[i + 2];
      if (e <= start) continue;
      if (s >= end) break;
      tIdx.push(i);
    }
    let ti = 0;
    const nextNonSpace = () => {
      while (ti < tIdx.length) {
        const k = toks[tIdx[ti]] & 0xFFFF;
        if (k === K.Space) { ti++; continue; }
        return tIdx[ti];
      }
      return -1;
    };

    const first = nextNonSpace();
    if (first === -1) return this._node(NodeKind.Line, { start, end, indent, label: null, commands: [], comment: null });
    if ((toks[first] & 0xFFFF) === K.Semi) {
      const comment = this._node(NodeKind.Comment, { start: toks[first + 1], end });
      return this._node(NodeKind.Line, { start, end, indent, label: null, commands: [], comment });
    }

    // label?
    let label = null;
    if (indent === 0 && (toks[first] & 0xFFFF) === K.Ident) {
      const nameStart = toks[first + 1], nameEnd = toks[first + 2];
      const sym = this.intern.intern(nameStart, nameEnd);
      ti++;
      let spaced = false;
      while (ti < tIdx.length && (toks[tIdx[ti]] & 0xFFFF) === K.Space) { spaced = true; ti++; }
      if (spaced) label = { start: nameStart, end: nameEnd, sym };
      else ti = 0; // not a label; let char parser handle
    }

    const commands = []; let comment = null;
    const cmdStartTI = () => {
      const idx = nextNonSpace();
      if (idx === -1) return -1;
      if ((toks[idx] & 0xFFFF) !== K.Ident) return -1;
      return idx;
    };

    while (true) {
      const cs = cmdStartTI();
      if (cs === -1) break;
      const cmdWord = this._slice(toks[cs + 1], toks[cs + 2]).toUpperCase();
      ti++;

      // postcond
      while (ti < tIdx.length && (toks[tIdx[ti]] & 0xFFFF) === K.Space) ti++;
      let postcond = null;
      if (ti < tIdx.length && (toks[tIdx[ti]] & 0xFFFF) === K.Colon) {
        const pcStart = toks[tIdx[ti] + 2];
        ti++;
        const pcEnd = this._scanExprUntilSpaceOrComment(pcStart, end);
        postcond = this._parseExprRange(pcStart, pcEnd);
        while (ti < tIdx.length && toks[tIdx[ti] + 2] <= pcEnd) ti++;
      }

      // chunk end at ';' or next command word
      let chunkEndByte = end;
      for (let k = ti; k < tIdx.length; k++) {
        const kind = toks[tIdx[k]] & 0xFFFF;
        if (kind === K.Semi) { chunkEndByte = toks[tIdx[k] + 1]; break; }
        if (kind === K.Ident) {
          const s = toks[tIdx[k] + 1], e = toks[tIdx[k] + 2];
          const w = this._slice(s, e).toUpperCase();
          if (w === "H" || w === "HAL" || w === "HALT" || w === "HANG" || CMD_MAP[w]) {
            let back = k - 1;
            while (back >= ti && (toks[tIdx[back]] & 0xFFFF) === K.Space) back--;
            chunkEndByte = back >= ti ? toks[tIdx[back] + 2] : s;
            break;
          }
        }
      }

      let canonical = CMD_MAP[cmdWord] || null;
      const ambiguousH = (cmdWord === "H" || cmdWord === "HAL" || cmdWord === "HALT" || cmdWord === "HANG");
      const argsStart = (ti < tIdx.length) ? toks[tIdx[ti] + 1] : toks[cs + 2];
      const args = this._parseArgsForCommand(cmdWord, canonical, argsStart, chunkEndByte);
      if (!canonical) canonical = ambiguousH ? (args.items.length > 0 ? CMD.HANG : CMD.HALT) : cmdWord;

      const cmdNode = this._node(NodeKind.Command, {
        cmd: canonical, cmdStart: toks[cs + 1], cmdEnd: toks[cs + 2], postcond, args
      });
      commands.push(cmdNode);

      while (ti < tIdx.length && toks[tIdx[ti] + 2] <= chunkEndByte) ti++;
      if (ti < tIdx.length && (toks[tIdx[ti]] & 0xFFFF) === K.Semi) {
        comment = this._node(NodeKind.Comment, { start: toks[tIdx[ti] + 1], end });
        break;
      }
    }
    return this._node(NodeKind.Line, { start, end, indent, label, commands, comment });
  }

  /** Char-path line parser */
  _parseLine(start, end, indent) {
    const b = this.b; let i = start;
    while (i < end && isSpace(b[i])) i++;
    if (i < end && b[i] === C.SEMI) {
      const comment = this._node(NodeKind.Comment, { start: i, end });
      return this._node(NodeKind.Line, { start, end, indent, label: null, commands: [], comment });
    }
    let label = null;
    if (indent === 0 && i < end && isAlpha(b[i])) {
      const nameStart = i; i++;
      while (i < end && isIdentPart(b[i])) i++;
      let j = i; while (j < end && isSpace(b[j])) j++;
      label = { start: nameStart, end: i, sym: this.intern.intern(nameStart, i) };
      i = j;
    }
    const commands = []; let comment = null;
    while (i < end) {
      if (b[i] === C.SEMI) { comment = this._node(NodeKind.Comment, { start: i, end }); break; }
      while (i < end && isSpace(b[i])) i++;
      if (i >= end) break;
      if (!isAlpha(b[i])) { comment = this._node(NodeKind.Comment, { start: i, end }); break; }
      const cmdStart = i; i++;
      while (i < end && isAlpha(b[i])) i++;
      const cmdWord = this._slice(cmdStart, i).toUpperCase();
      let canonical = CMD_MAP[cmdWord] || null;
      const ambiguousH = (cmdWord === "H" || cmdWord === "HAL" || cmdWord === "HALT" || cmdWord === "HANG");
      while (i < end && isSpace(b[i])) i++;
      let postcond = null;
      if (i < end && b[i] === C.COLON) {
        i++; while (i < end && isSpace(b[i])) i++;
        const pcStart = i, pcEnd = this._scanExprUntilSpaceOrComment(i, end);
        postcond = this._parseExprRange(pcStart, pcEnd);
        i = pcEnd;
      }
      const chunkEnd = this._findCommandChunkEnd(i, end);
      const args = this._parseArgsForCommand(cmdWord, canonical, i, chunkEnd);
      if (!canonical) canonical = ambiguousH ? (args.items.length > 0 ? CMD.HANG : CMD.HALT) : cmdWord;
      const cmdNode = this._node(NodeKind.Command, {
        cmd: canonical, cmdStart, cmdEnd: i, postcond, args
      });
      commands.push(cmdNode);
      i = chunkEnd; while (i < end && isSpace(b[i])) i++;
    }
    return this._node(NodeKind.Line, { start, end, indent, label, commands, comment });
  }

  _findCommandChunkEnd(i, end) {
    const b = this.b; let depth = 0, inStr = false;
    for (let p = i; p < end; p++) {
      const ch = b[p];
      if (inStr) {
        if (ch === C.QUOTE) { if (p + 1 < end && b[p + 1] === C.QUOTE) { p++; continue; } inStr = false; }
        continue;
      }
      if (ch === C.QUOTE) { inStr = true; continue; }
      if (ch === C.LP) { depth++; continue; }
      if (ch === C.RP) { if (depth > 0) depth--; continue; }
      if (depth === 0) {
        if (ch === C.SEMI) return p;
        if (isSpace(ch)) {
          let q = p; while (q < end && isSpace(b[q])) q++;
          if (q < end && isAlpha(b[q])) {
            let r = q + 1; while (r < end && isAlpha(b[r])) r++;
            const w = this._slice(q, r).toUpperCase();
            if (w === "H" || w === "HAL" || w === "HALT" || w === "HANG" || CMD_MAP[w]) return p;
          }
        }
      }
    }
    return end;
  }

  _scanExprUntilSpaceOrComment(i, end) {
    const b = this.b; let depth = 0, inStr = false;
    for (let p = i; p < end; p++) {
      const ch = b[p];
      if (inStr) { if (ch === C.QUOTE) { if (p + 1 < end && b[p + 1] === C.QUOTE) { p++; continue; } inStr = false; } continue; }
      if (ch === C.QUOTE) { inStr = true; continue; }
      if (ch === C.LP) { depth++; continue; }
      if (ch === C.RP) { if (depth > 0) depth--; continue; }
      if (depth === 0) { if (ch === C.SEMI || isSpace(ch)) return p; }
    }
    return end;
  }

  _parseArgsForCommand(cmdWord, canonical, s, e) {
    const items = []; let i = s;
    while (i < e && isSpace(this.b[i])) i++;
    if (i >= e) return this._node(NodeKind.ArgList, { items });

    const cmdUp = (canonical || cmdWord.toUpperCase());

    if (cmdUp === CMD.SET) {
      while (i < e) {
        while (i < e && isSpace(this.b[i])) i++;
        if (i >= e) break;
        const lval = this._parseLValue(i, e); i = lval._end;
        while (i < e && isSpace(this.b[i])) i++;
        if (i < e && this.b[i] === C.EQ) {
          i++; while (i < e && isSpace(this.b[i])) i++;
          const rhs = this._parseExpr(i, e, true); i = rhs._end;
          items.push(this._node(NodeKind.Assign, { left: lval, right: rhs }));
        } else {
          const expr = this._parseExpr(lval._start, i, true); i = expr._end;
          items.push(expr);
        }
        while (i < e && isSpace(this.b[i])) i++;
        if (i < e && this.b[i] === C.COMMA) { i++; continue; }
        break;
      }
      return this._node(NodeKind.ArgList, { items });
    }

    if (cmdUp === CMD.WRITE) {
      while (i < e) {
        while (i < e && isSpace(this.b[i])) i++;
        if (i >= e) break;
        const ch = this.b[i];
        if (ch === C.BANG) { items.push(this._node(NodeKind.WriteNL, { pos: i, _start: i, _end: i + 1 })); i++; }
        else if (ch === C.QMARK) { i++; while (i < e && isSpace(this.b[i])) i++; const tab = this._parseExpr(i, e, true); i = tab._end; items.push(this._node(NodeKind.WriteTab, { expr: tab })); }
        else { const expr = this._parseExpr(i, e, true); i = expr._end; items.push(expr); }
        while (i < e && isSpace(this.b[i])) i++;
        if (i < e && this.b[i] === C.COMMA) { i++; continue; }
        break;
      }
      return this._node(NodeKind.ArgList, { items });
    }

    while (i < e) {
      while (i < e && isSpace(this.b[i])) i++;
      if (i >= e) break;
      const expr = this._parseExpr(i, e, true); i = expr._end; items.push(expr);
      while (i < e && isSpace(this.b[i])) i++;
      if (i < e && this.b[i] === C.COMMA) { i++; continue; }
      break;
    }
    return this._node(NodeKind.ArgList, { items });
  }

  _parseExpr(i, e, stopAtComma) {
    let left = this._parsePrefix(i, e); i = left._end;
    while (i < e) {
      let save = i; while (i < e && isSpace(this.b[i])) i++;
      if (i >= e) break;
      if (stopAtComma && this.b[i] === C.COMMA) break;

      const op = this._readBinaryOp(i, e);
      if (!op) { i = save; break; }
      i += op.len;
      while (i < e && isSpace(this.b[i])) i++;

      if (op.kind === "?") { // pattern operator
        const pat = this._parsePattern(i, e, stopAtComma);
        i = pat._end;
        const bin = this._node(NodeKind.ExprBinary, { op: "?", left, right: pat });
        bin._start = left._start; bin._end = i;
        left.kind = bin.kind; left.op = bin.op; left.left = bin.left; left.right = bin.right;
        left._start = bin._start; left._end = bin._end;
        continue;
      }

      const rhs = this._parsePrefix(i, e);
      i = rhs._end;
      const bin = this._node(NodeKind.ExprBinary, { op: op.kind, left, right: rhs });
      bin._start = left._start; bin._end = i;

      left.kind = bin.kind; left.op = bin.op; left.left = bin.left; left.right = bin.right;
      left._start = bin._start; left._end = bin._end;
    }
    return left;
  }
  _parseExprRange(s,e){ return this._parseExpr(s,e,false); }

  /** Pattern parser (lossless, structured) */
  _parsePattern(i, e, stopAtComma) {
    const items = []; const b = this.b;
    let p = i;

    const readInt = (q) => { let r = q; while (r < e && isDigit(b[r])) r++; return (r > q) ? { ok:true, end:r, n:parseInt(this._slice(q,r),10)} : {ok:false,end:q}; };

    while (p < e) {
      while (p < e && isSpace(b[p])) p++;
      if (p >= e) break;
      if (stopAtComma && b[p] === C.COMMA) break;

      // Count: INT [ '.' INT ]
      let min=null,max=null;
      const ci = readInt(p);
      if (ci.ok) {
        min = ci.n; p = ci.end;
        if (p < e && b[p] === C.DOT) {
          p++;
          const cj = readInt(p);
          if (cj.ok) { max = cj.n; p = cj.end; } else { max = null; }
        }
      }

      while (p < e && isSpace(b[p])) p++;
      if (p >= e) break;
      if (stopAtComma && b[p] === C.COMMA) break;

      if (b[p] === C.QUOTE) {
        const strNode = this._readString(p, e);
        items.push({ type:"lit", start: strNode._start, end: strNode._end, min, max });
        p = strNode._end;
      } else if (b[p] === C.DOT) {
        items.push({ type:"class", classStart:p, classEnd:p+1, min, max });
        p++;
      } else if (isAlpha(b[p])) {
        let s0 = p; p++;
        while (p < e && isAlpha(b[p])) p++;
        items.push({ type:"class", classStart:s0, classEnd:p, min, max });
      } else {
        break;
      }
    }

    const node = this._node(NodeKind.Pattern, { items });
    node._start = i; node._end = p;
    return node;
  }

  _parsePrefix(i, e) {
    const b = this.b; let ch = b[i];
    if (ch === C.TICK) { const expr = this._parsePrefix(i+1, e); const n = this._node(NodeKind.ExprUnary, { op:"'", expr }); n._start=i; n._end=expr._end; return n; }
    if (ch === C.PLUS || ch === C.MINUS) { const expr = this._parsePrefix(i+1, e); const n = this._node(NodeKind.ExprUnary, { op:String.fromCharCode(ch), expr }); n._start=i; n._end=expr._end; return n; }
    if (ch === C.AT) { const expr = this._parsePrefix(i+1, e); const n=this._node(NodeKind.Indirect,{expr}); n._start=i; n._end=expr._end; return n; }
    if (ch === C.LP) return this._parseParenExpr(i,e);
    if (ch === C.QUOTE) return this._readString(i,e);
    if (ch === C.DOLLAR) { if (i+1<e && b[i+1]===C.DOLLAR) return this._readDblDollar(i,e); else return this._readDollar(i,e); }
    if (ch === C.CARET) return this._readGlobal(i,e);
    if (isDigit(ch) || ch === C.DOT) return this._readNumber(i,e);
    if (isIdentStart(ch)) return this._readLocalOrSubscript(i,e);
    const dummy = this._node(NodeKind.String, { start:i, end:i }); dummy._start=i; dummy._end=i; return dummy;
  }

  _parseParenExpr(i, e) {
    let p = i+1, depth=1, inStr=false;
    for (; p<e; p++) {
      const ch = this.b[p];
      if (inStr) { if (ch===C.QUOTE){ if (p+1<e && this.b[p+1]===C.QUOTE){p++;continue;} inStr=false;} continue; }
      if (ch===C.QUOTE){ inStr=true; continue; }
      if (ch===C.LP) { depth++; continue; }
      if (ch===C.RP) { depth--; if (depth===0) break; }
    }
    const inner = this._parseExpr(i+1, p, false);
    const node = this._node(NodeKind.Paren, { expr: inner });
    node._start = i; node._end = (p<e && this.b[p]===C.RP) ? p+1 : p; return node;
  }

  _readString(i,e){
    let p=i+1;
    for (; p<e; p++){
      const ch=this.b[p];
      if (ch===C.QUOTE){ if (p+1<e && this.b[p+1]===C.QUOTE){p++;continue;} p++; break; }
    }
    const node=this._node(NodeKind.String,{start:i,end:p}); node._start=i; node._end=p; return node;
  }

  _readNumber(i,e){
    let p=i, sawDot = (this.b[p]===C.DOT); if (sawDot) p++;
    while (p<e && isDigit(this.b[p])) p++;
    if (!sawDot && p<e && this.b[p]===C.DOT){ sawDot=true; p++; while (p<e && isDigit(this.b[p])) p++; }
    const node=this._node(NodeKind.Number,{start:i,end:p}); node._start=i; node._end=p; return node;
  }

  _readIdent(i,e){ let p=i+1; while (p<e && isIdentPart(this.b[p])) p++; return {start:i,end:p}; }

  _readLocalOrSubscript(i,e){
    const id=this._readIdent(i,e); let p=id.end;
    const sym = this.intern.intern(id.start, id.end);
    let base=this._node(NodeKind.Local,{ nameStart:id.start, nameEnd:id.end, sym });
    base._start=id.start; base._end=id.end;
    while (p<e && isSpace(this.b[p])) p++;
    if (p<e && this.b[p]===C.LP){
      const args=this._parseSubscripts(p,e); p=args._end;
      const sub=this._node(NodeKind.Subscript,{ target:base, args:args.items }); sub._start=base._start; sub._end=p; return sub;
    }
    return base;
  }

  _readGlobal(i,e){
    let p=i+1, name=null, sym=null;
    if (p<e && isIdentStart(this.b[p])){ const id=this._readIdent(p,e); name=id; sym=this.intern.intern(id.start,id.end); p=id.end; }
    while (p<e && isSpace(this.b[p])) p++;
    let node=this._node(NodeKind.Global,{ name, sym, start:i, end:i });
    if (p<e && this.b[p]===C.LP){
      const subs=this._parseSubscripts(p,e); node=this._node(NodeKind.Global,{name,sym,subs:subs.items,start:i,end:subs._end}); node._start=i; node._end=subs._end; return node;
    }
    node._start=i; node._end=p; return node;
  }

  _parseSubscripts(i,e){
    let p=i+1, items=[], depth=1, inStr=false, start=p;
    const flush=(s,t)=>{ if (s<t) items.push(this._parseExpr(s,t,false)); };
    for (; p<e; p++){
      const ch=this.b[p];
      if (inStr){ if (ch===C.QUOTE){ if (p+1<e && this.b[p+1]===C.QUOTE){p++;continue;} inStr=false;} continue; }
      if (ch===C.QUOTE){ inStr=true; continue; }
      if (ch===C.LP){ depth++; continue; }
      if (ch===C.RP){ depth--; if (depth===0){ flush(start,p); p++; break; } continue; }
      if (depth===1 && ch===C.COMMA){ flush(start,p); start=p+1; }
    }
    const node=this._node(NodeKind.ArgList,{ items }); node._start=i; node._end=p; return node;
  }

  _readDollar(i,e){
    let p=i+1; if (!(p<e && isAlpha(this.b[p]))){ const s=this._node(NodeKind.String,{start:i,end:i+1}); s._start=i; s._end=i+1; return s; }
    const id=this._readIdent(p,e); p=id.end; while (p<e && isSpace(this.b[p])) p++;
    let args=null; if (p<e && this.b[p]===C.LP){ args=this._parseSubscripts(p,e); p=args._end; }
    const node=this._node(NodeKind.Dollar,{ nameStart:id.start, nameEnd:id.end, sym:this.intern.intern(id.start,id.end), args: args?args.items:null });
    node._start=i; node._end=p; return node;
  }

  _readDblDollar(i,e){
    let p=i+2; if (!(p<e && isAlpha(this.b[p]))){ const s=this._node(NodeKind.String,{start:i,end:i+2}); s._start=i; s._end=i+2; return s; }
    const lab=this._readIdent(p,e); p=lab.end; let caret=null;
    if (p<e && this.b[p]===C.CARET){ p++; if (p<e && isAlpha(this.b[p])){ const rt=this._readIdent(p,e); caret=rt; p=rt.end; } }
    while (p<e && isSpace(this.b[p])) p++;
    let args=null; if (p<e && this.b[p]===C.LP){ args=this._parseSubscripts(p,e); p=args._end; }
    const node=this._node(NodeKind.DblDollar,{ label:lab, routine:caret, args: args?args.items:null });
    node._start=i; node._end=p; return node;
  }

  _parseLValue(i,e){
    const ch=this.b[i];
    if (ch===C.CARET) return this._readGlobal(i,e);
    if (isIdentStart(ch)) return this._readLocalOrSubscript(i,e);
    if (ch===C.AT){ const tgt=this._parsePrefix(i+1,e); const n=this._node(NodeKind.Indirect,{expr:tgt}); n._start=i; n._end=tgt._end; return n; }
    return this._parsePrefix(i,e);
  }

  _readBinaryOp(i,e){
    const b=this.b, a=b[i], a2=i+1<e?b[i+1]:0;
    if (a===C.STAR && a2===C.STAR) return {kind:"**",len:2};
    if (a===C.LT && a2===C.EQ) return {kind:"<=",len:2};
    if (a===C.GT && a2===C.EQ) return {kind:">=",len:2};
    if (a===C.TICK && (a2===C.EQ || a2===C.LT || a2===C.GT || a2===C.LBR || a2===C.RBR || a2===C.QMARK)) return {kind:"'"+String.fromCharCode(a2),len:2};
    if (a===C.RBR && a2===C.RBR) return {kind:"]]",len:2};
    switch (a){
      case C.STAR: return {kind:"*",len:1};
      case C.SLASH: return {kind:"/",len:1};
      case C.BSLASH: return {kind:"\\",len:1};
      case C.HASH: return {kind:"#",len:1};
      case C.PLUS: return {kind:"+",len:1};
      case C.MINUS: return {kind:"-",len:1};
      case C.UND: return {kind:"_",len:1};
      case C.AMP: return {kind:"&",len:1};
      case C.BANG: return {kind:"!",len:1};
      case C.LT: return {kind:"<",len:1};
      case C.GT: return {kind:">",len:1};
      case C.EQ: return {kind:"=",len:1};
      case C.LBR: return {kind:"[",len:1};
      case C.RBR: return {kind:"]",len:1};
      case C.QMARK: return {kind:"?",len:1};
    }
    return null;
  }
}

/** Formatter ***************************************************************
 * Options:
 *  - abbreviateCommands?: boolean
 *  - uppercaseCommands?: boolean (default true)
 *  - commentColumn?: number
 *  - alignSetEquals?: boolean
 *  - betweenCommands?: string (default "  ")
 *  - spaceAfterCommand?: string (default " ")
 *  - tight?: boolean (compat)
 */
export function formatMumps(ast, opts = {}) {
  const { buffer, program } = ast;
  const td = new TextDecoder();
  const sl = (s, e) => td.decode(buffer.subarray(s, e));

  const betweenCmds = opts.betweenCommands ?? "  ";
  const afterCmd = opts.spaceAfterCommand ?? " ";
  const upper = opts.uppercaseCommands !== false;
  const abbr = !!opts.abbreviateCommands;
  const commentCol = typeof opts.commentColumn === "number" ? Math.max(1, opts.commentColumn|0) : null;
  const alignSet = !!opts.alignSetEquals;

  let out = "";
  for (const line of program.lines) {
    let currentCol = 0;

    // label
    if (line.label) {
      const lab = sl(line.label.start, line.label.end);
      out += lab;
      currentCol += lab.length;
      if (line.commands.length) {
        out += betweenCmds; currentCol += betweenCmds.length;
      }
    }

    // compute alignment for SET equals (per line)
    let setEqCol = 0;
    if (alignSet) {
      for (const c of line.commands) {
        if (c.cmd === "SET" || c.cmd === "S") {
          for (const it of c.args?.items ?? []) {
            if (it.kind === NodeKind.Assign) {
              const leftTxt = sl(it.left._start, it.left._end);
              setEqCol = Math.max(setEqCol, currentCol + c.cmd.length + afterCmd.length + leftTxt.length);
            }
          }
        }
      }
      if (setEqCol) setEqCol += 1; // space before '='
    }

    // commands
    for (let i = 0; i < line.commands.length; i++) {
      const c = line.commands[i];
      let cname = c.cmd;
      if (abbr && CMD_ABBR[cname]) cname = CMD_ABBR[cname];
      if (upper) cname = cname.toUpperCase();

      out += cname; currentCol += cname.length;

      if (c.postcond) {
        const txt = ":" + sl(c.postcond._start, c.postcond._end);
        out += txt; currentCol += txt.length;
      }

      if (c.args && c.args.items.length) {
        out += afterCmd; currentCol += afterCmd.length;

        const pieces = [];
        for (const arg of c.args.items) {
          if ((cname === "S" || c.cmd === "SET") && alignSet && arg.kind === NodeKind.Assign) {
            const leftTxt = sl(arg.left._start, arg.left._end);
            const beforeEqCols = currentCol + leftTxt.length;
            const pad = setEqCol > 0 ? Math.max(0, setEqCol - beforeEqCols) : 0;
            pieces.push(leftTxt + " ".repeat(pad) + "=" + sl(arg.right._start, arg.right._end));
            continue;
          }
          switch (arg.kind) {
            case NodeKind.WriteNL: pieces.push("!"); break;
            case NodeKind.WriteTab: pieces.push("?" + sl(arg.expr._start, arg.expr._end)); break;
            case NodeKind.Pattern: pieces.push(sl(arg._start, arg._end)); break;
            case NodeKind.Assign:
              pieces.push(sl(arg.left._start, arg.left._end) + "=" + sl(arg.right._start, arg.right._end));
              break;
            default:
              pieces.push(sl(arg._start, arg._end));
          }
        }
        const joined = pieces.join(",");
        out += joined; currentCol += joined.length;
      }

      if (i + 1 < line.commands.length) {
        out += betweenCmds; currentCol += betweenCmds.length;
      }
    }

    // trailing comment
    if (line.comment) {
      const commentText = sl(line.comment.start, line.comment.end);
      if (commentCol !== null) {
        if (currentCol + 1 < commentCol) {
          out += " ".repeat(commentCol - currentCol - 1);
        } else {
          out += " ";
        }
      } else {
        out += " ";
      }
      out += commentText;
    }

    out += "\n";
  }
  return out;
}
