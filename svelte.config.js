import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// Supabase DB/Auth 리전이 ap-northeast-1(도쿄)이라 기본값(iad1, 미국 동부)로 배포하면
		// 모든 서버 요청이 태평양을 왕복한다 — icn1(서울)로 고정해 도쿄와의 리전 간 지연을
		// 최소화 + 실사용자 대부분이 한국인 서비스라 엔드유저 지연도 함께 개선.
		// (실서버 CMS·사용자 화면 전역 심각한 로딩 지연 원인 규명 결과, 2026-09-02)
		adapter: adapter({ regions: ['icn1'] })
	}
};

export default config;
