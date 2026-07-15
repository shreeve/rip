export type Validator = (v: any) => unknown;

export function isBlank(obj: unknown): boolean;

export function toName(str: unknown, ...type: string[]): string;

export function toPhone(str: unknown): string | null;

export function formatMoney(
  cents?: number | null,
  opts?: { symbol?: string; commas?: boolean },
): string;

export function registerValidator(
  name: string,
  fn: Validator,
  opts?: { raw?: boolean },
): Validator;

export function getValidator(name: string): Validator | undefined;

export function isRawType(name: string): boolean;

export function validatorNames(): string[];

export function check(value: unknown, type: string): unknown;
