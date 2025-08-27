// Minimal BUMPS lexer (ESM)
// Provides Jison-style interface: setInput(input, yy), lex(), showPosition()

export class BumpsLexer {
  constructor() {
    this.yy = {};
    this.tokens = [];
    this.cursor = 0;
  }
  setInput(input, yy) {
    this.yy = yy || {};
    this.tokens = this.tokenize(String(input || ''));
    this.cursor = 0;
    return this;
  }
  lex() {
    if (this.cursor >= this.tokens.length) return 1; // $end
    const [tag, value, loc] = this.tokens[this.cursor++];
    this.yytext = value;
    this.yyleng = value != null ? String(value).length : 0;
    this.yylloc = loc || {};
    this.yylineno = this.yylloc.first_line || 0;
    return tag;
  }
  showPosition() { return ''; }

  tokenize(src) {
    const out = [];
    const lines = src.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      let line = lines[li];
      let pos = 0;
      let afterCommand = false;
      // DOTS at start
      const mDots = line.match(/^\.+/);
      if (mDots) {
        const dots = mDots[0];
        out.push(['DOTS', dots, this.loc(li, pos, li, pos + dots.length)]);
        pos += dots.length;
        line = line.slice(dots.length);
        // Trim spaces after dot-indentation before reading command
        const mwsAfterDots = line.match(/^[ \t]+/);
        if (mwsAfterDots) {
          pos += mwsAfterDots[0].length;
          line = line.slice(mwsAfterDots[0].length);
        }
      }
      // LABEL or COMMAND at start
      let m = line.match(/^[A-Za-z%][A-Za-z0-9]*/);
      if (m) {
        const word = m[0];
        const cmd = this.commandToken(word);
        if (cmd) {
          out.push([cmd, word, this.loc(li, pos, li, pos + word.length)]);
          afterCommand = true;
        } else {
          out.push(['LABEL', word, this.loc(li, pos, li, pos + word.length)]);
        }
        pos += word.length;
        line = line.slice(word.length);
      }
      // optional spacing after command
      let mws = line.match(/^[ \t]+/);
      if (mws && afterCommand) {
        const ws = mws[0];
        out.push(['CS', ws, this.loc(li, pos, li, pos + ws.length)]);
        pos += ws.length;
        line = line.slice(ws.length);
      }
      // Arguments / rest of line
      while (line && line.length > 0) {
        let mm;
        if ((mm = line.match(/^\(/))) {
          out.push(['LPAREN', '(', this.loc(li, pos, li, pos + 1)]);
          pos += 1; line = line.slice(1); continue;
        }
        if ((mm = line.match(/^\)/))) {
          out.push(['RPAREN', ')', this.loc(li, pos, li, pos + 1)]);
          pos += 1; line = line.slice(1); continue;
        }
        if ((mm = line.match(/^:/))) {
          out.push(['COLON', ':', this.loc(li, pos, li, pos + 1)]);
          pos += 1; line = line.slice(1); continue;
        }
        if ((mm = line.match(/^"(?:[^"\\]|\\.)*"/))) {
          const s = mm[0];
          out.push(['STRING', s, this.loc(li, pos, li, pos + s.length)]);
          pos += s.length; line = line.slice(s.length); continue;
        }
        if ((mm = line.match(/^[0-9]+(?:\.[0-9]+)?/))) {
          const n = mm[0];
          out.push(['NUMBER', n, this.loc(li, pos, li, pos + n.length)]);
          pos += n.length; line = line.slice(n.length); continue;
        }
        if ((mm = line.match(/^,/))) {
          out.push(['COMMA', ',', this.loc(li, pos, li, pos + 1)]);
          pos += 1; line = line.slice(1); continue;
        }
        if ((mm = line.match(/^=/))) {
          out.push(['EQ', '=', this.loc(li, pos, li, pos + 1)]);
          pos += 1; line = line.slice(1); continue;
        }
        if ((mm = line.match(/^\^/))) {
          out.push(['CARET', '^', this.loc(li, pos, li, pos + 1)]);
          pos += 1; line = line.slice(1); continue;
        }
        if ((mm = line.match(/^@/))) {
          out.push(['AT', '@', this.loc(li, pos, li, pos + 1)]);
          pos += 1; line = line.slice(1); continue;
        }
        if ((mm = line.match(/^[A-Za-z%][A-Za-z0-9]*/))) {
          const name = mm[0];
          out.push(['NAME', name, this.loc(li, pos, li, pos + name.length)]);
          pos += name.length; line = line.slice(name.length); continue;
        }
        if ((mm = line.match(/^[ \t]+/))) {
          pos += mm[0].length; line = line.slice(mm[0].length); continue;
        }
        // Fallback: consume one char to avoid infinite loop
        out.push(['UNKNOWN', line[0], this.loc(li, pos, li, pos + 1)]);
        pos += 1; line = line.slice(1);
      }
      out.push(['NEWLINE', '\n', this.loc(li, pos, li, pos)]);
    }
    return out;
  }

  commandToken(word) {
    const w = word.toLowerCase();
    if (w === 'set' || w === 's') return 'SET';
    if (w === 'write' || w === 'w') return 'WRITE';
    if (w === 'read' || w === 'r') return 'READ';
    if (w === 'do' || w === 'd') return 'DO';
    if (w === 'kill' || w === 'k') return 'KILL';
    if (w === 'new' || w === 'n') return 'NEW';
    if (w === 'if' || w === 'i') return 'IF';
    if (w === 'else' || w === 'e') return 'ELSE';
    if (w === 'lock' || w === 'l') return 'LOCK';
    if (w === 'merge' || w === 'm') return 'MERGE';
    return null;
  }

  loc(fl, fc, ll, lc) {
    return { first_line: fl, first_column: fc, last_line: ll, last_column: lc, range: [0, 0] };
  }
}
