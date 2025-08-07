#!/usr/bin/env bun

/**
 * Rip Transpiler Plugin
 *
 * Transpiles .rip files (based on CoffeeScript) to JavaScript using the Bun plugin system.
 * This plugin is preloaded globally via bunfig.toml for the entire monorepo.
 */

/// <reference types="bun-types" />

import { compile } from '../../coffeescript/lib/coffeescript'

// Register the Rip transpiler plugin
Bun.plugin({
  name: 'rip-bun',
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
