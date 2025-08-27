function parsePattern(input) {
  const s = String(input || '');
  let i = 0;
  function eof() { return i >= s.length; }
  function peek() { return s[i]; }
  function next() { return s[i++]; }
  function isDigit(ch) { return ch >= '0' && ch <= '9'; }
  function readNumber() { let start = i; while (!eof() && isDigit(peek())) i++; return Number(s.slice(start, i)); }
  function readString() { let v=''; next(); while(!eof()){ const ch=next(); if(ch==='"') break; if(ch==='\\'&&!eof()) v+=next(); else v+=ch;} return v; }
  function parseCount(){ if(!isDigit(peek())) return null; const min=readNumber(); if(peek()==='.') { next(); const max=readNumber(); return {min,max}; } return {min,max:min}; }
  function applyCount(node,count){ if(!count) return node; return {...node, min:count.min, max:count.max}; }
  function parseAtom(){
    const count = parseCount();
    if (eof()) return null;
    const ch = peek();
    if (ch==='"') { const str=readString(); return applyCount({type:'String',value:str},count); }
    if (ch==='(') { next(); const items=[]; while(!eof() && peek()!==')'){ if(peek()===','){ next(); continue; } const a=parseAtom(); if(a) items.push(a); else break; } if(peek()===')') next(); return applyCount({type:'Group',items},count); }
    if (/^[A-Za-z]$/.test(ch)) {
      // Read a contiguous class set like AN, AL, NU, etc.
      let names = '';
      while(!eof() && /^[A-Za-z]$/.test(peek())) names += next();
      names = names.toUpperCase();
      if (names.length === 1) return applyCount({type:'Class', name: names}, count);
      return applyCount({type:'ClassSet', names: names.split('')}, count);
    }
    next(); return applyCount({type:'Char',value:ch},count); }
  function parseSeq(){ const items=[]; while(!eof()){ const a=parseAtom(); if(a) items.push(a); else break; } return {type:'PatternSeq', items}; }
  return parseSeq(); }

module.exports = { parsePattern };
