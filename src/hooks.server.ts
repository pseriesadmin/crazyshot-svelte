import ws from 'ws';
import type { Handle } from '@sveltejs/kit';

// Node.js < 22: Supabase Realtime needs WebSocket during SSR (root layout → auth store → supabase client)
if (typeof globalThis.WebSocket === 'undefined') {
	(globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket =
		ws as unknown as typeof WebSocket;
}

export const handle: Handle = async ({ event, resolve }) => {
	return await resolve(event);
};
