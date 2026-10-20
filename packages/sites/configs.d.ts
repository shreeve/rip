// rip/sites/configs is generated when a site is served (generate.rip for a
// bundled worker, the loader's virtual module in-process): every
// sites/<name>/config.rip's default export, keyed by directory name. The
// generator knows no tenant's fields, so each value is a record of unknowns;
// a consumer narrows or parses what it reads.
declare const configs: Record<string, Record<string, unknown>>
export default configs
