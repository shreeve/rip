import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { scratchTree, serve } from './helpers.js';

// The served-page contract, pinned by running the v3 implementation
// as the oracle: every expected value below was observed from v3
// (timestamps aside), and the port's output diffed byte-identical to
// v3 across all of these modes.

describe('source view', () => {
  test('two files: TOC, headers, nav, highlighting, light theme', async () => {
    const { html, headers, stdout, exitCode } = await serve(['hello.rip', 'util.js']);
    expect(exitCode).toBe(0);

    // Console progress report
    expect(stdout).toContain('2 files\n');
    expect(stdout).toContain('  hello.rip (8 lines) [rip]\n');
    expect(stdout).toContain('  util.js (2 lines) [javascript]\n');
    expect(stdout).toContain('Opening browser...');

    // Serving posture
    expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(headers.get('cache-control')).toBe('no-store');

    // Page chrome
    expect(html).toContain('<title>Printed on ');
    expect(html).toContain('<div class="toc">');
    expect(html).toContain('<h2>Files (2)</h2>');
    expect(html).toContain('<li><a href="#hello.rip">hello.rip</a> <span class="meta">(8 lines)</span></li>');
    expect(html).toContain('<div class="file-header" id="hello.rip">');
    expect(html).toMatch(/<span>hello\.rip <span class="meta">\(8 lines\) \[rip\] on /);
    expect(html).toContain('<span class="nav"><a href="#util.js">prev</a> <a href="#util.js">next</a> <a href="#top">&uarr; top</a></span>');

    // Line numbers and highlighting
    expect(html).toContain('<span class="line-num first">   1</span>');
    expect(html).toContain('<span class="hljs-keyword">def</span>');
    expect(html).toContain('<span class="hljs-title function_">greet</span>');

    // Light theme defaults with the full switcher inventory
    expect(html).toContain(":root { --bg: #ffffff; --fg: #1f2328; --hdr: #f6f8fa; --brd: #d0d7de; --gut: #f4f4f4; --act: #e0e0e0; }");
    expect(html).toContain('value="github" data-dark="false" selected');
    expect(html.match(/<option value="/g)).toHaveLength(14);
    expect(html).toContain('<optgroup label="Light">');
    expect(html).toContain('<optgroup label="Dark">');
    expect(html).toContain("localStorage.getItem('rip-print-theme')");
    expect(html).toContain("localStorage.getItem('rip-print-size')");
  });

  test('a single file gets no TOC and a top-only nav', async () => {
    const { html, stdout } = await serve(['hello.rip']);
    expect(stdout).toContain('1 file\n');
    expect(html).not.toContain('<div class="toc">');
    expect(html).toContain('<span class="nav"><a href="#top">&uarr; top</a></span>');
  });

  test('-d selects the dark palette and theme', async () => {
    const { html } = await serve(['-d', 'hello.rip']);
    expect(html).toContain(":root { --bg: #0d1117; --fg: #e6edf3; --hdr: #161b22; --brd: #30363d; --gut: #161b22; --act: #30363d; }");
    expect(html).toContain('value="github-dark" data-dark="true" selected');
  });

  test('-b strips the leading comment block and blank lines', async () => {
    const { html, stdout } = await serve(['-b', 'hello.rip']);
    expect(stdout).toContain('  hello.rip (5 lines) [rip]\n');
    expect(html).not.toContain('Top comment block');
    expect(html).toMatch(/line-num first">   1<\/span>  <span class="hljs-function"><span class="hljs-keyword">def<\/span>/);
  });

  test('tabs become two spaces and CRLF normalizes to LF', async () => {
    const { dir, write } = scratchTree();
    write('tabs.py', 'a\tb\r\nc\n');
    const { html, stdout } = await serve(['tabs.py'], dir);
    // Singular "1 lines"-style wart family: the per-file line always
    // says "lines"; "a\tb\r\nc\n" counts as 3 (trailing newline).
    expect(stdout).toContain('  tabs.py (3 lines) [python]\n');
    expect(html).toContain('a  b');
    expect(html).not.toContain('\t');
  });

  test('multiple files including .md stay in source view', async () => {
    const { html, stdout } = await serve(['.']);
    expect(stdout).toContain('4 files\n');
    expect(stdout).not.toContain('rendering as markdown');
    expect(stdout).toContain('  notes.md (7 lines) [markdown]\n');
    expect(html).toContain('<h2>Files (4)</h2>');
  });

  test('<script type="text/rip"> in HTML is re-highlighted as Rip', async () => {
    const { html, stdout } = await serve(['page.html']);
    expect(stdout).toContain('  page.html (9 lines) [html]\n');
    expect(html).toContain('&quot;text/rip&quot;');
    expect(html).toContain('class="language-rip"');
  });
});

describe('file discovery', () => {
  test('walks directories; skips dotfiles, skip-dirs, and binary extensions', async () => {
    const { dir, write } = scratchTree();
    write('src/keep.rb');
    write('src/Makefile');
    write('src/Dockerfile');
    write('src/skip.png');
    write('src/skip.lock');
    write('src/.dotfile');
    write('src/node_modules/nope.js');
    write('src/dist/nope.js');
    write('src/.hidden/nope.js');
    const { stdout, exitCode } = await serve(['src'], dir);
    expect(exitCode).toBe(0);
    // Sorted walk; filename-based language detection; the "(1 lines)"
    // singular is a pinned v3 wart.
    expect(stdout).toContain('3 files\n');
    expect(stdout).toContain('  src/Dockerfile (1 lines) [dockerfile]\n');
    expect(stdout).toContain('  src/Makefile (1 lines) [makefile]\n');
    expect(stdout).toContain('  src/keep.rb (1 lines) [ruby]\n');
    expect(stdout).not.toContain('skip.');
    expect(stdout).not.toContain('nope.js');
    expect(stdout).not.toContain('.dotfile');
  });

  test('-x adds extensions to the exclusion set', async () => {
    const { stdout } = await serve(['-x', 'js,html', '.']);
    expect(stdout).toContain('2 files\n');
    expect(stdout).toContain('  hello.rip (8 lines) [rip]\n');
    expect(stdout).toContain('  notes.md (7 lines) [markdown]\n');
    expect(stdout).not.toContain('util.js');
    expect(stdout).not.toContain('page.html');
  });

  test('unknown extensions fall back to plaintext', async () => {
    const { dir, write } = scratchTree();
    write('data.xyzzy', 'plain text\n');
    const { stdout } = await serve(['data.xyzzy'], dir);
    expect(stdout).toContain('  data.xyzzy (2 lines) [plaintext]\n');
  });
});

describe('single-markdown mode', () => {
  test('renders the document instead of its source', async () => {
    const { html, stdout } = await serve(['notes.md']);
    expect(stdout).toContain('  notes.md (rendering as markdown)\n');
    expect(stdout).toContain('  notes.md (7 lines) [markdown]\n');
    expect(html).toContain('<title>notes.md</title>');
    expect(html).toContain('<body><h1>Title</h1>');
    expect(html).toContain('<p>Some <em>markdown</em> with <code>code</code>.</p>');
    expect(html).not.toContain('line-num');
    // Light root variables plus the dark media query
    expect(html).toContain(':root { --bg: #fff;');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
  });

  test('-d force-darkens the document and drops the media query', async () => {
    const { html } = await serve(['-d', 'notes.md']);
    expect(html).toContain(':root { --bg: #0a0a0c;');
    expect(html).not.toContain('@media (prefers-color-scheme: dark)');
  });
});

describe('shared Rip grammar (@rip-lang/highlight)', () => {
  // print consumes the repository's shared hljs-rip grammar from
  // packages/highlight rather than v3's embedded (older) copy. These
  // two behaviors exist only in the shared grammar — the declared
  // divergence from v3, where %w[] and :symbols went unhighlighted.
  test('word arrays and symbol literals highlight', async () => {
    const { dir, write } = scratchTree();
    write('gram.rip', 'tags = %w[alpha beta]\nkind = :friendly\n');
    const { html } = await serve(['gram.rip'], dir);
    expect(html).toContain('<span class="hljs-string">%w[alpha beta]</span>');
    expect(html).toContain('<span class="hljs-symbol">:friendly</span>');
  });
});
