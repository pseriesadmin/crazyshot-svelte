<script lang="ts">
	const LOG_TYPES = [
		'일상 로그',
		'여행 로그',
		'맛집 로그',
		'운동 로그',
		'독서 로그',
		'영화·드라마 로그',
		'공부 로그',
		'취미 로그'
	]

	import { onMount } from 'svelte'

	onMount(() => {
		document.body.classList.add('crazylog-write')
		return () => document.body.classList.remove('crazylog-write')
	})

	let logType = $state('')
	let title = $state('')
	let content = $state('')
	let tags = $state('')
	let typeOpen = $state(false)

	// Mobile toggles
	let logPublic = $state(false)
	let commentNotify = $state(false)

	// PC sidebar options
	let memberPublic = $state(true)
	let cafePublic = $state(false)
	let cafeScrap = $state(true)
	let aiSave = $state(true)
	let autoSource = $state(false)
	let ccl = $state(false)

	function selectType(t: string) {
		logType = t
		typeOpen = false
	}

	function handleSubmit() {
		// submission logic — BACKLOG: BL-CRAZYLOG-SUBMIT
	}
</script>

<svelte:head>
  <style>
    @media (max-width: 767px) {
      body.crazylog-write .gnb-mobile-wrap,
      body.crazylog-write .gnb-desktop-wrap { display: none !important; }
      body.crazylog-write .fab-bar           { display: none !important; }
      body.crazylog-write .site-footer       { display: none !important; }
    }
  </style>
</svelte:head>

<!-- ============================================================
     MOBILE LAYOUT
     ============================================================ -->
