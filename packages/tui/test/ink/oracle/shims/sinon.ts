// The one piece of sinon Ink's helpers use: a spy that remembers the
// arguments of every call.

export const spy = (fn?: (...args: any[]) => unknown) => {
	const wrapped: any = (...args: any[]) => {
		wrapped.args.push(args);
		wrapped.callCount++;
		return fn?.(...args);
	};

	wrapped.args = [] as any[][];
	wrapped.callCount = 0;
	Object.defineProperty(wrapped, 'called', {get: () => wrapped.callCount > 0});
	Object.defineProperty(wrapped, 'firstCall', {get: () => ({args: wrapped.args[0]})});
	Object.defineProperty(wrapped, 'lastCall', {get: () => ({args: wrapped.args.at(-1)}), configurable: true});
	wrapped.getCall = (n: number) => ({args: wrapped.args[n]});
	wrapped.resetHistory = () => {
		wrapped.args.length = 0;
		wrapped.callCount = 0;
	};

	return wrapped;
};

export const stub = spy;
export default {spy, stub};
