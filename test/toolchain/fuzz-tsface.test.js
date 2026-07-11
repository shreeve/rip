// The TS-face drift-detection layer — the
// EXTENDED tier's property harness over generated annotated programs
// (scripts/fuzz-tsface.mjs: seeded, deterministic, type-correct by
// construction). Three properties per program:
//   1. STRIP IDENTITY: stripFace(tsFace) === JS-mode bytes, both
//      runtime deliveries — the drift gate over programs the corpus
//      never spelled.
//   2. DRIFT DETECTOR: every annotated construct, compiled alone,
//      produces ≥1 TS-only region — an emission path that silently
//      stops emitting TS bytes for a construct class fails HERE, by
//      construct name, before any corpus row notices.
//   3. TSC-CLEAN: every composed face checks clean under tsc — ONE
//      batched program, diagnostics attributed per seed.
//
// Reproduction: every failure message carries the seed; run
//   RIP_FUZZ_SEED=<seed> bun run test:all test/fuzz-tsface.test.js
// to isolate it, and
//   bun scripts/fuzz-tsface.mjs <seed>
// to print the program, its face, and the recorded regions.
import { describe, test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';
import { describeExtended, EXTENDED } from '../support/extended.js';
import { tscBatch } from '../support/tscbatch.js';
import { generateProgram, CONSTRUCT_KINDS } from '../support/fuzz-tsface.mjs';

const TSC = process.env.RIP_TSC ?? Bun.which('tsc');
const TSC_TIMEOUT = 60_000;

// The tsc floor, NEVER skipped (the gate files' policy, mirrored
// here): the printed reproduction path filters the run to THIS file,
// which excludes the other gates' floor tests — without its own
// floor, a single-file run with tsc missing would pass 0-fail while
// the tsc-clean tier silently skipped.
describe('the tsc floor (never skipped)', () => {
  test('RIP_REQUIRE_TSC=1 makes a missing tsc a FAILURE here too', () => {
    if (process.env.RIP_REQUIRE_TSC && !TSC) {
      throw new Error(
        'RIP_REQUIRE_TSC is set but no tsc was found (set RIP_TSC or put tsc on PATH) — ' +
        'the fuzz tsc-clean tier cannot run in a required-validation environment',
      );
    }
    expect(Boolean(TSC) || !process.env.RIP_REQUIRE_TSC).toBe(true);
  });
});

// The seed corpus: 48 programs (~230 constructs) per run, or exactly
// one under RIP_FUZZ_SEED (the reproduction path).
const SEEDS = process.env.RIP_FUZZ_SEED
  ? [Number(process.env.RIP_FUZZ_SEED)]
  : Array.from({ length: 48 }, (_, i) => i + 1);

const repro = (seed) =>
  `reproduce: RIP_FUZZ_SEED=${seed} bun run test:all test/fuzz-tsface.test.js; ` +
  `inspect: bun scripts/fuzz-tsface.mjs ${seed}`;

const programs = EXTENDED ? SEEDS.map(generateProgram) : [];

describeExtended('fuzz: strip identity — generated faces minus regions equal JS-mode bytes', () => {
  for (const p of programs) {
    test(`seed ${p.seed} (${p.constructs.length} constructs)`, () => {
      for (const runtimeDelivery of ['none', 'inline']) {
        const faced = compile(p.source, { runtimeDelivery, face: 'ts' });
        const plain = compile(p.source, { runtimeDelivery });
        expect(
          stripFace(faced.code, faced.tsRegions),
          `strip(face) !== JS bytes (delivery ${runtimeDelivery}) — ${repro(p.seed)}\n--- source ---\n${p.source}`,
        ).toBe(plain.code);
        expect(plain.tsRegions).toEqual([]);
      }
    });
  }
});

describeExtended('fuzz: the drift detector — every annotated construct produces at least one TS-only region', () => {
  for (const p of programs) {
    test(`seed ${p.seed}`, () => {
      for (const construct of p.constructs) {
        const faced = compile(construct.source, { runtimeDelivery: 'none', face: 'ts' });
        expect(
          faced.tsRegions.length,
          `'${construct.kind}' emitted ZERO TS-only regions — its annotations no longer reach the face; ` +
          `${repro(p.seed)}\n--- construct ---\n${construct.source}`,
        ).toBeGreaterThanOrEqual(1);
      }
    });
  }

  test('the surface floor: the default seed corpus exercises EVERY generator construct kind', () => {
    if (process.env.RIP_FUZZ_SEED) return; // single-seed reproduction runs are exempt
    const seen = new Set(programs.flatMap((p) => p.constructs.map((c) => c.kind)));
    for (const kind of CONSTRUCT_KINDS) {
      expect(seen.has(kind), `construct kind never generated across the corpus: '${kind}'`).toBe(true);
    }
  });
});

// The feature-runtime ambient names — the tsface-tsc gate's set
// (reactive, schema, and the M12 component family): faces compile
// under runtimeDelivery 'none', so the artifact under validation is
// the face, not the runtime bodies.
const AMBIENT =
  'declare const __state: any, __computed: any, __effect: any, __batch: any, ' +
  '__readonly: any, __setErrorHandler: any, __handleError: any, __catchErrors: any, ' +
  'getEffectSignal: any, __schema: any, SchemaError: any, registerCoercer: any, ' +
  '__Component: any, __pushComponent: any, __popComponent: any, setContext: any, ' +
  'getContext: any, hasContext: any, __clsx: any, __lis: any, __reconcile: any, ' +
  '__transition: any, __handleComponentError: any, __detach: any, __ownerFrame: any, ' +
  '__pushOwner: any, __popOwner: any, __detachRef: any;\n';

const describeTscExtended = TSC ? describeExtended : describe.skipIf(true);

describeTscExtended('fuzz: every composed face is tsc-clean (one batched program)', () => {
  let batch = null;
  const files = { 'ambient.d.ts': AMBIENT };
  if (EXTENDED && TSC) {
    for (const p of programs) {
      const faced = compile(p.source, { runtimeDelivery: 'none', face: 'ts' });
      files[`seed${p.seed}.ts`] = `${faced.code}\nexport {};\n`;
    }
  }
  const runBatch = () => {
    batch ??= tscBatch(TSC, files, ['--module', 'esnext', '--noImplicitAny', 'false']);
    return batch;
  };

  for (const p of programs) {
    test(`seed ${p.seed}`, () => {
      const errors = runBatch().byFile.get(`seed${p.seed}.ts`);
      expect(
        errors,
        `tsc rejected the face — ${repro(p.seed)}\n${errors.join('\n')}\n--- face ---\n${files[`seed${p.seed}.ts`]}`,
      ).toEqual([]);
    }, TSC_TIMEOUT);
  }

  test('no diagnostic escapes seed attribution', () => {
    expect(runBatch().unattributed).toEqual([]);
  }, TSC_TIMEOUT);
});
