// Workspace export index for cold `.rip` → `.rip` auto-import.
//
// tsgo's program is the open-buffer mirror closure — unimported workspace
// files never join it, so native auto-import cannot see them. This index
// walks the workspace (paths only; no compile), regex-scans exports, and
// augments completions with Rip-native import edits — the same split v3
// used (AutoImportProvider beside a small LanguageService program).
//
// Port of rip-lang 3.17.5 packages/vscode/src/lsp.js export-index surface.

import fs from 'node:fs';
import path from 'node:path';

const INDEX_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.cache', '.next', 'out',
  'coverage', '.turbo', '.parcel-cache', '.bun', 'tmp', 'temp', '.rip',
]);

export function scanExports(source) {
  const names = new Set();
  const lines = source.split('\n');
  for (const raw of lines) {
    // Strip trailing `#` comments, but ignore `#` inside string literals.
    let line = raw;
    let inS = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inS) {
        if (ch === '\\') { i++; continue; }
        if (ch === inS) inS = null;
      } else if (ch === '"' || ch === "'") {
        inS = ch;
      } else if (ch === '#') {
        line = line.slice(0, i);
        break;
      }
    }
    let m;
    if ((m = /^\s*export\s+def\s+([A-Za-z_$][\w$]*)!?/.exec(line))) names.add(m[1]);
    else if ((m = /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/.exec(line))) names.add(m[1]);
    else if ((m = /^\s*export\s+(?:abstract\s+)?(?:async\s+)?(?:function|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/.exec(line))) names.add(m[1]);
    else if ((m = /^\s*export\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/.exec(line))) names.add(m[1]);
    else if ((m = /^\s*export\s*\{([^}]+)\}/.exec(line))) {
      for (const part of m[1].split(',')) {
        const id = part.trim().split(/\s+as\s+/i).pop();
        if (id && /^[A-Za-z_$][\w$]*$/.test(id)) names.add(id);
      }
    }
  }
  return names;
}

export function collectImportedNames(source) {
  const names = new Set();
  const re = /^\s*import\s+(?:(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([\s\S]*?)\}|([A-Za-z_$][\w$]*))\s+from\s+['"][^'"]+['"]/gm;
  let m;
  while ((m = re.exec(source))) {
    if (m[1]) names.add(m[1]);
    if (m[3]) names.add(m[3]);
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const id = part.trim().split(/\s+as\s+/i).pop();
        if (id && /^[A-Za-z_$][\w$]*$/.test(id)) names.add(id);
      }
    }
  }
  return names;
}

export function relativeRipSpecifier(fromFp, toFp) {
  let spec = path.relative(path.dirname(fromFp), toFp);
  if (!spec.startsWith('.') && !path.isAbsolute(spec)) spec = './' + spec;
  return spec.split(path.sep).join('/');
}

