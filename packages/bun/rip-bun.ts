#!/usr/bin/env bun

/**
 * Rip Transpiler Plugin
 *
 * Transpiles .rip files to JavaScript using the Bun plugin system.
 * This plugin is preloaded globally via bunfig.toml for the entire monorepo.
 */

/// <reference types="bun-types" />

import { compile } from '../../coffeescript/lib/coffeescript'

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
