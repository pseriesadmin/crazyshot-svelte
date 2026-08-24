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
		fileParallelism: false,
		// .claude/worktrees/**는 병렬 세션이 만든 별도 git worktree(각자 자기 복사본의
		// node_modules/소스를 가짐) — vitest 기본 include 패턴이 프로젝트 루트 전체를
		// 재귀 탐색해 이 경로의 구버전 테스트 파일까지 함께 실행시켜, 동일 테스트가 여러 번
		// 중복 실행되고 그 워크트리의 stale 코드 기준으로 실패하는 노이즈가 세션 내내 반복
		// 발생했다(CMS 전역 정밀검증 v3 STAGE 2 발견). 실제 프로젝트 코드는 항상 src/ 기준.
		exclude: ['**/node_modules/**', '**/.git/**', '**/.claude/worktrees/**']
	}
});
