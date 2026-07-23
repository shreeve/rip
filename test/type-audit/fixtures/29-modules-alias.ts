// 29-modules-alias.ts — the aliased default: a local binding promoted to the
// module's default export through the specifier list, never `export default`

let palette = { accent: 'teal', tone: 'calm' }

export { palette as default }

console.log('alias set:', palette.accent)
