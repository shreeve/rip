import type { LanguageFn } from 'highlight.js';

// The Rip grammar for highlight.js: register it with
// `hljs.registerLanguage('rip', ripLanguage)`.
declare const ripLanguage: LanguageFn;
export default ripLanguage;
