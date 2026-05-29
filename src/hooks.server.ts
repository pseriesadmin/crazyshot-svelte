import type { Handle } from '@sveltejs/kit';

// Polyfill WebSocket for Node.js SSR
if (typeof globalThis.WebSocket === 'undefined') {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const ws = require('ws');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).WebSocket = ws.WebSocket || ws;
	} catch {
		// Fallback: minimal mock if ws not available
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).WebSocket = function MockWebSocket() {
			this.addEventListener = () => {};
			this.removeEventListener = () => {};
			this.send = () => {};
			this.close = () => {};
		};
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	return await resolve(event);
};
