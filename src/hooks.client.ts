import type { HandleClientError } from '@sveltejs/kit';
import { updated } from '$app/state';

/**
 * 새 배포 직후, 이전 버전 화면을 열어 둔 브라우저는 이미 사라진 화면 조각 파일
 * (`/_app/immutable/nodes/xx.js`)을 불러오다 실패한다.
 * 이 경우 한 번만 새로고침해 최신 버전을 받아오고, 반복 실패 시 무한 새로고침을 막는다.
 */
const RELOAD_KEY = 'cs_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 30_000;

function isChunkLoadError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return (
		message.includes('Failed to fetch dynamically imported module') ||
		message.includes('error loading dynamically imported module') ||
		message.includes('Importing a module script failed')
	);
}

function reloadOnce(): boolean {
	try {
		const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');
		if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
		sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
	} catch {
		return false;
	}
	location.reload();
	return true;
}

/**
 * 탭이 오래 백그라운드(다른 앱·탭 뒤)에 있다가 돌아온 순간에만 버전을 1회 확인한다.
 * 새 배포가 감지되면 SvelteKit이 "다음 화면 이동" 때 전체 새로고침으로 최신 버전을 받는다.
 * → 백그라운드에서 새로고침하지 않고, 주기적 요청도 없다(복귀 시 작은 파일 1건).
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

if (typeof document !== 'undefined') {
	let hiddenAt = 0;
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			hiddenAt = Date.now();
			return;
		}
		if (hiddenAt && Date.now() - hiddenAt >= STALE_AFTER_MS) {
			hiddenAt = 0;
			void updated.check();
		}
	});
}

export const handleError: HandleClientError = ({ error }) => {
	if (isChunkLoadError(error) && reloadOnce()) {
		return { message: '새 버전을 불러오는 중입니다.' };
	}
	return { message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
};
