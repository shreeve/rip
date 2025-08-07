#!/usr/bin/env bun

/**
 * Global Rip Transpiler Plugin
 * 
 * This file registers the Rip transpiler plugin globally for the entire monorepo.
 * Only needs to be preloaded once in the root bunfig.toml.
 */

import { compile } from '../../coffeescript/lib/coffeescript'

// Register the Rip transpiler plugin globally
Bun.plugin({
  name: 'rip-bun-global',
  setup({ onLoad }) {
    onLoad({ filter: /\.rip$/ }, async ({ path }) => ({
      loader: 'js',
      contents: compile(await Bun.file(path).text(), {
        bare: true,
        header: true,
        filename: path,
        inlineMap: true,
      }),
    }))
  },
})

console.log("🎯 Rip transpiler registered globally");