<div class="m-page">
	<!-- Mobile GNB (custom — replaces common GNB on mobile) -->
	<header class="m-gnb-wrap">
		<nav class="m-gnb">
			<button class="m-gnb-close" aria-label="닫기">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path
						d="M15 1L8 8M8 8L1 15M8 8L15 15M8 8L1 1"
						stroke="#444444"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<span class="m-gnb-title">로그 등록</span>
			<div class="m-gnb-logo" aria-hidden="true">
				<svg width="20" height="16.5" viewBox="0 0 20 16.5" fill="none">
					<path
						d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z"
						fill="#CF0000"
					/>
					<path
						d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z"
						fill="#201857"
					/>
				</svg>
			</div>
		</nav>
	</header>

	<!-- Notice section -->
	<section class="m-notice">
		<h2 class="m-notice-title">크레이지한 로그생활 필독</h2>
		<ul class="m-notice-list">
			<li>선택한 로그타입스러운 포스트만 등록 약속~</li>
			<li>오해받을 로그타입은 경고없이 이동과 가림됨</li>
			<li>멋지고 담백한 로그로 채널홍보 맘껏 시작하기</li>
		</ul>
	</section>

	<!-- White card form (rounded top only) -->
	<div class="m-card">
		<!-- User info card (compact) -->
		<div class="m-user-card">
			<div class="m-avatar">S</div>
			<div class="m-user-info">
				<div class="m-user-row">
					<span class="m-user-name">스티븐봉재</span>
					<span class="m-user-badge">로그닷</span>
				</div>
				<div class="m-user-row">
					<span class="m-user-level">LV.4MD</span>
					<span class="m-user-cert">본인인증 · 내증서</span>
				</div>
			</div>
		</div>

		<!-- Log type select -->
		<div class="m-field-wrap">
			<button
				class="m-select"
				onclick={() => (typeOpen = !typeOpen)}
				aria-expanded={typeOpen}
				aria-haspopup="listbox"
			>
				<span class="m-select-label" class:m-placeholder={!logType}>
					{logType || '로그 타입 선택'}
				</span>
				<svg
					class="m-select-arrow"
					class:m-arrow-open={typeOpen}
					width="8"
					height="14"
					viewBox="0 0 8 14"
					fill="none"
				>
					<path
						d="M1 1L7 7L1 13"
						stroke="#444444"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			{#if typeOpen}
				<ul class="m-dropdown" role="listbox">
					{#each LOG_TYPES as t}
						<li role="option" aria-selected={logType === t}>
							<button
								class="m-dropdown-item"
								class:m-dropdown-active={logType === t}
								onclick={() => selectType(t)}
							>
								{t}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Title input -->
		<input class="m-input" type="text" placeholder="로그 제목" bind:value={title} />

		<!-- Content editor (toolbar + textarea) -->
		<div class="m-editor-box">
			<div class="m-toolbar">
				<button class="m-tb-btn" aria-label="이미지">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<rect x="2" y="4" width="16" height="13" rx="2" stroke="#444444" stroke-width="1.5" />
						<circle cx="7" cy="8.5" r="1.5" fill="#444444" />
						<path
							d="M2 14l4-4 3 3 3-3 4 4"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				<button class="m-tb-btn" aria-label="동영상">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<rect x="2" y="4" width="11" height="13" rx="2" stroke="#444444" stroke-width="1.5" />
						<path
							d="M13 8l5-3v10l-5-3V8Z"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
				<button class="m-tb-btn" aria-label="텍스트">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path
							d="M4 5h12M10 5v11M8 16h4"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				<button class="m-tb-btn" aria-label="이모지">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<circle cx="10" cy="10" r="7" stroke="#444444" stroke-width="1.5" />
						<circle cx="7.5" cy="8.5" r="1" fill="#444444" />
						<circle cx="12.5" cy="8.5" r="1" fill="#444444" />
						<path
							d="M7 13c.8 1.2 5.2 1.2 6 0"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				<button class="m-tb-btn" aria-label="인용">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<rect x="4" y="7" width="3" height="6" rx="1" fill="#444444" />
						<rect x="10" y="7" width="3" height="6" rx="1" fill="#444444" />
					</svg>
				</button>
				<button class="m-tb-btn" aria-label="구분선">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path
							d="M3 10h14"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-dasharray="2 2"
						/>
					</svg>
				</button>
				<button class="m-tb-btn" aria-label="링크">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path
							d="M8 12a4 4 0 0 0 5.66 0l2-2a4 4 0 0 0-5.66-5.66L9 5.34"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
						<path
							d="M12 8a4 4 0 0 0-5.66 0l-2 2a4 4 0 0 0 5.66 5.66L11 14.66"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				<button class="m-tb-btn" aria-label="첨부파일">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path
							d="M16 8l-7 7a4 4 0 0 1-5.66-5.66l7-7A2.5 2.5 0 0 1 14 5.87L7 12.87A1 1 0 0 1 5.59 11.5L12 5"
							stroke="#444444"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			</div>
			<textarea
				class="m-textarea"
				placeholder="로그 내용을 입력해주세요"
				bind:value={content}
			></textarea>
		</div>

		<!-- Tags input -->
		<input class="m-input" type="text" placeholder="# 태그 추가 (최대 10개)" bind:value={tags} />

		<!-- Content options -->
		<div class="m-content-options">
			<h3 class="m-opts-heading">공개 설정</h3>
			<label class="m-check-row"><input type="checkbox" bind:checked={memberPublic} />멤버공개</label>
			<label class="m-check-row"><input type="checkbox" bind:checked={cafePublic} />카페 · 네이버 서비스 공개</label>
			<div class="m-divider"></div>
			<h3 class="m-opts-heading">댓글 허용</h3>
			<label class="m-check-row"><input type="checkbox" bind:checked={cafeScrap} />카페 · 블로그 스크랩 허용</label>
			<label class="m-check-row"><input type="checkbox" bind:checked={aiSave} />AI · 자동 저장 허용</label>
			<div class="m-divider"></div>
			<label class="m-check-row"><input type="checkbox" bind:checked={autoSource} />자동출처 사용</label>
			<label class="m-check-row"><input type="checkbox" bind:checked={ccl} />CCL 사용</label>
		</div>

		<!-- Options (toggles) -->
		<div class="m-options">
			<div class="m-toggle-row">
				<span class="m-toggle-label">로그 공개</span>
				<button
					class="m-toggle"
					class:m-toggle-on={logPublic}
					onclick={() => (logPublic = !logPublic)}
					role="switch"
					aria-checked={logPublic}
					aria-label="로그 공개"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<div class="m-toggle-row">
				<span class="m-toggle-label">댓글 알림</span>
				<button
					class="m-toggle"
					class:m-toggle-on={commentNotify}
					onclick={() => (commentNotify = !commentNotify)}
					role="switch"
					aria-checked={commentNotify}
					aria-label="댓글 알림"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<p class="m-options-hint">내정보에서 모든 로그를 볼 수 있음</p>
		</div>

		<!-- Submit button -->
		<button class="m-submit" onclick={handleSubmit}>
			<svg width="15" height="10" viewBox="0 0 17 12" fill="none">
				<path
					d="M16 6H1M5.615 1L1 6l4.615 5"
					stroke="#AAAAAA"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>로그 등록</span>
			<svg class="m-submit-r" width="15" height="10" viewBox="0 0 17 12" fill="none">
				<path
					d="M16 6H1M5.615 1L1 6l4.615 5"
					stroke="#AAAAAA"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>
</div>

<!-- ============================================================
     PC LAYOUT (≥ 768px)
     ============================================================ -->
<div class="d-page">
	<div class="d-container">
		<!-- Notice bar -->
		<div class="d-notice">
			<h2 class="d-notice-title">크레이지한 로그생활 필독</h2>
			<ul class="d-notice-list">
				<li>선택한 로그타입스러운 포스트만 등록 약속~</li>
				<li>오해받을 로그타입은 경고없이 이동과 가림됨</li>
				<li>멋지고 담백한 로그로 채널홍보 맘껏 시작하기</li>
			</ul>
		</div>

		<!-- Two-column layout -->
		<div class="d-columns">
			<!-- LEFT: Editor card -->
			<div class="d-editor-card">
				<!-- Type select -->
				<div class="d-field-wrap">
					<button
						class="d-select"
						onclick={() => (typeOpen = !typeOpen)}
						aria-expanded={typeOpen}
						aria-haspopup="listbox"
					>
						<span class="d-select-label" class:d-placeholder={!logType}>
							{logType || '로그 타입 선택'}
						</span>
						<svg
							class="d-select-arrow"
							class:d-arrow-open={typeOpen}
							width="8"
							height="14"
							viewBox="0 0 8 14"
							fill="none"
						>
							<path
								d="M1 1L7 7L1 13"
								stroke="#444444"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					{#if typeOpen}
						<ul class="d-dropdown" role="listbox">
							{#each LOG_TYPES as t}
								<li role="option" aria-selected={logType === t}>
									<button
										class="d-dropdown-item"
										class:d-dropdown-active={logType === t}
										onclick={() => selectType(t)}
									>
										{t}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<!-- Title input -->
				<input class="d-input" type="text" placeholder="로그 제목" bind:value={title} />

				<!-- Content editor (toolbar + textarea) -->
				<div class="d-editor-box">
					<div class="d-toolbar">
						<button class="d-tb-btn" aria-label="이미지">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<rect
									x="2"
									y="4"
									width="16"
									height="13"
									rx="2"
									stroke="#444444"
									stroke-width="1.5"
								/>
								<circle cx="7" cy="8.5" r="1.5" fill="#444444" />
								<path
									d="M2 14l4-4 3 3 3-3 4 4"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<button class="d-tb-btn" aria-label="동영상">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<rect
									x="2"
									y="4"
									width="11"
									height="13"
									rx="2"
									stroke="#444444"
									stroke-width="1.5"
								/>
								<path
									d="M13 8l5-3v10l-5-3V8Z"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
						<button class="d-tb-btn" aria-label="텍스트">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M4 5h12M10 5v11M8 16h4"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<button class="d-tb-btn" aria-label="이모지">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<circle cx="10" cy="10" r="7" stroke="#444444" stroke-width="1.5" />
								<circle cx="7.5" cy="8.5" r="1" fill="#444444" />
								<circle cx="12.5" cy="8.5" r="1" fill="#444444" />
								<path
									d="M7 13c.8 1.2 5.2 1.2 6 0"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<button class="d-tb-btn" aria-label="인용">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<rect x="4" y="7" width="3" height="6" rx="1" fill="#444444" />
								<rect x="10" y="7" width="3" height="6" rx="1" fill="#444444" />
							</svg>
						</button>
						<button class="d-tb-btn" aria-label="구분선">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M3 10h14"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-dasharray="2 2"
								/>
							</svg>
						</button>
						<button class="d-tb-btn" aria-label="링크">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M8 12a4 4 0 0 0 5.66 0l2-2a4 4 0 0 0-5.66-5.66L9 5.34"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linecap="round"
								/>
								<path
									d="M12 8a4 4 0 0 0-5.66 0l-2 2a4 4 0 0 0 5.66 5.66L11 14.66"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<button class="d-tb-btn" aria-label="첨부파일">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M16 8l-7 7a4 4 0 0 1-5.66-5.66l7-7A2.5 2.5 0 0 1 14 5.87L7 12.87A1 1 0 0 1 5.59 11.5L12 5"
									stroke="#444444"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					</div>
					<textarea
						class="d-textarea"
						placeholder="로그 내용을 입력해주세요"
						bind:value={content}
					></textarea>
				</div>

				<!-- Tags -->
				<input
					class="d-input"
					type="text"
					placeholder="# 태그 추가 (최대 10개)"
					bind:value={tags}
				/>

				<!-- Submit -->
				<button class="d-submit" onclick={handleSubmit}>
					<svg width="15" height="10" viewBox="0 0 17 12" fill="none">
						<path
							d="M16 6H1M5.615 1L1 6l4.615 5"
							stroke="#AAAAAA"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span>로그 등록</span>
					<svg class="d-submit-r" width="15" height="10" viewBox="0 0 17 12" fill="none">
						<path
							d="M16 6H1M5.615 1L1 6l4.615 5"
							stroke="#AAAAAA"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			</div>

			<!-- RIGHT: Sidebar -->
			<aside class="d-sidebar">
				<!-- User info card -->
				<div class="d-user-card">
					<div class="d-avatar">S</div>
					<div class="d-user-meta">
						<div class="d-user-name-row">
							<span class="d-user-name">스티븐봉재</span>
							<span class="d-user-badge">로그닷</span>
						</div>
						<span class="d-user-level">LV.4MD</span>
					</div>
					<div class="d-user-stats">
						<div class="d-stat-tile">
							<span class="d-stat-label">내블로그</span>
							<span class="d-stat-value">0</span>
						</div>
						<div class="d-stat-tile">
							<span class="d-stat-label">임시등록</span>
							<span class="d-stat-value">0</span>
						</div>
					</div>
				</div>

				<!-- Content options card -->
				<div class="d-options-card">
					<div class="d-opts-section">
						<h3 class="d-opts-heading">공개설정</h3>
						<label class="d-check-row">
							<input type="checkbox" class="d-checkbox" bind:checked={memberPublic} />
							<span>멤버공개</span>
						</label>
						<label class="d-check-row">
							<input type="checkbox" class="d-checkbox" bind:checked={cafePublic} />
							<span>카페·네이버 서비스 공개</span>
						</label>
					</div>
					<div class="d-opts-section">
						<h3 class="d-opts-heading">댓글허용</h3>
						<label class="d-check-row">
							<input type="checkbox" class="d-checkbox" bind:checked={cafeScrap} />
							<span>카페·블로그 스크랩</span>
						</label>
						<label class="d-check-row">
							<input type="checkbox" class="d-checkbox" bind:checked={aiSave} />
							<span>AI·자동 저장</span>
						</label>
					</div>
					<div class="d-opts-section">
						<h3 class="d-opts-heading">기타</h3>
						<label class="d-check-row">
							<input type="checkbox" class="d-checkbox" bind:checked={autoSource} />
							<span>자동출처</span>
						</label>
						<label class="d-check-row">
							<input type="checkbox" class="d-checkbox" bind:checked={ccl} />
							<span>CCL</span>
						</label>
					</div>
				</div>
			</aside>
		</div>
	</div>
</div>

<style>
	/* ──────────────────────────────────────────────
	   MOBILE LAYOUT
	   ────────────────────────────────────────────── */
	.m-page {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--cs-lilac);
	}

	/* Mobile GNB */
	.m-gnb-wrap {
		padding: 40px 25px 0;
		flex-shrink: 0;
	}

	.m-gnb {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--cs-purple-op10);
		border-radius: var(--radius-lg);
		min-height: 60px;
		padding: 5px 20px;
	}

	.m-gnb-close {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		margin-left: -12px;
	}

	.m-gnb-title {
		font: var(--text-m-body-16B);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.m-gnb-logo {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 44px;
		min-height: 44px;
		margin-right: -12px;
	}

	/* Notice */
	.m-notice {
		padding: 40px 25px 20px;
	}

	.m-notice-title {
		font: var(--text-m-title-18B);
		color: var(--cs-text);
		margin: 0 0 12px;
		letter-spacing: -0.3px;
	}

	.m-notice-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.m-notice-list li {
		font: var(--text-m-script-14);
		color: var(--cs-text-mid);
		letter-spacing: -0.5px;
		line-height: 1.6;
	}

	.m-notice-list li::before {
		content: '•  ';
	}

	/* White card */
	.m-card {
		background: var(--cs-white);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		padding: 40px 25px 70px;
		display: flex;
		flex-direction: column;
		gap: 30px;
		flex: 1;
	}

	/* User info card */
	.m-user-card {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--cs-surface-gray);
		border-radius: var(--radius-lg);
		padding: 14px 16px;
	}

	.m-avatar {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--cs-purple) 0%, var(--cs-red-badge) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		font-weight: 900;
		color: var(--cs-white);
		flex-shrink: 0;
	}

	.m-user-info {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.m-user-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.m-user-name {
		font: var(--text-m-script-14B);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.m-user-badge {
		font-size: 11px;
		font-weight: 700;
		color: var(--cs-white);
		background: var(--cs-purple);
		padding: 2px 8px;
		border-radius: var(--radius-full);
	}

	.m-user-level {
		font-size: 11px;
		font-weight: 500;
		color: var(--cs-purple-light);
		background: var(--cs-purple-op10);
		padding: 2px 8px;
		border-radius: var(--radius-full);
	}

	.m-user-cert {
		font-size: 11px;
		color: #888888;
	}

	/* Content options */
	.m-content-options {
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--cs-surface-gray);
		border-radius: var(--radius-lg);
		padding: 20px;
	}

	.m-opts-heading {
		font-size: 13px;
		font-weight: 700;
		color: var(--cs-text);
		margin: 0;
		letter-spacing: -0.3px;
	}

	.m-check-row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		font-weight: 500;
		color: var(--cs-text-dark);
		cursor: pointer;
		min-height: 44px;
		letter-spacing: -0.3px;
	}

	.m-check-row input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--cs-purple-light);
		cursor: pointer;
		flex-shrink: 0;
	}

	.m-divider {
		height: 1px;
		background: rgba(0, 0, 0, 0.06);
	}

	/* Type select */
	.m-field-wrap {
		position: relative;
	}

	.m-select {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 44px;
		background: var(--cs-surface-gray);
		border: none;
		border-radius: var(--radius-md);
		padding: 10px 20px;
		cursor: pointer;
		text-align: left;
	}

	.m-select-label {
		font: var(--text-m-script-14B);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.m-select-label.m-placeholder {
		color: var(--cs-text-placeholder);
	}

	.m-select-arrow {
		flex-shrink: 0;
		transition: transform 0.2s;
		transform: rotate(90deg);
	}

	.m-select-arrow.m-arrow-open {
		transform: rotate(-90deg);
	}

	.m-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		background: var(--cs-white);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
		list-style: none;
		margin: 0;
		padding: 6px 0;
		z-index: 10;
		overflow: hidden;
	}

	.m-dropdown-item {
		display: block;
		width: 100%;
		padding: 10px 20px;
		background: none;
		border: none;
		font: var(--text-m-script-14);
		color: var(--cs-text);
		cursor: pointer;
		text-align: left;
		letter-spacing: -0.5px;
		min-height: 44px;
	}

	.m-dropdown-item:hover {
		background: rgba(59, 47, 138, 0.06);
	}

	.m-dropdown-item.m-dropdown-active {
		color: var(--cs-purple);
		font-weight: 700;
	}

	/* Text input */
	.m-input {
		display: block;
		width: 100%;
		min-height: 44px;
		background: var(--cs-surface-gray);
		border: none;
		border-radius: var(--radius-md);
		padding: 10px 20px;
		font: var(--text-m-script-14);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.m-input::placeholder {
		color: var(--cs-text-placeholder);
	}

	.m-input:focus {
		outline: 2px solid var(--cs-purple);
		outline-offset: -2px;
	}

	/* Editor box */
	.m-editor-box {
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.m-toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
		background: var(--cs-surface-gray);
		padding: 8px 12px;
		border-bottom: 1px solid var(--cs-border);
	}

	.m-tb-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}

	.m-tb-btn:hover {
		background: rgba(59, 47, 138, 0.08);
	}

	.m-textarea {
		min-height: 280px;
		background: var(--cs-surface-gray);
		border: none;
		padding: 16px 20px;
		font: var(--text-m-body-16L);
		color: var(--cs-text);
		resize: vertical;
		letter-spacing: -0.5px;
		line-height: 1.6;
		width: 100%;
		box-sizing: border-box;
	}

	.m-textarea::placeholder {
		color: var(--cs-text-placeholder);
	}

	.m-textarea:focus {
		outline: none;
	}

	/* Toggle options */
	.m-options {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.m-toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.m-toggle-label {
		font: var(--text-m-script-14);
		color: var(--cs-text-dark);
		letter-spacing: -0.5px;
	}

	.m-toggle {
		position: relative;
		width: 32px;
		height: 20px;
		flex-shrink: 0;
		background: var(--cs-text-dark);
		border: none;
		border-radius: 100px;
		cursor: pointer;
		padding: 3px;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		transition: background 0.2s;
		/* extend touch area */
		margin: -12px 0;
		padding-block: 12px;
		padding-inline: 3px;
		box-sizing: content-box;
	}

	.m-toggle.m-toggle-on {
		background: var(--cs-purple);
		justify-content: flex-end;
	}

	.m-toggle-thumb {
		width: 14px;
		height: 14px;
		background: var(--cs-white);
		border-radius: 50%;
		flex-shrink: 0;
	}

	.m-options-hint {
		font: var(--text-m-script-12);
		color: var(--cs-text-light);
		letter-spacing: -0.5px;
		margin: 0;
	}

	/* Submit button */
	.m-submit {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 15px;
		width: 100%;
		max-width: 340px;
		margin: 0 auto;
		padding: 15px 20px;
		background: var(--cs-text-dark);
		color: var(--cs-white);
		border: none;
		border-radius: var(--radius-xl);
		font: var(--text-m-body-16B);
		cursor: pointer;
		letter-spacing: -0.5px;
		min-height: 44px;
		transition: opacity 0.15s;
	}

	.m-submit:hover {
		opacity: 0.85;
	}

	.m-submit-r {
		transform: rotate(180deg) scaleY(-1);
	}

	/* ──────────────────────────────────────────────
	   PC LAYOUT (≥ 768px)
	   ────────────────────────────────────────────── */
	.d-page {
		display: none;
	}

	@media (min-width: 768px) {
		.m-page {
			display: none;
		}

		.d-page {
			display: block;
			background: var(--cs-lilac);
			min-height: 100vh;
			padding-top: var(--layout-header-h);
		}
	}

	.d-container {
		max-width: 1600px;
		margin: 0 auto;
		padding: 40px 40px 80px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	/* Notice bar */
	.d-notice {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 30px;
		background: rgba(255, 255, 255, 0.6);
		border-radius: 25px;
		padding: 20px 30px;
		flex-wrap: wrap;
	}

	.d-notice-title {
		font: var(--text-pc-title-18);
		color: var(--cs-text);
		margin: 0;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.d-notice-list {
		display: flex;
		flex-direction: row;
		gap: 24px;
		list-style: none;
		margin: 0;
		padding: 0;
		flex-wrap: wrap;
	}

	.d-notice-list li {
		font: var(--text-pc-body-14);
		color: var(--cs-text-mid);
		letter-spacing: -0.5px;
	}

	.d-notice-list li::before {
		content: '•  ';
	}

	/* Two columns */
	.d-columns {
		display: flex;
		flex-direction: row;
		gap: 24px;
		align-items: flex-start;
	}

	/* Editor card */
	.d-editor-card {
		flex: 1;
		background: var(--cs-white);
		border-radius: var(--radius-xl);
		padding: 40px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		min-width: 0;
	}

	/* Type select */
	.d-field-wrap {
		position: relative;
	}

	.d-select {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 44px;
		background: var(--cs-surface-gray);
		border: none;
		border-radius: var(--radius-md);
		padding: 10px 20px;
		cursor: pointer;
		text-align: left;
	}

	.d-select-label {
		font: var(--text-pc-body-14);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.d-select-label.d-placeholder {
		color: var(--cs-text-placeholder);
	}

	.d-select-arrow {
		flex-shrink: 0;
		transition: transform 0.2s;
		transform: rotate(90deg);
	}

	.d-select-arrow.d-arrow-open {
		transform: rotate(-90deg);
	}

	.d-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		background: var(--cs-white);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
		list-style: none;
		margin: 0;
		padding: 6px 0;
		z-index: 10;
		overflow: hidden;
	}

	.d-dropdown-item {
		display: block;
		width: 100%;
		padding: 10px 20px;
		background: none;
		border: none;
		font: var(--text-pc-body-14);
		color: var(--cs-text);
		cursor: pointer;
		text-align: left;
		letter-spacing: -0.5px;
		min-height: 44px;
	}

	.d-dropdown-item:hover {
		background: rgba(59, 47, 138, 0.06);
	}

	.d-dropdown-item.d-dropdown-active {
		color: var(--cs-purple);
		font-weight: 700;
	}

	/* Input */
	.d-input {
		display: block;
		width: 100%;
		min-height: 44px;
		background: var(--cs-surface-gray);
		border: none;
		border-radius: var(--radius-md);
		padding: 10px 20px;
		font: var(--text-pc-body-14);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.d-input::placeholder {
		color: var(--cs-text-placeholder);
	}

	.d-input:focus {
		outline: 2px solid var(--cs-purple);
		outline-offset: -2px;
	}

	/* Editor box */
	.d-editor-box {
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.d-toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--cs-surface-gray);
		padding: 8px 12px;
		border-bottom: 1px solid var(--cs-border);
	}

	.d-tb-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}

	.d-tb-btn:hover {
		background: rgba(59, 47, 138, 0.08);
	}

	.d-textarea {
		min-height: 280px;
		background: var(--cs-surface-gray);
		border: none;
		padding: 16px 20px;
		font: var(--text-pc-body-14);
		color: var(--cs-text);
		resize: vertical;
		letter-spacing: -0.5px;
		line-height: 1.6;
		width: 100%;
		box-sizing: border-box;
	}

	.d-textarea::placeholder {
		color: var(--cs-text-placeholder);
	}

	.d-textarea:focus {
		outline: none;
	}

	/* Submit */
	.d-submit {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 15px;
		width: 100%;
		padding: 15px 20px;
		background: var(--cs-text-dark);
		color: var(--cs-white);
		border: none;
		border-radius: var(--radius-xl);
		font: var(--text-pc-title-16);
		cursor: pointer;
		letter-spacing: -0.5px;
		min-height: 50px;
		transition: opacity 0.15s;
	}

	.d-submit:hover {
		opacity: 0.85;
	}

	.d-submit-r {
		transform: rotate(180deg) scaleY(-1);
	}

	/* Sidebar */
	.d-sidebar {
		width: 300px;
		flex-shrink: 0;
		position: sticky;
		top: calc(var(--layout-header-h) + 20px);
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	@media (min-width: 1280px) {
		.d-sidebar {
			width: 320px;
		}
	}

	/* User card */
	.d-user-card {
		background: var(--cs-white);
		border-radius: 25px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}

	.d-avatar {
		width: 100px;
		height: 100px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--cs-purple) 0%, var(--cs-red-badge) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 36px;
		font-weight: 900;
		color: var(--cs-white);
		font-family: 'Noto Sans KR', sans-serif;
		flex-shrink: 0;
	}

	.d-user-meta {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 100%;
	}

	.d-user-name-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.d-user-name {
		font: var(--text-pc-title-16);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.d-user-badge {
		background: var(--cs-purple);
		color: var(--cs-white);
		font: var(--text-pc-script-12);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--radius-full);
		white-space: nowrap;
	}

	.d-user-level {
		background: var(--cs-lilac);
		color: var(--cs-text-mid);
		font: var(--text-pc-script-12);
		padding: 3px 10px;
		border-radius: var(--radius-full);
	}

	.d-user-stats {
		display: flex;
		gap: 8px;
		width: 100%;
	}

	.d-stat-tile {
		flex: 1;
		background: var(--cs-surface-gray);
		border-radius: 12px;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.d-stat-label {
		font: var(--text-pc-script-12);
		color: var(--cs-text-mid);
	}

	.d-stat-value {
		font: var(--text-pc-title-16);
		color: var(--cs-text);
	}

	/* Options card */
	.d-options-card {
		background: var(--cs-white);
		border-radius: 25px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.d-opts-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.d-opts-section + .d-opts-section {
		border-top: 1px solid var(--cs-border);
		padding-top: 20px;
	}

	.d-opts-heading {
		font: var(--text-pc-body-14);
		color: var(--cs-text);
		margin: 0;
		letter-spacing: -0.5px;
	}

	.d-check-row {
		display: flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		min-height: 28px;
		font: var(--text-pc-script-12);
		color: var(--cs-text-mid);
		letter-spacing: -0.5px;
	}

	.d-checkbox {
		width: 16px;
		height: 16px;
		accent-color: var(--cs-purple);
		cursor: pointer;
		flex-shrink: 0;
	}
</style>
