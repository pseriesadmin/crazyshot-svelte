<script lang="ts">
	import FloatingButton from '$lib/components/chat/FloatingButton.svelte'
	import { page } from '$app/state'

	interface Props {
		userId?: string
		userName?: string
		userHandle?: string
		contextType?: string
		contextId?: string
	}

	let {
		userId = 'guest',
		userName = '게스트',
		userHandle = 'guest',
		contextType = 'general',
		contextId
	}: Props = $props()

	let peekMode = $state(true)
	let bubbling = $state(false)

	function handleBarClick() {
		if (!peekMode) return
		peekMode = false
		bubbling = true
		setTimeout(() => { bubbling = false }, 700)
	}

	$effect(() => {
		function onScroll() { peekMode = true }
		window.addEventListener('scroll', onScroll, { passive: true })
		return () => window.removeEventListener('scroll', onScroll)
	})

	$effect(() => {
		void page.url.pathname
		peekMode = true
	})
</script>

<div
	class="fab-bar"
	class:peek={peekMode}
	class:bubbling={bubbling}
	onclick={handleBarClick}
	role="group"
	aria-label="빠른 메뉴"
>
	<!-- 장바구니 -->
	<button
		class="fab-btn"
		style={peekMode ? 'pointer-events:none' : ''}
		aria-label="장바구니"
		onclick={() => window.location.href = '/cart'}
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 35" fill="none" aria-hidden="true">
			<path d="M35 17.5C35 27.165 27.165 35 17.5 35C7.83502 35 0 27.165 0 17.5C0 7.83502 7.83502 0 17.5 0C27.165 0 35 7.83502 35 17.5Z" fill="#3B2F8A"/>
			<path d="M25.7736 14.25C26.461 14.3115 26.9685 14.918 26.9073 15.6055L26.5402 19.7188L26.5362 19.7559C26.3287 21.5004 25.6935 23.0646 24.588 24.2061C23.4647 25.3657 21.9392 26 20.1573 26H15.754C13.9724 25.9998 12.4475 25.3656 11.3243 24.2061C10.2189 23.0646 9.58361 21.5003 9.37609 19.7559L9.37316 19.7373L9.37219 19.7188L9.005 15.6055C8.94381 14.9181 9.45154 14.3116 10.1388 14.25C10.8264 14.1887 11.4339 14.6962 11.4952 15.3838L11.8614 19.4766C12.0227 20.8088 12.4854 21.8113 13.1202 22.4668C13.7398 23.1063 14.6009 23.4998 15.754 23.5H20.1573C21.3108 23.5 22.1724 23.1064 22.7921 22.4668C23.427 21.8113 23.8906 20.809 24.0519 19.4766L24.4171 15.3838C24.4784 14.6963 25.0861 14.1889 25.7736 14.25Z" fill="white"/>
			<path d="M17.9562 9.10156C18.8942 9.10156 19.9275 9.43248 20.7423 10.1455C21.5869 10.8847 22.1417 11.9887 22.1417 13.3877V15.4326C22.1417 16.1229 21.582 16.6826 20.8917 16.6826C20.2447 16.6823 19.7125 16.1908 19.6486 15.5605L19.6417 15.4326V13.3877C19.6417 12.6973 19.3889 12.2829 19.0958 12.0264C18.7731 11.7441 18.3385 11.6016 17.9562 11.6016C17.5738 11.6017 17.1392 11.7441 16.8165 12.0264C16.5235 12.2829 16.2706 12.6975 16.2706 13.3877V15.4326C16.2706 16.1229 15.711 16.6826 15.0206 16.6826C14.3304 16.6825 13.7707 16.1228 13.7706 15.4326V13.3877C13.7706 11.9888 14.3256 10.8847 15.17 10.1455C15.9848 9.43242 17.0182 9.10166 17.9562 9.10156Z" fill="white"/>
		</svg>
	</button>

	<!-- 검색 -->
	<button
		class="fab-btn"
		style={peekMode ? 'pointer-events:none' : ''}
		aria-label="검색"
		onclick={() => window.location.href = '/products'}
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 70" fill="none" aria-hidden="true">
			<path d="M70 35C70 54.33 54.33 70 35 70C15.67 70 0 54.33 0 35C0 15.67 15.67 0 35 0C54.33 0 70 15.67 70 35Z" fill="#3B2F8A"/>
			<path d="M41.7738 41.5103C43.0691 40.282 45.153 40.5239 46.2408 41.9365C47.674 43.7992 49.0634 45.2443 50.8816 46.7589C52.2533 47.9015 52.4033 49.9798 51.1085 51.2077C49.8404 52.4103 47.8036 52.2079 46.713 50.8444C45.1901 48.9401 43.7668 47.4642 41.9373 45.8821C40.6155 44.739 40.5065 42.7126 41.7738 41.5103Z" fill="white"/>
			<path d="M31.4945 18.2146C34.6406 17.698 37.8709 18.119 40.7761 19.4242C43.6815 20.7299 46.1337 22.8617 47.8191 25.5496C49.5042 28.2375 50.3485 31.362 50.2458 34.5265C50.199 35.9598 48.9909 37.0846 47.5471 37.0391C46.1027 36.9929 44.9697 35.792 45.0162 34.358C45.0854 32.221 44.5144 30.1109 43.3766 28.2956C42.2382 26.4801 40.5816 25.0392 38.6193 24.1573C36.6569 23.2756 34.4742 22.9925 32.3491 23.3414C30.2237 23.6906 28.2498 24.6575 26.6779 26.1199C25.1061 27.5824 24.0059 29.4743 23.5173 31.5572C23.0287 33.6403 23.1729 35.821 23.9323 37.8225C24.6917 39.824 26.0325 41.5578 27.7839 42.8032C29.5351 44.0481 31.6193 44.7509 33.772 44.8206C35.216 44.8678 36.35 46.068 36.3029 47.5017C36.2554 48.935 35.046 50.0585 33.6023 50.0123C30.4147 49.9093 27.3286 48.8703 24.7357 47.0268C22.1429 45.1831 20.1582 42.6162 19.0339 39.6532C17.91 36.6904 17.6974 33.4635 18.4206 30.38C19.1439 27.2962 20.7711 24.4939 23.0982 22.3286C25.4253 20.1635 28.348 18.7316 31.4945 18.2146Z" fill="white"/>
		</svg>
	</button>

	<!-- 채팅 FAB: peek 시 차단 → 확장 후 탭 시 바텀시트 열림 (transform 중 fixed 포지셔닝 왜곡 방지) -->
	<div style={peekMode ? 'pointer-events:none' : ''}>
		<FloatingButton
			{userId}
			{userName}
			{userHandle}
			{contextType}
			{contextId}
		/>
	</div>
</div>

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
	@media (max-width: 639px) {
		.fab-bar {
			transition: transform 0.42s cubic-bezier(0.34, 1.28, 0.64, 1);
		}

		/* peek: 우측 절반 숨김 — 아이콘 왼쪽 절반만 노출 */
		.fab-bar.peek {
			transform: translateX(calc(50% + 24px));
		}

		@keyframes fab-expand-bubble {
			0%   { transform: scale(1); }
			40%  { transform: scale(1.12); }
			70%  { transform: scale(0.96); }
			100% { transform: scale(1); }
		}

		/* 확장 시 버블 애니메이션: 장바구니·검색 + 채팅 FAB 내부 SVG */
		.fab-bar.bubbling .fab-btn svg,
		.fab-bar.bubbling :global(.fab-btn svg) {
			animation: fab-expand-bubble 0.32s ease-out;
		}
	}
</style>
