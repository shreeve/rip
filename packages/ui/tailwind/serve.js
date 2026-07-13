import { compile } from './engine.js';

export function generateBrowserCss(classes = [], config = {}) {
  return compile(classes, config).css;
}
