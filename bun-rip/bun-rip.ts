/// <reference types="bun-types" />

import rip from "../coffeescript/lib/coffeescript";

Bun.plugin({
  name: "bun-rip",
  setup({ onLoad }) {
    onLoad({ filter: /\.rip$/ }, async ({ path }) => ({
      loader: "js",
      contents: rip.compile(await Bun.file(path).text(), {
        filename: path,
        bare: true,
        header: true,
        inlineMap: true,
      }),
    }));
  },
});
