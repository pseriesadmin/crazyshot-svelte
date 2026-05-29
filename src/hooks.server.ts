// Polyfill WebSocket and related globals for Node.js SSR
if (typeof globalThis.WebSocket === 'undefined') {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const ws = require('ws');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).WebSocket = ws;
	} catch {
		// ws not available
	}
}

export async function handle({ event, resolve }) {
	return await resolve(event);
}
