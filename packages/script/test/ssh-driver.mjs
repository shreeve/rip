// Subprocess driver for ssh.test.js: runs the v3 ssh.rip conversation
// (mc, a :pure escape send at the Hint: prompt, exit) against whatever
// `ssh` the inherited PATH provides, then prints the received
// transcript as JSON. The test spawns this with a stub ssh on PATH.
import Script from '@rip-lang/script';

const url = process.argv[2];
const opts = JSON.parse(process.argv[3] ?? '{}');

const transcript = [];
const chat = await Script.ssh(url, {
  live: false,
  slow: 5,
  ...opts,
  onRecv: (data) => transcript.push(data),
});

try {
  await chat([
    '~> ', 'mc',
    'Hint:', [Symbol.for('pure'), '\x1b0'],
    '~> ', 'exit',
    /BYE\[\w+\]/, // wait for the stub's goodbye before disconnecting
  ]);
} finally {
  chat.disconnect();
}

console.log(JSON.stringify(transcript.join('')));
process.exit(0);
