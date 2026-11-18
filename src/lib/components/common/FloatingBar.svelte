<script lang="ts">
	import FloatingButton from '$lib/components/chat/FloatingButton.svelte'
	import ChatBottomSheet from '$lib/components/chat/ChatBottomSheet.svelte'
	import { chatStore, toggleChat } from '$lib/stores/chat.svelte'
	import { page } from '$app/state'
	import { goto, preloadData } from '$app/navigation'

	interface Props {
		userId?: string
		userName?: string
		userHandle?: string
		contextType?: string
		contextId?: string
		/** 모바일(<640px)에서만 완전히 숨김 — 로그인 화면용(2026-11-03). PC는 그대로 노출 */
		hideMobile?: boolean
	}

	let {
		userId = 'guest',
		userName = '게스트',
		userHandle = 'guest',
		contextType = 'general',
		contextId,
		hideMobile = false
	}: Props = $props()

	let peekMode = $state(true)
	let bubbling = $state(false)
	/** 화면을 처음 열었을 때(또는 새로고침 직후) 첫 노출 전까지 true — 숨김 모션(peek-in)을 재생하지 않고 숨은 자리에서 대기한다 */
	let entering = $state(true)

	/** 2026-11-03: 화면 열림·스크롤 멈춤 시 우→좌 팝아웃으로 다시 나타나는 지연(ms) — 모바일 사용성 개선 */
	const ENTER_DELAY_MS = 200
	const SETTLE_DELAY_MS = 250
	let settleTimer: ReturnType<typeof setTimeout> | undefined

	function scheduleExpand(delay: number): void {
		clearTimeout(settleTimer)
		settleTimer = setTimeout(() => {
			if (chatStore.isOpen) return
			entering = false
			expandFromPeek()
		}, delay)
	}

	function expandFromPeek(): void {
		if (!peekMode) return
		peekMode = false
		bubbling = true
		setTimeout(() => { bubbling = false }, 1100)
	}

	/** 모바일(<640px) peek 중 버튼 1-touch: 펼침 + 실행(제안 A, 2026-09-28) */
	function beforeFabAction(): void {
		if (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches) {
			expandFromPeek()
		}
	}

	function handleBarClick(e: MouseEvent) {
		if (e.target !== e.currentTarget) return
		expandFromPeek()
	}

	/** 터치하면 펼침을 시작하고 곧바로 이동한다(지연 없음).
	 *  2026-10-09: 펼침이 끝나길 기다린 뒤 이동하는 방식(400ms 지연)은 장바구니 도착까지 체감 대기가 길어 폐기(Stephen 지시).
	 *  전체 새로고침(window.location.href) 대신 앱 내부 이동(goto)을 써서, 다음 화면이 준비되는 동안 현재 화면의 펼침 모션이
	 *  끊기지 않고 이어지게만 한다 — 이동 시점은 늦추지 않는다. */
	let navigating = false

	async function goAfterExpand(href: string): Promise<void> {
		if (navigating) return
		navigating = true
		try {
			beforeFabAction()
			await goto(href)
		} catch {
			window.location.href = href
		} finally {
			navigating = false
		}
	}

	/** 손가락이 닿는 순간(손을 떼기 전) 다음 화면 데이터를 미리 불러오기 시작한다(2026-10-09) — 터치 시작~클릭 사이 시간만큼 도착이 빨라진다.
	 *  이동 시점은 그대로(클릭 때). 미리 불러오기 실패는 무시(이동 시 다시 불러옴). */
	function warmUp(href: string): void {
		void preloadData(href).catch(() => {})
	}

	function handleCartClick(e: MouseEvent): void {
		e.stopPropagation()
		void goAfterExpand('/cart')
	}

	function handleSearchClick(e: MouseEvent): void {
		e.stopPropagation()
		void goAfterExpand('/products/search')
	}

	function handleChatClose() {
		if (chatStore.isOpen) toggleChat()
	}

	$effect(() => {
		function onScroll() {
			if (chatStore.isOpen) return
			peekMode = true                    // 위·아래 어느 방향이든 스크롤 중에는 우측으로 감춤
			scheduleExpand(SETTLE_DELAY_MS)    // 스크롤이 멈추면 우→좌로 다시 노출
		}
		window.addEventListener('scroll', onScroll, { passive: true })
		return () => {
			window.removeEventListener('scroll', onScroll)
			clearTimeout(settleTimer)
		}
	})

	$effect(() => {
		void page.url.pathname
		if (!chatStore.isOpen) {
			peekMode = true
			scheduleExpand(ENTER_DELAY_MS)     // 화면 열림·이동 시 우→좌 노출
		}
	})
