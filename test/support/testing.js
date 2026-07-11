// The battery vocabulary: the four verbs every test/battery/*.rip file
// imports. Two modes, decided by whether a collector is active:
//
//   collected — loadBattery() points `rows` at a fresh array and
//     imports the battery file; each verb call records a row.
//   standalone — no collector (the file was run directly:
//     `bun test/battery/assignment.rip`); each verb call runs its row
//     immediately and reports, so a battery file is an ordinary
//     runnable program.
import { basename } from 'node:path';

let rows = null;
let standaloneFile = 'battery';
let standalone = { ran: 0, failed: 0 };

export function collectInto(target, file) {
  rows = target;
  standaloneFile = file;
}

const verb = (kind) => (name, src, expected, options) => {
  const row = { verb: kind, name, src, expected, options, file: standaloneFile };
  if (rows !== null) {
    rows.push(row);
    return;
  }
  standalone.ran++;
  import('./battery.js').then(({ runRow }) => runRow(row)).then((failure) => {
    if (failure) {
      standalone.failed++;
      console.error(`✗ ${failure}`);
    } else {
      console.log(`✓ ${kind} "${name}"`);
    }
  });
};

export const test = verb('test');
export const code = verb('code');
export const fail = verb('fail');
export const type = verb('type');
