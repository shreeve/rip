// `@sinonjs/fake-timers`, for the one test in components.tsx that
// installs a clock. That test is about time, not about a frame, and is
// left out of the port; the clock here only lets its file load.

const clock = {
	tick() {},
	async tickAsync() {},
	async runAllAsync() {},
	uninstall() {},
};

export default {install: () => clock};
