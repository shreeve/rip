import { describe, expect, test } from 'bun:test';
import { createMutation } from '@rip-lang/app';
import { __effect } from '../../../src/runtime/reactive.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('createMutation', () => {
  test('a non-function rejects', () => {
    expect(() => createMutation('nope')).toThrow(TypeError);
  });

  test('flags follow the lifecycle and the result returns', async () => {
    const gate = deferred();
    const save = createMutation(async payload => {
      await gate.promise;
      return { saved: payload };
    });
    expect(save.pending).toBeFalse();
    const running = save('x');
    expect(save.pending).toBeTrue();
    expect(save.succeeded).toBeFalse();
    gate.resolve();
    const result = await running;
    expect(result).toEqual({ saved: 'x' });
    expect(save.pending).toBeFalse();
    expect(save.succeeded).toBeTrue();
    expect(save.error).toBeNull();
  });

  test('only a request rejection is a mutation failure', async () => {
    const seen = [];
    const save = createMutation(
      async () => { throw new Error('request down'); },
      { onError: e => { seen.push(e.message); return 'handled'; } },
    );
    const result = await save();
    expect(result).toBe('handled');
    expect(seen).toEqual(['request down']);
    expect(save.error.message).toBe('request down');
    expect(save.pending).toBeFalse();
    expect(save.succeeded).toBeFalse();
  });

  test('without onError the rejection propagates', async () => {
    const save = createMutation(async () => { throw new Error('boom'); });
    await expect(save()).rejects.toThrow('boom');
    expect(save.error.message).toBe('boom');
  });

  test('a throw in onSuccess surfaces and never masquerades as onError', async () => {
    const errors = [];
    const save = createMutation(async () => 'ok', {
      onSuccess: () => { throw new Error('handler bug'); },
      onError: e => errors.push(e),
    });
    await expect(save()).rejects.toThrow('handler bug');
    expect(errors).toEqual([]);
    expect(save.succeeded).toBeTrue();
    expect(save.pending).toBeFalse();
  });

  test('a superseded call neither flips flags nor runs callbacks', async () => {
    const first = deferred();
    const second = deferred();
    const outcomes = [];
    let call = 0;
    const save = createMutation(
      () => (call += 1) === 1 ? first.promise : second.promise,
      { onSuccess: r => outcomes.push(r) },
    );
    const one = save();
    const two = save();
    second.resolve('newer');
    await two;
    first.resolve('older');
    expect(await one).toBeUndefined();
    expect(outcomes).toEqual(['newer']);
    expect(save.succeeded).toBeTrue();
    expect(save.pending).toBeFalse();
  });

  test('pending stays true through an async onSuccess', async () => {
    const gate = deferred();
    const save = createMutation(async () => 'r', { onSuccess: () => gate.promise });
    const running = save();
    await Bun.sleep(0);
    expect(save.pending).toBeTrue();
    gate.resolve();
    await running;
    expect(save.pending).toBeFalse();
  });

  test('flags are reactive', async () => {
    const save = createMutation(async () => 'ok');
    const states = [];
    const dispose = __effect(() => states.push(save.pending));
    await save();
    dispose();
    expect(states[0]).toBeFalse();
    expect(states).toContain(true);
    expect(states[states.length - 1]).toBeFalse();
  });
});

describe('createMutation reconciliation', () => {
  test('an older async onError never clears a newer pending', async () => {
    const err = deferred();
    const gate = deferred();
    const second = deferred();
    let call = 0;
    const save = createMutation(
      () => ((call += 1) === 1 ? err.promise : second.promise),
      { onError: () => gate.promise },
    );
    const one = save();
    err.reject(new Error('down'));
    await Bun.sleep(0);
    const two = save();
    gate.resolve();
    await one;
    expect(save.pending).toBeTrue();
    second.resolve('ok');
    await two;
    expect(save.pending).toBeFalse();
  });

  test('an older rejection after a newer success touches nothing', async () => {
    const first = deferred();
    const second = deferred();
    const errors = [];
    let call = 0;
    const save = createMutation(
      () => ((call += 1) === 1 ? first.promise : second.promise),
      { onError: e => errors.push(e) },
    );
    const one = save();
    const two = save();
    second.resolve('newer');
    await two;
    first.reject(new Error('older'));
    expect(await one).toBeUndefined();
    expect(errors).toEqual([]);
    expect(save.error).toBeNull();
    expect(save.succeeded).toBeTrue();
  });

  test('a superseded rejection without onError is dropped, not unhandled', async () => {
    const first = deferred();
    const second = deferred();
    let call = 0;
    const save = createMutation(() => ((call += 1) === 1 ? first.promise : second.promise));
    const one = save();
    const two = save();
    second.resolve('ok');
    await two;
    first.reject(new Error('late'));
    expect(await one).toBeUndefined();
    expect(save.error).toBeNull();
  });

  test('an onError that throws surfaces while error keeps the request failure', async () => {
    const save = createMutation(
      async () => { throw new Error('request'); },
      { onError: () => { throw new Error('handler'); } },
    );
    await expect(save()).rejects.toThrow('handler');
    expect(save.error.message).toBe('request');
    expect(save.pending).toBeFalse();
  });

  test('succeeded and error flags are reactive', async () => {
    const save = createMutation(async () => 'ok');
    const oks = [];
    const errs = [];
    const d1 = __effect(() => oks.push(save.succeeded));
    const d2 = __effect(() => errs.push(save.error));
    await save();
    d1();
    d2();
    expect(oks).toContain(true);
    expect(errs.every(e => e === null)).toBeTrue();
  });

  test('a synchronous fn works', async () => {
    const double = createMutation(n => n * 2);
    expect(await double(21)).toBe(42);
    expect(double.succeeded).toBeTrue();
  });
});