</script>

<div
	class="fab-bar"
	class:peek={peekMode}
	class:entering={entering}
	class:hide-mobile={hideMobile}
	class:bubbling={bubbling}
	onclick={handleBarClick}
	role="group"
	aria-label="빠른 메뉴"
>
	<!-- 장바구니 (순차 모션 1번째) -->
	<div class="fab-item fab-item-center" style="--i: 0">
	<button
		class="fab-btn"
		aria-label="장바구니"
		onpointerdown={() => warmUp('/cart')}
		onclick={handleCartClick}
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 70" fill="none" aria-hidden="true">
			<path d="M70 35C70 54.33 54.33 70 35 70C15.67 70 0 54.33 0 35C0 15.67 15.67 0 35 0C54.33 0 70 15.67 70 35Z" fill="#3B2F8A"/>
			<path d="M47.6017 25.373C48.5001 24.3251 50.0779 24.2036 51.1261 25.1016C53.5951 27.2178 54.3369 30.2459 54.5499 32.376C54.6606 33.4822 54.6412 34.4678 54.5958 35.1758C54.573 35.5322 54.5432 35.8253 54.5177 36.0361C54.505 36.1415 54.4937 36.227 54.4845 36.29C54.4799 36.3216 54.476 36.348 54.4728 36.3682C54.4713 36.378 54.47 36.3865 54.4689 36.3936C54.4683 36.397 54.4674 36.4006 54.4669 36.4033L54.466 36.4072V36.4092L52.0001 36L54.466 36.4111C54.464 36.4232 54.4613 36.4353 54.4591 36.4473C53.453 41.9811 52.123 46.5415 49.5675 49.6982C46.8384 53.0693 43.0207 54.4999 38.0001 54.5H32.0001C26.9795 54.4999 23.161 53.0694 20.4318 49.6982C17.8764 46.5415 16.5464 41.9811 15.5402 36.4473C15.538 36.4353 15.5354 36.4232 15.5333 36.4111L17.9992 36C15.5339 36.4109 15.5333 36.4092 15.5333 36.4092V36.4072L15.5324 36.4033C15.5319 36.4006 15.531 36.397 15.5304 36.3936C15.5293 36.3865 15.528 36.378 15.5265 36.3682C15.5234 36.3479 15.5194 36.3216 15.5148 36.29C15.5057 36.2269 15.4943 36.1415 15.4816 36.0361C15.4561 35.8253 15.4263 35.5322 15.4035 35.1758C15.3581 34.4678 15.3387 33.4822 15.4494 32.376C15.6624 30.246 16.4034 27.2178 18.8722 25.1016C19.9205 24.2031 21.499 24.325 22.3976 25.373C23.2961 26.4214 23.1745 27.9999 22.1261 28.8984C21.0955 29.7822 20.5869 31.2544 20.4249 32.874C20.3481 33.6426 20.36 34.3448 20.3927 34.8555C20.4089 35.1082 20.4299 35.3075 20.4455 35.4365C20.4532 35.5005 20.4592 35.547 20.463 35.5732C21.456 41.027 22.6253 44.4611 24.3175 46.5518C25.8382 48.4303 28.0214 49.4999 32.0001 49.5H38.0001C41.9787 49.4999 44.1611 48.4301 45.6818 46.5518C47.3741 44.4611 48.5423 41.0271 49.5353 35.5732C49.5391 35.547 49.5461 35.5005 49.5539 35.4365C49.5694 35.3075 49.5904 35.1081 49.6066 34.8555C49.6393 34.3448 49.6512 33.6426 49.5744 32.874C49.4123 31.2541 48.9032 29.7821 47.8722 28.8984C46.8242 27.9999 46.7034 26.4213 47.6017 25.373Z" fill="white"/>
			<path d="M35.0001 15.25C37.9344 15.2503 40.6904 16.7788 42.4962 19.4668C44.2891 22.1358 45.0933 25.8291 44.6134 30.2939C44.4511 31.804 43.0951 32.8966 41.5851 32.7344C40.0751 32.572 38.9824 31.2161 39.1447 29.7061C39.5245 26.1717 38.8247 23.8651 37.9308 22.5342C37.0496 21.2225 35.9351 20.7502 35.0001 20.75C34.0651 20.7499 32.9506 21.222 32.0695 22.5332C31.1757 23.8635 30.4758 26.1691 30.8556 29.7021C31.018 31.2122 29.9252 32.568 28.4152 32.7305C26.9051 32.8928 25.5492 31.8001 25.3869 30.29C24.907 25.8263 25.712 22.1343 27.505 19.4658C29.3109 16.7783 32.0659 15.2498 35.0001 15.25Z" fill="white"/>
		</svg>
	</button>
	</div>

	<!-- 검색 (순차 모션 2번째) -->
	<div class="fab-item fab-item-center" style="--i: 1">
	<button
		class="fab-btn"
		aria-label="검색"
		onpointerdown={() => warmUp('/products/search')}
		onclick={handleSearchClick}
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 70" fill="none" aria-hidden="true">
			<path d="M70 35C70 54.33 54.33 70 35 70C15.67 70 0 54.33 0 35C0 15.67 15.67 0 35 0C54.33 0 70 15.67 70 35Z" fill="#3B2F8A"/>
			<path d="M46.6768 33.5879C46.6766 26.9119 41.2639 21.5 34.5879 21.5C27.912 21.5002 22.5002 26.912 22.5 33.5879C22.5 40.2639 27.9119 45.6766 34.5879 45.6768C37.9592 45.6768 40.9457 44.3469 43.1309 42.1406C43.5991 41.6679 44.237 41.4018 44.9023 41.4004C45.5676 41.3991 46.2057 41.6631 46.6758 42.1338L52.7686 48.2334C53.7443 49.2103 53.7434 50.7928 52.7666 51.7686C51.7897 52.7443 50.2072 52.7434 49.2314 51.7666L44.7822 47.3125C41.9358 49.4418 38.4192 50.6768 34.5879 50.6768C25.1505 50.6766 17.5 43.0253 17.5 33.5879C17.5002 24.1506 25.1506 16.5002 34.5879 16.5C44.0253 16.5 51.6766 24.1505 51.6768 33.5879C51.6768 34.9685 50.5573 36.0877 49.1768 36.0879C47.796 36.0879 46.6768 34.9686 46.6768 33.5879Z" fill="white"/>
		</svg>
	</button>
	</div>

	<!-- 채팅 FAB (순차 모션 3번째) -->
	<div class="fab-item" style="--i: 2">
		<FloatingButton
			{userId}
			{userName}
			{userHandle}
			{contextType}
			{contextId}
			hideSheet
			onBeforeToggle={beforeFabAction}
		/>
	</div>
