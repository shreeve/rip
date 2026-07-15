import { describe, expect, test } from 'bun:test';

import hljs from 'highlight.js/lib/core';
import rip from '../hljs-rip.js';

hljs.registerLanguage('rip', rip);

const FIXTURE = `def greet(name)
  tags = %w[alpha beta gamma]
  kind = :friendly
  "hello, #{name}!"
`;

describe('hljs-rip', () => {
  test('registers and highlights Rip', () => {
    const { value } = hljs.highlight(FIXTURE, { language: 'rip' });

    expect(value).toContain('<span class="hljs-keyword">def</span>');
    expect(value).toContain('<span class="hljs-title function_">greet</span>');
    expect(value).toContain('<span class="hljs-string">%w[alpha beta gamma]</span>');
    expect(value).toContain('<span class="hljs-symbol">:friendly</span>');
    expect(value).toContain('<span class="hljs-subst">'); // #{name}
  });
});
