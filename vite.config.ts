import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		host: 'localhost'
	},
	test: {
		// memberCodeCombo.test.ts의 bulk_reissue_member_codes 테스트는 user_profiles 전체를
		// 대상으로 하는 시스템 전역 작업이라, payment.test.ts/contractSign.test.ts 등 다른
		// 통합테스트 파일이 동시에 ephemeral user를 만들고 지우면 경쟁 상태로 간헐적 실패가
		// 발생했다(2026-08-17 확인). 테스트 파일을 순차 실행해 원천 차단 — 전체 스위트가
		// 수 초 내로 끝나는 규모라 비용은 미미함.
		fileParallelism: false
	}
});
