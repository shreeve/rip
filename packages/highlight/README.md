# Rip highlight.js grammar

`hljs-rip.js` registers the Rip language with highlight.js (Rip Print
consumes this grammar):

```js
import hljs from 'highlight.js/lib/core';
import rip from './hljs-rip.js';
hljs.registerLanguage('rip', rip);
```

Covers keywords, strings and heredocs with interpolation, regexes and
heregexes, word arrays (`%w[…]`), numbers, operators (reactive,
prototype `::`, method `.=` / merge `*>` / existence `?=`
assignment), schema and component constructs, and comments.
