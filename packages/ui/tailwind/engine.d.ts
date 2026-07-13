export type TailwindConfig = Record<string, unknown>;

export interface TailwindCompilation {
  css: string;
  styleSheet: unknown;
}

export function configCacheKey(config?: TailwindConfig): string;
export function prepareConfig(config?: TailwindConfig): Promise<unknown>;
export function compile(classes?: string[], config?: TailwindConfig): TailwindCompilation;
