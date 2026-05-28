<script lang="ts">
	import { onMount } from 'svelte';

	onMount(() => {
		console.warn('CRAZYSHOT Development Environment initialized');
	});
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
	<div class="text-center mb-12">
		<h1 class="text-5xl font-bold text-gray-900 mb-4">CRAZYSHOT 리뉴얼</h1>
		<p class="text-xl text-gray-600">비대면 AI 검수 + 동적 보증금 + K-POP 인바운드 픽업</p>
	</div>

	<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
		<div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
			<h2 class="text-2xl font-bold text-purple-600 mb-2">🚀 빠른 렌탈</h2>
			<p class="text-gray-600">12시간/24시간 단기 대여로 즉시 완결</p>
		</div>

		<div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
			<h2 class="text-2xl font-bold text-blue-600 mb-2">🤖 AI 검수</h2>
			<p class="text-gray-600">출고/반납 사진 자동 검수로 분쟁 원천 차단</p>
		</div>

		<div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
			<h2 class="text-2xl font-bold text-green-600 mb-2">🌍 글로벌</h2>
			<p class="text-gray-600">해외 카드 결제 + 인천공항 픽업</p>
		</div>
	</div>

	<div class="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-8 mb-8">
		<h2 class="text-2xl font-bold mb-4">개발 환경 상태</h2>
		<div class="space-y-3 text-lg">
			<div class="flex items-center gap-2">
				<span class="text-2xl">✅</span>
				<span>SvelteKit + TypeScript 설치 완료</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-2xl">✅</span>
				<span>Tailwind CSS 설정 완료</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-2xl">✅</span>
				<span>Supabase 클라이언트 라이브러리 준비</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-2xl">✅</span>
				<span>Claude API 통합 준비</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-2xl">✅</span>
				<span>환경 변수 설정 완료 (.env.local)</span>
			</div>
		</div>
	</div>

	<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
		<div class="bg-white rounded-lg shadow-md p-6">
			<h3 class="font-bold text-lg mb-4">📚 핵심 모듈 (P0)</h3>
			<ul class="space-y-2 text-gray-600">
				<li>✓ M1: 상품·재고 관리</li>
				<li>✓ M2: 예약·가용성 관리</li>
				<li>✓ M3: 결제·정산 관리</li>
				<li>✓ M4: 멤버십·고객 관리</li>
				<li>✓ M5: 배송·검수 관리</li>
			</ul>
		</div>

		<div class="bg-white rounded-lg shadow-md p-6">
			<h3 class="font-bold text-lg mb-4">🛠️ 기술 스택</h3>
			<ul class="space-y-2 text-gray-600">
				<li>Frontend: SvelteKit + TypeScript</li>
				<li>Database: Supabase PostgreSQL</li>
				<li>Auth: Supabase Auth (OAuth)</li>
				<li>Payment: TossPayments v2</li>
				<li>AI: Claude API (Vision)</li>
			</ul>
		</div>
	</div>

	<div class="mt-12 p-6 bg-yellow-50 border-l-4 border-yellow-400 rounded">
		<p class="text-sm text-gray-700">
			<strong>다음 단계:</strong> .env.local 파일에 실제 API 키를 설정한 후 <code
				class="bg-white px-2 py-1 rounded"
			>
				npm run dev
			</code>
			로 개발 서버를 시작하세요.
		</p>
	</div>
</div>

<style>
	:global(body) {
		background-color: #f9fafb;
	}
</style>
