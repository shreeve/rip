// The `.rip` files in a directory — the one place that decides what
// counts as one. The compiler corpus (test/corpus) and the language
// fixtures (test/rip) both read through it, so it names neither.
//
// Tools write sidecars beside the sources they serve — the editor host's
// `.rip/` cache among them — and a DIRECTORY whose name ends in `.rip`
// satisfies a name test while satisfying nothing else: every reader then
// throws EISDIR, and the whole corpus suite fails at once for a reason
// that has nothing to do with the compiler. A directory is never a
// file, so it is excluded here rather than at each caller, where the
// fifteenth one would reintroduce it.
//
// Directories only. A symlink to a real source is still a source.

import { readdirSync } from 'fs';

export function ripFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.rip'))
    .map((entry) => entry.name)
    .sort();
}
