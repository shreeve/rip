// Ink's test/helpers/run.ts starts a fixture under a pseudo-terminal.
// Such a test is about a process, not a frame, and is left out of the
// port; this stand-in lets its file load without node-pty.

export const run = async (): Promise<string> => {
	throw new Error('the oracle runs no fixture under a pseudo-terminal');
};
