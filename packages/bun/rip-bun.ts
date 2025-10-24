#!/usr/bin/env bun

/**
 * Rip Transpiler Plugin for Bun
 *
 * Transpiles .rip files to JavaScript using the Bun plugin system.
 *
 * Usage:
 *   // In bunfig.toml:
 *   preload = ["rip/bun"]
 *
 *   // Then just import .rip files:
 *   import { myFunc } from "./app.rip"
 */

/// <reference types="bun-types" />

import { compile } from '../rip/lib/rip/index.js'

Bun.plugin({
  name: 'rip-bun',
  setup({ onLoad }) {
    onLoad({ filter: /\.rip(\?.*)?$/ }, async ({ path }) => ({
      loader: 'js',
      contents: compile(await Bun.file(path.split('?')[0]).text(), {
        bare: true,
        header: true,
        filename: path.split('?')[0],
        inlineMap: true,
      }),
    }))
  },
})
