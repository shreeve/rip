// Client projection extraction — what assembleBundle uses to lift
// server-defined projections across the browser boundary.
import { describe, expect, test } from 'bun:test';
import { extractClientProjections } from '../../src/extract-projections.js';
import { compile } from '../../src/compile.js';
import { __schema } from '../../src/runtime/schema.js';
// Models in the parity fixture need the persistence runtime loaded.
import '../../src/runtime/schema-orm.js';

const MODELS = `export User = schema :model
  firstName! string, 1..
  lastName!  string
  email!     email @unique
  phone?     string
  @timestamps

export Order = schema :model
  total! number, 0..
  @timestamps
  @belongs_to User

export UserView  = User.pick("id", "firstName", "lastName", "email", "phone")
export Greeter = schema :shape
  name! string
  hi: -> "hi"
export helper = () -> 42
`;

const loadFromSynthetic = (syntheticSource, name) => {
  const js = compile(syntheticSource, { runtimeDelivery: 'none', path: 'shared.rip' })
    .code.replace(/export const /g, 'const ');
  // eslint-disable-next-line no-new-func
  const fn = new Function('__schema', `${js}\n;return ${name};`);
  return fn(__schema);
};

describe('extractClientProjections', () => {
  test('folded projection is shippable and round-trips validation', () => {
    const r = extractClientProjections(MODELS, ['UserView'], { path: 'api/models.rip' });
    expect(r.ok).toBe(true);
    expect(r.source.trim()).toMatch(/^export UserView = __schema\(/);

    const View = loadFromSynthetic(r.source, 'UserView');
    expect(View.kind).toBe('shape');

    const runtimeJs = compile(MODELS, { runtimeDelivery: 'none', path: 'api/models.rip' })
      .code.replace(/export const /g, 'const ');
    // eslint-disable-next-line no-new-func
    const RuntimeView = new Function('__schema', `${runtimeJs}\n;return UserView;`)(__schema);
    for (const sample of [
      { id: 1, firstName: 'Al', lastName: 'Bo', email: 'a@b.com', phone: 'x' },
      { firstName: '', email: 'bad' },
      {},
    ]) {
      expect(JSON.stringify(View.safe(sample))).toBe(JSON.stringify(RuntimeView.safe(sample)));
    }
  });

  test('a :model is refused', () => {
    const r = extractClientProjections(MODELS, ['User'], { path: 'api/models.rip' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/:model/);
  });

  test('a schema with behavior is refused', () => {
    const r = extractClientProjections(MODELS, ['Greeter'], { path: 'api/models.rip' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/behavior/);
  });

  test('a field transform is refused', () => {
    const src = 'export Slug = schema :shape\n  name! string, -> it.name.toLowerCase()\n';
    const r = extractClientProjections(src, ['Slug'], { path: 'api/models.rip' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/behavior/);
  });

  test('a literal value of "function" does not trip behavior detection', () => {
    const src = 'export Thing = schema :shape\n  kind! "function" | "class"\n  name! string\n';
    const r = extractClientProjections(src, ['Thing'], { path: 'api/models.rip' });
    expect(r.ok).toBe(true);
    expect(r.source).toMatch(/literals/);
    expect(r.source).not.toMatch(/\btransform:/);
  });

  test('a non-schema value is refused', () => {
    const r = extractClientProjections(MODELS, ['helper'], { path: 'api/models.rip' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shippable schema/);
  });

  test('synthetic source carries no model/ORM artifacts', () => {
    const r = extractClientProjections(MODELS, ['UserView'], { path: 'api/models.rip' });
    expect(r.ok).toBe(true);
    expect(r.source).not.toMatch(/kind:\s*"model"/);
    expect(r.source).not.toMatch(/has_many|belongs_to/);
  });

  test('a projection transitively ships its nested schema dependency', () => {
    const src = 'Item = schema :shape\n  id! number\nOrder = schema :shape\n  items! Item[]\nOrderPub = Order.pick("items")\n';
    const r = extractClientProjections(src, ['OrderPub'], { path: 'm.rip' });
    expect(r.ok).toBe(true);
    expect(r.source).toMatch(/export OrderPub = __schema/);
    expect(r.source).toMatch(/export Item = __schema/);
  });

  test('a non-shippable nested type (a :model) is refused', () => {
    const src = 'Owner = schema :model\n  name! string\nThing = schema :shape\n  owner! Owner\nThingPub = Thing.pick("owner")\n';
    const r = extractClientProjections(src, ['ThingPub'], { path: 'm.rip' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nested type/);
    expect(r.error).toMatch(/:model/);
  });
});
