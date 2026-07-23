// 29-modules-hub.ts — the re-export hub: the lib resold whole — its named
// surface through the star form, its default kept as this module's default

export * from './29-modules-lib'
export { default } from './29-modules-lib'

console.log('hub open')