export function pkgNameFromSpec(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Build an LSP TextEdit that adds `name` to an import from `spec` in Rip
// source coordinates (not the face). Insertions respect shebang / leading
// `#` file-header / existing import block — same placement rules as v3.
export function buildImportEdit(source, spec, name) {
  const re = /^([ \t]*)import\s+(?:(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([\s\S]*?)\}|([A-Za-z_$][\w$]*))\s+from\s+(['"])([^'"]+)\5[ \t]*$/gm;
  let m;
  while ((m = re.exec(source))) {
    if (m[6] !== spec) continue;
    const indent = m[1], quote = m[5];
    const def = m[2] || m[4];
    const startLineCol = offsetToLineCol(source, m.index);
    const endLineCol = offsetToLineCol(source, m.index + m[0].length);
    if (m[3] !== undefined) {
      const existing = m[3].split(',').map((s) => s.trim()).filter(Boolean);
      if (existing.includes(name)) return null;
      existing.push(name);
      const head = def ? `${def}, ` : '';
      return {
        range: { start: startLineCol, end: endLineCol },
        newText: `${indent}import ${head}{ ${existing.join(', ')} } from ${quote}${spec}${quote}`,
        update: true,
      };
    }
    if (def === name) return null;
    return {
      range: { start: startLineCol, end: endLineCol },
      newText: `${indent}import ${def}, { ${name} } from ${quote}${spec}${quote}`,
      update: true,
    };
  }

  const lines = source.split('\n');
  let insertAt = 0;
  let i = 0;
  if (lines[0]?.startsWith('#!')) { insertAt = 1; i = 1; }
  while (i < lines.length && /^\s*#/.test(lines[i])) { insertAt = i + 1; i++; }
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^\s*import\b/.test(l)) { insertAt = i + 1; i++; continue; }
    break;
  }
  const needsBlankAfter = lines[insertAt] !== undefined && !/^\s*(import\b|$)/.test(lines[insertAt]);
  const prev = insertAt > 0 ? lines[insertAt - 1] : '';
  const needsBlankBefore = insertAt > 0 && !/^\s*(import\b|$)/.test(prev);
  return {
    range: { start: { line: insertAt, character: 0 }, end: { line: insertAt, character: 0 } },
    newText: `${needsBlankBefore ? '\n' : ''}import { ${name} } from '${spec}'\n${needsBlankAfter ? '\n' : ''}`,
  };
}

function offsetToLineCol(source, offset) {
  let line = 0, col = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') { line++; col = 0; }
    else col++;
  }
  return { line, character: col };
}

// Stateful index bound to one workspace root.
export function createExportIndex({ workspaceRoot, log = () => {} } = {}) {
  const discoveredRipFiles = new Set();
  const exportIndex = new Map();       // name → Set<fp>
  const exportIndexByFile = new Map(); // fp → Set<name>
  const projectRoots = new Set();
  const projectRootCache = new Map();
  const bareSpecForEntry = new Map();
  const declaredDepsCache = new Map();
  let exportIndexBuilt = false;
  let rootPath = workspaceRoot ? path.resolve(workspaceRoot) : null;

  function findProjectRoot(fp) {
    const dir = path.dirname(fp);
    if (projectRootCache.has(dir)) return projectRootCache.get(dir);
    let cur = dir;
    const floor = rootPath || '';
    while (cur && (!floor || cur.length >= floor.length)) {
      if (projectRoots.has(cur)) {
        projectRootCache.set(dir, cur);
        return cur;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      if (floor && parent.length < floor.length) break;
      cur = parent;
    }
    projectRootCache.set(dir, null);
    return null;
  }

  function loadPackageJson(dir) {
    projectRoots.add(dir);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return; }
    if (!pkg.name) return;
    const addEntry = (sub, target) => {
      if (typeof target !== 'string') {
        target = target?.default || target?.import || target?.require;
      }
      if (typeof target !== 'string' || !target.endsWith('.rip')) return;
      const full = path.resolve(dir, target);
      const spec = sub === '.' ? pkg.name : pkg.name + sub.slice(1);
      bareSpecForEntry.set(full, spec);
    };
    if (pkg.exports && typeof pkg.exports === 'object') {
      for (const [sub, target] of Object.entries(pkg.exports)) addEntry(sub, target);
    } else if (typeof pkg.exports === 'string') {
      addEntry('.', pkg.exports);
    } else if (typeof pkg.main === 'string') {
      addEntry('.', pkg.main);
    }
  }

  function declaredDepsFor(projectRoot) {
    if (!projectRoot) return null;
    let set = declaredDepsCache.get(projectRoot);
    if (set) return set;
    set = new Set();
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(pkg[field] || {})) set.add(name);
      }
    } catch { /* */ }
    declaredDepsCache.set(projectRoot, set);
    return set;
  }

  function resolveSpecForTarget(fromFp, targetFp) {
    const fromRoot = findProjectRoot(fromFp);
    const toRoot = findProjectRoot(targetFp);
    if (fromRoot && toRoot && fromRoot === toRoot) return relativeRipSpecifier(fromFp, targetFp);
    // No package.json boundary — same workspace still gets a relative path.
    if (!fromRoot && !toRoot && rootPath
        && fromFp.startsWith(rootPath + path.sep) && targetFp.startsWith(rootPath + path.sep)) {
      return relativeRipSpecifier(fromFp, targetFp);
    }
    const spec = bareSpecForEntry.get(targetFp);
    if (!spec) return null;
    const deps = declaredDepsFor(fromRoot);
    return deps && deps.has(pkgNameFromSpec(spec)) ? spec : null;
  }

  function removeFromIndex(fp) {
    const old = exportIndexByFile.get(fp);
    if (!old) return;
    for (const name of old) {
      const set = exportIndex.get(name);
      if (!set) continue;
      set.delete(fp);
      if (!set.size) exportIndex.delete(name);
    }
    exportIndexByFile.delete(fp);
  }

  function addToIndex(fp, names) {
    exportIndexByFile.set(fp, names);
    for (const name of names) {
      let set = exportIndex.get(name);
      if (!set) { set = new Set(); exportIndex.set(name, set); }
      set.add(fp);
    }
  }

  function updateFile(fp) {
    removeFromIndex(fp);
    let source;
    try { source = fs.readFileSync(fp, 'utf8'); } catch { return; }
    addToIndex(fp, scanExports(source));
  }

  function ensureBuilt() {
    if (exportIndexBuilt) return;
    exportIndexBuilt = true;
    const start = Date.now();
    for (const fp of discoveredRipFiles) updateFile(fp);
    log(`[rip] export index built: ${exportIndex.size} symbol(s) across ${discoveredRipFiles.size} file(s) in ${Date.now() - start}ms`);
  }

  function discover() {
    if (!rootPath) return;
    const start = Date.now();
    let count = 0;
    discoveredRipFiles.clear();
    projectRoots.clear();
    projectRootCache.clear();
    bareSpecForEntry.clear();
    declaredDepsCache.clear();
    exportIndex.clear();
    exportIndexByFile.clear();
    exportIndexBuilt = false;

    (function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of entries) {
        if (ent.isFile() && ent.name === 'package.json') loadPackageJson(dir);
      }
      for (const ent of entries) {
        if (INDEX_SKIP_DIRS.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile() && ent.name.endsWith('.rip')) {
          discoveredRipFiles.add(full);
          count++;
        }
      }
    })(rootPath);

    log(`[rip] discovered ${count} .rip file(s), ${projectRoots.size} project(s) in ${Date.now() - start}ms`);
  }

  function onRipChanged(fp, exists) {
    if (!fp.endsWith('.rip')) return;
    if (exists) {
      discoveredRipFiles.add(fp);
      if (exportIndexBuilt) updateFile(fp);
    } else {
      discoveredRipFiles.delete(fp);
      removeFromIndex(fp);
    }
  }

  function onPackageJsonChanged() {
    // Project roots / deps / bare specs may have moved — rediscover.
    discover();
  }

  function setWorkspaceRoot(next) {
    rootPath = next ? path.resolve(next) : null;
    if (rootPath) discover();
    else {
      discoveredRipFiles.clear();
      exportIndex.clear();
      exportIndexByFile.clear();
      exportIndexBuilt = false;
    }
  }

  // Augment a tsgo completion list with workspace export suggestions.
  // Edits are Rip-source TextEdits — do not face-map them.
  function augmentCompletions({ source, fromFp, position, items }) {
    if (!rootPath || !fromFp || !source) return items;
    ensureBuilt();

    const lineTextPrefix = (source.split('\n')[position.line] || '').slice(0, position.character);
    const partialMatch = lineTextPrefix.match(/[A-Za-z_$][\w$]*$/);
    const partial = partialMatch ? partialMatch[0] : '';
    const partialLc = partial.toLowerCase();
    const MAX_AUGMENT = partial ? Infinity : 50;

    const beforePartial = lineTextPrefix.slice(0, lineTextPrefix.length - partial.length);
    if (/[.?!]\s*$/.test(beforePartial)) return items; // member access

    const existingImports = collectImportedNames(source);
    const itemsByLabel = new Map();
    for (const it of items) itemsByLabel.set(it.label.replace(/\?$/, ''), it);

    let added = 0;
    for (const [name, sources] of exportIndex) {
      if (added >= MAX_AUGMENT) break;
      if (existingImports.has(name)) continue;
      if (partial && !name.toLowerCase().startsWith(partialLc)) continue;
      for (const targetFp of sources) {
        if (targetFp === fromFp) continue;
        const spec = resolveSpecForTarget(fromFp, targetFp);
        if (!spec) continue;
        const edit = buildImportEdit(source, spec, name);
        if (!edit) continue;
        const verb = edit.update ? 'Update' : 'Add';
        const { update: _u, ...textEdit } = edit;
        const existing = itemsByLabel.get(name);
        if (existing) {
          existing.labelDetails = { ...(existing.labelDetails || {}), description: spec };
          existing.detail = `${verb} import from "${spec}"\n${existing.detail || ''}`.trim();
          existing.additionalTextEdits = [textEdit];
          // Mark so resolve/face-mapping does not overwrite Rip edits.
          existing.data = { ...(existing.data || {}), ripExportIndex: true };
        } else {
          const item = {
            label: name,
            kind: 9, // CompletionItemKind.Module
            sortText: 'z' + name,
            labelDetails: { description: spec },
            detail: `${verb} import from "${spec}"`,
            additionalTextEdits: [textEdit],
            data: { ripExportIndex: true },
          };
          items.push(item);
          itemsByLabel.set(name, item);
        }
        added++;
        break;
      }
    }
    return items;
  }

  return {
    setWorkspaceRoot,
    discover,
    onRipChanged,
    onPackageJsonChanged,
    ensureBuilt,
    augmentCompletions,
    resolveSpecForTarget,
    // test / diagnostics hooks
    get size() { return exportIndex.size; },
    get fileCount() { return discoveredRipFiles.size; },
  };
}