</div>

<!-- 채팅 바텀시트(모달)는 반드시 .fab-bar 바깥에서 렌더링 — .fab-bar는 모바일에서 peek/expand
     transform이 항상 걸려 있어(peek: translateX(85%), expand 후에도 애니메이션 종료값이
     forwards로 유지됨), 그 안에 중첩되면 position:fixed 모달이 뷰포트가 아니라 .fab-bar의
     작은 박스를 containing block으로 삼아 화면 전체가 아닌 FAB 근처에 찌그러져 렌더링되는
     버그가 있었다(core-rules.md "CSS transform + position:fixed 충돌", 2026-08-19 발견·수정) -->
<ChatBottomSheet
	isOpen={chatStore.isOpen}
	{userId}
	{userName}
	{userHandle}
	{contextType}
	{contextId}
	onclose={handleChatClose}
/>

<style>
	.fab-bar {
		position: fixed;
		right: 24px;
		bottom: 100px;
		z-index: 200;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.fab-btn {
		background: none;
		border: none;
		outline: none;
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		filter: drop-shadow(0 4px 10px rgba(16, 11, 50, 0.22));
		min-height: 44px;
		min-width: 44px;
	}

	.fab-btn:hover  { transform: scale(1.07); }
	.fab-btn:active { transform: scale(0.95); }

	/* 장바구니·검색 아이콘: 모바일 55px / PC 40px */
	.fab-btn svg {
		width: 55px;
		height: 55px;
	}

	@media (min-width: 640px) {
		.fab-btn svg {
			width: 40px;
			height: 40px;
		}
	}

	/* ── 모바일 전용 peek & expand 인터랙션 (< 640px) ── */
	/* 업스크롤/닫힘 → peek(우측으로 깊이 가림, 미세 감쇠) / 다운스크롤·탭 → expand(팝아웃, 감쇠 스프링)
	 * peek 정지 위치: translateX(85%) — 컨테이너 폭(70px, 채팅 FAB 기준) 대비 약 59.5px 우측 이동,
	 * 좌측에 약 10.5px(15%)만 노출되도록 깊이 가림
	 * 표본 수치값 정본: .claude/rules/ui-mobile.md "그룹형 플로팅 메뉴(.fab-group) 감쇠
	 * 스프링 바운스 표준"(base 57.5px) 대비 이 컴포넌트 진폭(59.5px) 비율로 재계산 —
	 * 감쇠율 45~50%·오버슈트 비율(+13%/-8%/+1.7%)은 표준 그대로 유지, 9단계로 세분화 */
	@media (max-width: 639px) {
		/* iOS Safari: transform 애니메이션(forwards)이 걸린 fixed 요소가 스크롤 중 간헐적으로 사라지는 렌더링 버그 예방 —
		   전용 합성 레이어 승격(GNB의 translateZ(0) 처리와 같은 목적). PC에는 적용하지 않음. */
		.fab-bar {
			will-change: transform;
			-webkit-backface-visibility: hidden;
			backface-visibility: hidden;
			/* 2026-10-09: 막대 전체가 아니라 아이콘 3개가 각자 움직인다(순차 모션) — 막대 자체의 투명 영역이 페이지 터치를 막지 않도록 */
			pointer-events: none;
			/* 2026-11-03: 모바일 30% 축소(Stephen 지시) — 바 전체를 우하단 기준으로 0.7배.
			   아이콘 크기·간격·이동 거리(translateX)·감쇠 키프레임이 모두 같은 비율로 줄어 기존 모션 값은 그대로 보존된다.
			   우측 24px·하단 100px 위치는 transform-origin 덕분에 유지. */
			transform: scale(0.7);
			transform-origin: right bottom;
			/* 2026-11-03: 숨김은 화면 밖까지 완전히 가린다(Stephen 지시) — 아이콘 폭 70 + 오른쪽 여백 24/0.7 + 그림자·배지 여유.
			   기존 59.5px(좌측 약 10px 노출)에서 확장. 오버슈트 비율(+13%/-8%/+1.7%)은 이 값 기준으로 유지. */
			--fab-peek-x: 120px;
		}
		.fab-item { pointer-events: auto; }

		.fab-bar.hide-mobile { display: none; }

		/* 첫 노출 전 대기: 숨김 모션을 재생하지 않고 숨은 자리에 머문다(이후 팝아웃이 이 위치에서 시작) */
		.fab-bar.peek.entering .fab-item {
			animation: none;
			transform: translateX(var(--fab-peek-x));
		}

		/* 순차 모션(2026-10-09, Stephen 지시): 장바구니 → 검색 → 채팅 순으로 감춤·노출. 아이콘마다 --i × 50ms 지연.
		   길이는 기존의 1.5배(팝아웃 0.5s→0.75s, 감춤 0.22s→0.33s), 감쇠 스프링·오버슈트 곡선은 그대로.
		   지연 동안 시작 위치에 머물도록 fill-mode both(끝 위치 = 정지 상태와 같아 되돌림 없음). */
		.fab-bar.peek .fab-item {
			transform: translateX(var(--fab-peek-x)); /* 정지: peek(화면 밖 완전 숨김) */
			animation: fab-bar-peek-in 0.33s cubic-bezier(0.25, 0.1, 0.25, 1) both;
			animation-delay: calc(var(--i) * 50ms);
		}
		.fab-bar:not(.peek) .fab-item {
			animation: fab-bar-pop-out 0.75s cubic-bezier(0.25, 0.1, 0.25, 1) both;
			animation-delay: calc(var(--i) * 50ms);
		}

		@keyframes fab-bar-pop-out {
			0%   { transform: translateX(var(--fab-peek-x)); }  /* peek 시작 */
			26%  { transform: translateX(-21.7px); } /* 1차 오버슈트, 진폭 대비 약 -37% */
			43%  { transform: translateX(10.3px); }  /* 직전 대비 약 48% */
			57%  { transform: translateX(-5.1px); }  /* 49% */
			68%  { transform: translateX(2.6px); }   /* 51% */
			77%  { transform: translateX(-1.2px); }  /* 46% */
			84%  { transform: translateX(0.7px); }   /* 58% */
			90%  { transform: translateX(-0.4px); }  /* 57% */
			95%  { transform: translateX(0.1px); }   /* 25% */
			100% { transform: translateX(0); }       /* 정지 */
		}
		@keyframes fab-bar-peek-in {
			0%   { transform: translateX(0); }
			55%  { transform: translateX(calc(var(--fab-peek-x) * 1.13)); }  /* +13% 오버슈트 */
			78%  { transform: translateX(calc(var(--fab-peek-x) * 0.92)); }  /* -8%  언더슈트 */
			92%  { transform: translateX(calc(var(--fab-peek-x) * 1.017)); }  /* +1.7% */
			100% { transform: translateX(var(--fab-peek-x)); }  /* 정지 (peek) */
		}

		/* 확장 시 버블 애니메이션: 장바구니·검색 + 채팅 FAB 내부 SVG — 아이콘별 순차 지연에 맞춰 시작, 길이 1.5배(0.32s→0.48s) */
		@keyframes fab-expand-bubble {
			0%   { transform: scale(1); }
			40%  { transform: scale(1.12); }
			70%  { transform: scale(0.96); }
			100% { transform: scale(1); }
		}

		.fab-bar.bubbling .fab-btn svg,
		.fab-bar.bubbling :global(.fab-btn svg) {
			animation: fab-expand-bubble 0.48s ease-out;
			animation-delay: calc(var(--i, 0) * 50ms);
		}

		@media (prefers-reduced-motion: reduce) {
			.fab-bar.peek .fab-item,
			.fab-bar:not(.peek) .fab-item { animation-duration: 0.01ms; animation-delay: 0s; }
			.fab-bar.bubbling .fab-btn svg,
			.fab-bar.bubbling :global(.fab-btn svg) { animation: none; }
		}
	}

	/* 장바구니·검색 래퍼 — 기존엔 버튼이 막대 폭(70px)에 맞춰 늘어나 아이콘이 가운데 놓였다(래퍼를 넣어도 같은 배치) */
	.fab-item-center {
		display: flex;
		justify-content: center;
	}
	/* 버튼은 래퍼 폭(70px)을 모두 채운다 — 이전처럼 접힘(peek) 상태에서 보이는 띠 전체가 터치 영역이 되게(sp3-qa 지적 반영) */
	.fab-item-center > .fab-btn {
		flex: 1;
	}
</style>
