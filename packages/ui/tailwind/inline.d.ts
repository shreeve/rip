import type { TailwindConfig } from './engine.js';

export interface InlineEmailResult {
  unsupported: string[];
  headCss: string;
}

export function inlineEmailTree(root: any, config?: TailwindConfig): InlineEmailResult;
export function registerEmailTailwindRoot(component: any, config?: TailwindConfig): void;
export function takeEmailTailwindRoots(): Array<{ root: any; config: TailwindConfig }>;
