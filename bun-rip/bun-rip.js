import rip from '../../coffeescript/lib/coffeescript';

Bun.plugin({
  name: "bun-rip",
  setup(file) {
    file.onLoad({ filter: /\.rip$/ }, async (args) => {
      const src = await Bun.file(args.path).text();
      const js = rip.compile(src, {
        filename: args.path,
        header: true,
        bare: true,
        inlineMap: true,
      });
      return {
        contents: js,
        loader: "js",
      };
    });
  }
});
