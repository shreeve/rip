// Sits directly in src/ so './runtime/' means the same directory unbundled and
// inside dist/@rip/rip.js, where every module's import.meta.url is the bundle's.
export const RUNTIME_DIR = new URL('./runtime/', import.meta.url);
