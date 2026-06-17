import ws from 'ws';
import type { Handle } from '@sveltejs/kit';

// Polyfill WebSocket for Node.js SSR (ESM-safe — require('ws') 금지)
if (typeof globalThis.WebSocket === 'undefined') {
	(globalThis as unknown as Record<string, unknown>).WebSocket = ws;
}

export const handle: Handle = async ({ event, resolve }) => {
	return await resolve(event);
};
