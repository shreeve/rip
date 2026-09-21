// `delay`: a promise that resolves after the given milliseconds.

const delay = async (ms: number) => new Promise(resolve => {
	setTimeout(resolve, ms);
});

export default delay;
