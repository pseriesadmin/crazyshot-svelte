import { env } from '$env/dynamic/public'

/** PUBLIC_ 우선, VITE_ fallback — Vercel 기존 env와 호환 ($env/static 빌드 필수 제거) */
export function getSupabaseUrl(): string {
	return env.PUBLIC_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
}

export function getSupabaseAnonKey(): string {
	return env.PUBLIC_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''
}

export function requireSupabasePublicEnv(): { url: string; anonKey: string } {
	const url = getSupabaseUrl()
	const anonKey = getSupabaseAnonKey()
	if (!url || !anonKey) {
		throw new Error(
			'Missing Supabase env: set PUBLIC_SUPABASE_URL/KEY or VITE_SUPABASE_URL/KEY',
		)
	}
	return { url, anonKey }
}
