import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	try {
		return await resolve(event);
	} catch (err) {
		console.error('[CRAZYSHOT SSR ERROR]', err);
		throw err;
	}
};
