import { test, expect } from 'bun:test';
import { Email, Text, toHTML } from '@rip-lang/ui/email';
import { Heading as ComponentsHeading } from '@rip-lang/ui/email/components';
import { WelcomeEmail } from '../email/example.rip';

test('package self-reference resolves the public email export', () => {
  expect(typeof Email).toBe('function');
  expect(toHTML(Text, { children: 'public' })).toContain('>public</p>');
  expect(toHTML(WelcomeEmail, { name: 'Ada' })).toContain('Welcome, Ada!');
});

test('the email/components subpath export resolves the curated module', () => {
  expect(typeof ComponentsHeading).toBe('function');
});
