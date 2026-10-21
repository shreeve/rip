// Generated from RUNTIME_TABLE in src/emitter.js by `bun run decls`; change the table and regenerate.
type __RipSchemaIssue = { field: string; error: string; message: string };
type __RipSchemaError = Error & { issues: __RipSchemaIssue[]; schemaName: string | null; schemaKind: string | null };
export declare const __schema: (descriptor: unknown) => unknown;
export declare const SchemaError: { new (issues: __RipSchemaIssue[], schemaName?: string | null, schemaKind?: string | null): __RipSchemaError; prototype: __RipSchemaError };
export declare const SchemaRegistry: any;
export declare const registerCoercer: { <F extends (value: string) => unknown>(name: string, fn: F, options?: { raw?: false }): F; <F extends (value: unknown) => unknown>(name: string, fn: F, options: { raw: boolean }): F };
export declare const SchemaDef: any;
export declare const installPersistence: any;
