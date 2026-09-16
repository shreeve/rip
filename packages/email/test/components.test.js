import { test, expect } from 'bun:test'
import * as email from 'rip/email'
import { BasicEmail } from './fixtures/basic-email.rip'

const { toEmail, Email, Head, Body, Preview, Container, Section, Heading, Text, Link } = email

test('the package publishes the day-one surface and nothing else', () => {
  expect(Object.keys(email).sort()).toEqual([
    'Body', 'Container', 'Email', 'Head', 'Heading', 'Link', 'Preview', 'Section', 'Text', 'toEmail',
  ])
  expect(toEmail(BasicEmail, { message: 'welcome' }).html).toContain('<p>welcome</p>')
})

test('the message opens with the XHTML transitional doctype; Email and Head carry the client hints', () => {
  expect(toEmail(Email).html).toMatch(/^<!DOCTYPE html PUBLIC "-\/\/W3C\/\/DTD XHTML 1\.0 Transitional\/\/EN"/)
  expect(toEmail(Email).html).toContain('<html data-part="Email" lang="en" dir="ltr"></html>')
  expect(toEmail(Head).html).toContain('<meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />')
  expect(toEmail(Head).html).toContain('<meta name="x-apple-disable-message-reformatting" />')
})

test('Body carries the background on the body element with a zeroed box, the rest on the cell', () => {
  const { html } = toEmail(Body, { style: 'background:#fafafa;font-family:Inter;padding:40px 20px', children: 'x' })
  expect(html).toContain('<body style="background:#fafafa;margin:0;padding:0" data-part="Body">')
  expect(html).toContain('<td style="background:#fafafa;font-family:Inter;padding:40px 20px">x</td>')
  expect(toEmail(Body).html).toContain('<body style="margin:0" data-part="Body">')
})

test('Container and Section move padding onto the cell and keep the rest on the table', () => {
  const container = toEmail(Container, { style: { padding: '32px', maxWidth: '400px' }, children: 'x' }).html
  expect(container).toContain('<table style="max-width:400px" data-part="Container" align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">')
  expect(container).toContain('<td style="padding:32px">x</td>')
  const section = toEmail(Section, { style: 'background:#eee;padding:20px 8px;padding-top:1px', children: 'x' }).html
  expect(section).toContain('style="background:#eee" data-part="Section"')
  expect(section).toContain('<td style="padding:20px 8px;padding-top:1px">x</td>')
  expect(toEmail(Section, { style: 'background:#eee', children: 'x' }).html).not.toContain('<td style=')
})

test('Preview is the inbox line: raw beside the message, escaped in it, padded, absent from the text', () => {
  const out = toEmail(Preview, { text: 'Hi & co <3' })
  expect(out.preview).toBe('Hi & co <3')
  expect(out.html).toContain('Hi &amp; co &lt;3')
  expect(out.html).toContain('<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0" data-part="Preview" data-skip-in-text="true">')
  expect(out.html).toMatch(/<div>[\u00a0\u200c\u200b\u200d\u200e\u200f\ufeff]{980}<\/div>/)
  expect(out.text).toBe('')
  expect(toEmail(Body).preview).toBeNull()
})

test('Heading picks its level by `as`; Text carries email-safe defaults under the caller style', () => {
  expect(toEmail(Heading, { children: 'Title' }).html).toContain('<h1 data-part="HeadingH1">Title</h1>')
  expect(toEmail(Heading, { as: 'h3', style: 'color:red', children: 'Title' }).html).toContain('<h3 style="color:red" data-part="HeadingH3">Title</h3>')
  expect(toEmail(Text, { children: 'hello' }).html).toContain('<p style="font-size:14px;line-height:24px;margin:16px 0" data-part="Text">hello</p>')
  expect(toEmail(Text, { style: { margin: 0, color: '#262626' }, children: 'hello' }).html)
    .toContain('style="font-size:14px;line-height:24px;margin:0;color:#262626"')
})

test('Link opens in a new tab with the default color, and its href fails closed', () => {
  const link = (href) => toEmail(Link, { href, children: 'go' }).html
  expect(link('https://example.com?a=1&b=2')).toContain('<a style="color:#067df7;text-decoration:none" data-part="Link" href="https://example.com?a=1&amp;b=2" target="_blank">go</a>')
  for (const safe of ['http://example.com', 'mailto:a@b.c', 'tel:+1555', '/relative?x=1', 'page.html#top']) {
    expect(link(safe)).toContain(`href="${safe}"`)
  }
  for (const unsafe of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '\u0001javascript:alert(1)',
    'java\nscript:alert(1)',
    'java%09script:alert(1)',
    '//evil.example/path',
    '\\\\evil.example',
    'data:text/html,<b>x</b>',
  ]) {
    expect(link(unsafe)).toContain('href="#"')
  }
  expect(link('')).toContain('href="" target="_blank">go</a>')
})

test('the text twin breaks lines at blocks and headings and keeps a link address beside its text', () => {
  expect(toEmail(BasicEmail, { message: 'plain' }).text).toBe('Title\n\nplain')
  expect(toEmail(Link, { href: 'https://example.com', children: 'Example' }).text).toBe('Example (https://example.com)')
  expect(toEmail(Link, { href: 'https://example.com', children: 'https://example.com' }).text).toBe('https://example.com')
  expect(toEmail(Heading, { children: 'Title' }).text).toBe('Title')
})
