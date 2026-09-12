// rip-email: every case runs the CLI as a real subprocess through this
// repository's rip, against a template directory minted fresh per run.

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repo = join(import.meta.dir, '..', '..', '..');
const ripCli = join(repo, 'bin', 'rip');
const emailCli = join(import.meta.dir, '..', 'email', 'cli.rip');
const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'));

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rip-email-'));
  writeFileSync(join(dir, 'welcome.rip'), `
import { Email, Body, Preview, Text } from 'rip/ui/email'

export Welcome = component
  @name: string := 'friend'
  render
    Email
      Body
        Preview text: "Hi #{@name} & co"
        Text "Hello, #{@name}"

Welcome.previewProps = name: 'Ada'
Welcome.subject = (props) -> "Hello #{props.name}"

export helper = -> 1
`);
  writeFileSync(join(dir, 'plain.rip'), `
import { Email, Body, Text } from 'rip/ui/email'

export Plain = component
  render
    Email
      Body
        Text 'plain'
`);
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib', 'helpers.rip'), `export shout = (s) -> s.toUpperCase()\n`);
  mkdirSync(join(dir, 'emails'));
  writeFileSync(join(dir, 'emails', 'note.rip'), `
import { Email, Body, Text } from 'rip/ui/email'

export Note = component
  render
    Email
      Body
        Text 'a note'
`);
  writeFileSync(join(dir, '_frame.rip'), `
import { Email, Body } from 'rip/ui/email'

export Frame = component
  @children =! undefined
  render
    Email
      Body children: @children
`);
  mkdirSync(join(dir, '.drafts'));
  writeFileSync(join(dir, '.drafts', 'broken.rip'), `throw Error.new 'must never be imported'\n`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// FORCE_COLOR is dropped, not just overridden: Bun paints under it
// even with NO_COLOR set.
const env = { ...process.env, NO_COLOR: '1' };
delete env.FORCE_COLOR;

const runIn = (cwd, ...args) => spawnSync(process.execPath, [ripCli, emailCli, ...args], { cwd, encoding: 'utf8', env });
const run = (...args) => runIn(dir, ...args);

test('the rip-email bin is email/cli.rip, shebang’d and executable', () => {
  expect(pkg.bin).toEqual({ 'rip-email': './email/cli.rip' });
  expect(readFileSync(emailCli, 'utf8').startsWith('#!/usr/bin/env rip\n')).toBe(true);
  expect(statSync(emailCli).mode & 0o111).not.toBe(0);
});

test('--help and --version', () => {
  expect(run('--help').stdout).toContain('usage: rip-email <verb> [args]');
  expect(run('--version').stdout).toBe(`rip-email ${pkg.version}\n`);
  const r = run('bogus');
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("unknown verb 'bogus'");
  expect(run('dev', '.', '--port', '3001').stderr).toContain('dev does not take --port');
});

test('a flag the verb does not take, or a value that looks like a flag, is refused', () => {
  const unknown = run('dev', '.', '--prot');
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain('dev does not take --prot');
  const wrongVerb = run('dev', '.', '--text');
  expect(wrongVerb.status).toBe(1);
  expect(wrongVerb.stderr).toContain('dev does not take --text');
  const swallowed = run('export', '.', '--out', '--text');
  expect(swallowed.status).toBe(1);
  expect(swallowed.stderr).toContain('--out needs a value');
});

test('dev refuses a host outside the families that resolve here, before touching the edge', () => {
  const r = run('dev', dir, '--host', 'foo');
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('nothing resolves foo to this machine');
  expect(r.stderr).toContain('foo.local, foo.via.rip, or foo.localhost');
  expect(r.stdout).not.toContain('Rip Email');
});

test('a repeated positional is read where it stands, not where it first appears', () => {
  const r = run('export', '.', '--out', '.', '--text');
  expect(r.status).toBe(0);
  expect(readFileSync(join(dir, 'welcome.txt'), 'utf8')).toBe('Hello, Ada');
});

test('templates lists one template per file, skipping dot directories, _files, and files with no component', () => {
  const r = run('templates', '.');
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual([{ path: 'emails/note', file: 'emails/note.rip', component: 'Note' }, { path: 'plain', file: 'plain.rip', component: 'Plain' }, { path: 'welcome', file: 'welcome.rip', component: 'Welcome' }]);
});

test('a file exporting two components is refused by name', () => {
  const two = mkdtempSync(join(tmpdir(), 'rip-email-two-'));
  try {
    writeFileSync(join(two, 'two.rip'), `
import { Email, Body, Text } from 'rip/ui/email'
export A1 = component
  render
    Email
      Body
        Text 'a'
export B2 = component
  render
    Email
      Body
        Text 'b'
`);
    const r = runIn(two, 'templates', '.');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('two.rip exports A1, B2 — a template file exports one component');
  } finally {
    rmSync(two, { recursive: true, force: true });
  }
});

test('render, the child-process verb, answers the message as json from previewProps', () => {
  const json = JSON.parse(run('render', 'plain.rip').stdout);
  expect(json.text).toBe('plain');
  expect(json.html).toMatch(/^<!DOCTYPE html PUBLIC/);
  expect(json.html).toContain('>plain</p>');
  expect(json.subject).toBeNull();
  expect(json.preview).toBeNull();
  const welcome = JSON.parse(run('render', 'welcome.rip').stdout);
  expect(welcome.text).toBe('Hello, Ada');
  expect(welcome.subject).toBe('Hello Ada');
  expect(welcome.preview).toBe('Hi Ada & co');
});

test('render refuses a file with no component', () => {
  const r = run('render', 'lib/helpers.rip');
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('exports no component');
});

test('export writes <path>.html per template and, with --text, the text twin', () => {
  const r = run('export', '.', '--out', 'out', '--text');
  expect(r.status).toBe(0);
  expect(readFileSync(join(dir, 'out', 'welcome.html'), 'utf8')).toContain('Hello, Ada');
  expect(readFileSync(join(dir, 'out', 'welcome.txt'), 'utf8')).toBe('Hello, Ada');
  expect(readFileSync(join(dir, 'out', 'plain.html'), 'utf8')).toContain('>plain</p>');
  expect(readFileSync(join(dir, 'out', 'emails-note.html'), 'utf8')).toContain('>a note</p>');
  expect(r.stdout).toContain(' ✓ out/welcome.html');
});

test('export of a directory with no templates fails loudly', () => {
  const r = run('export', 'lib');
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('no templates under lib');
});

test('export names the template that would not load, in one line', () => {
  const broken = mkdtempSync(join(tmpdir(), 'rip-email-broken-'));
  try {
    writeFileSync(join(broken, 'oops.rip'), `throw Error.new 'boom at load'\n`);
    const r = runIn(broken, 'export', '.', '--out', 'out');
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe('rip-email: oops.rip: boom at load');
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
});

test('the directory defaults to ./emails, or the cwd when it is named emails, never the bare cwd', () => {
  const beside = runIn(dir, 'templates');
  expect(beside.status).toBe(0);
  expect(JSON.parse(beside.stdout)).toEqual([{ path: 'note', file: 'note.rip', component: 'Note' }]);

  const inside = runIn(join(dir, 'emails'), 'templates');
  expect(inside.status).toBe(0);
  expect(JSON.parse(inside.stdout)).toEqual([{ path: 'note', file: 'note.rip', component: 'Note' }]);

  const elsewhere = runIn(join(dir, 'lib'), 'templates');
  expect(elsewhere.status).toBe(1);
  expect(elsewhere.stderr).toContain('no emails directory here');
});
