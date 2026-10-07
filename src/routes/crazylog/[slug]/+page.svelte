<script lang="ts">
	import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { supabase } from '$lib/services/supabase'
	import type { PageData } from './$types'
	import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'
	import MobileMoreMenu from '$lib/components/common/MobileMoreMenu.svelte'
	import SubGnb from '$lib/components/common/SubGnb.svelte'
	import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
	import { makeEmptyTextBlock, type ContentBlock } from '$lib/types/content-editor'
	import { csToast } from '$lib/utils/toast'

	const LOG_TYPES = [
		'상품리뷰',
		'일상공유',
		'채널홍보',
	]

	interface Props {
		data: PageData
	}

	let { data }: Props = $props()

	const ep = data.existingPost
	const isEdit = !!ep

	// 에디터는 보이는 레이아웃(모바일/PC) 한쪽에만 마운트한다 — 문서 에디터 2개가 같은 blocks를 동시에 편집하지 않게
	let isMobile = $state<boolean | null>(null)
	let editorRef = $state<RichContentEditor | undefined>()

	// 임시저장(로컬) — 작성 중 탭 전환·새로고침으로 글이 사라지는 것을 막는다. 제출 성공 시 삭제.
	const draftKey = `crazylog-draft:${ep?.id ?? 'new'}`
	interface Draft {
		logType: string
		title: string
		blocks: ContentBlock[]
		keywords: string[]
		savedAt: number
	}
	let draft = $state<Draft | null>(null)
	let touched = $state(false)
	let submitted = false
	let draftTimer: ReturnType<typeof setTimeout> | undefined

	function markTouched() {
		touched = true
	}

	const initialKeywords = JSON.stringify((ep?.keywords as string[]) ?? [])
	$effect(() => {
		if (JSON.stringify(keywords) !== initialKeywords) touched = true
	})

	function readDraft(): Draft | null {
		try {
			const raw = localStorage.getItem(draftKey)
			if (!raw) return null
			const d = JSON.parse(raw) as Draft
			return d && Array.isArray(d.blocks) ? d : null
		} catch {
			return null
		}
	}

	function clearDraft() {
		try {
			localStorage.removeItem(draftKey)
		} catch { /* 저장소 접근 불가 — 무시 */ }
	}

	function restoreDraft() {
		if (!draft) return
		// 에디터가 아직 준비되지 않았으면 복원하지 않고 안내만 유지(제목만 복원되고 본문이 덮어써지는 것 방지)
		if (!editorRef?.setBlocks(draft.blocks)) {
			csToast.info('에디터를 불러오는 중이에요. 잠시 후 다시 눌러주세요.')
			return
		}
		logType = draft.logType
		title = draft.title
		keywords = [...draft.keywords]
		touched = true
		draft = null
	}

	function discardDraft() {
		clearDraft()
		draft = null
	}

	function formatSavedAt(ts: number): string {
		return new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
	}

	$effect(() => {
		// 변경을 감지할 값들(제목·타입·키워드·본문)
		const snapshot: Draft = { logType, title, blocks: $state.snapshot(blocks) as ContentBlock[], keywords: [...keywords], savedAt: Date.now() }
		if (!touched || submitted) return
		clearTimeout(draftTimer)
		draftTimer = setTimeout(() => {
			if (submitted) return
			try {
				localStorage.setItem(draftKey, JSON.stringify({ ...snapshot, savedAt: Date.now() }))
			} catch { /* 용량 초과·차단 — 임시저장 생략 */ }
		}, 800)
		return () => clearTimeout(draftTimer)
	})

	onMount(() => {
		document.body.classList.add('crazylog-write')

		const mq = window.matchMedia('(max-width: 767px)')
		isMobile = mq.matches
		const onMq = (e: MediaQueryListEvent) => (isMobile = e.matches)
		mq.addEventListener('change', onMq)

		const d = readDraft()
		if (d && (d.title || d.blocks.length > 0)) draft = d

		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (touched && !submitted) {
				e.preventDefault()
				e.returnValue = ''
			}
		}
		window.addEventListener('beforeunload', onBeforeUnload)

		return () => {
			document.body.classList.remove('crazylog-write')
			mq.removeEventListener('change', onMq)
			window.removeEventListener('beforeunload', onBeforeUnload)
			clearTimeout(draftTimer)
		}
	})

	// 폼 상태 (수정 모드 초기값 적용)
	let logType = $state((ep?.log_type as string) ?? '')
	let title = $state((ep?.title as string) ?? '')
	let blocks = $state<ContentBlock[]>(
		ep?.content_blocks && Array.isArray(ep.content_blocks) && (ep.content_blocks as ContentBlock[]).length > 0
			? (ep.content_blocks as ContentBlock[])
			: [makeEmptyTextBlock()]
	)
	let keywords = $state<string[]>((ep?.keywords as string[]) ?? [])
	let typeOpen = $state(false)
	let moreMenuOpen = $state(false)
	let isSubmitting = $state(false)
	let errorMsg = $state<string | null>(null)

	// 공개/허용 옵션
	let isPublic = $state((ep?.is_public as boolean) ?? true)
	let allowComments = $state((ep?.allow_comments as boolean) ?? true)
	let allowScrap = $state((ep?.allow_scrap as boolean) ?? true)
	let allowAiSave = $state((ep?.allow_ai_save as boolean) ?? true)
	let autoSource = $state((ep?.auto_source as boolean) ?? false)
	let cclEnabled = $state(ep?.ccl != null)

	// 유저 정보
	const avatarChar = data.profile.displayName[0] ?? '?'
	const avatarUrl = data.profile.avatarUrl
	// 프로필 사진 로드 실패(파일 삭제·일시 장애) 시 이니셜로 되돌린다
	let avatarFailed = $state(false)
	const membershipGrade = data.profile.membershipGrade
	const level = data.profile.level

	// 에디터 이미지 업로드 prefix — 일반 사용자는 'log/…' 경로만 업로드 가능(/api/cms/upload)
	const uploadPrefix = typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID
		? 'log/' + globalThis.crypto.randomUUID()
		: 'log/tmp'

	function selectType(t: string) {
		logType = t
		typeOpen = false
		markTouched()
	}

	async function handleSubmit() {
		errorMsg = null
		if (!logType) { errorMsg = '로그 타입을 선택해주세요.'; return }
		if (!title.trim()) { errorMsg = '제목을 입력해주세요.'; return }

		// 대기 중인 편집 내용을 반영하고 누락 여부를 점검 — 변경이 없으면 원본 블록을 그대로 쓴다(무변경 저장)
		const flushed = editorRef?.flush()
		if (flushed && !flushed.ok) {
			errorMsg = '본문을 저장 형식으로 변환하는 중 내용이 달라져 저장을 멈췄어요. 새로고침 후 다시 시도해주세요.'
			return
		}
		// link-entry 블록은 저장 대상에서 제외 (미완성 입력폼)
		const submitBlocks = (flushed?.blocks ?? blocks).filter(b => b.type !== 'link-entry')

		const hasImage = submitBlocks.some(
			b => b.type === 'image' && Array.isArray((b as { images?: { url: string }[] }).images) &&
				(b as { images: { url: string }[] }).images.some(img => img.url)
		)
		if (!hasImage) {
			errorMsg = '1개 이상 이미지를 등록하세요.'
			return
		}

		// Head 이미지 추출 (isHead=true인 첫 이미지 URL)
		type ImageItem = { url: string; alt: string; isHead?: boolean }
		type ImageBlockType = { type: 'image'; images: ImageItem[] }
		let headImageUrl: string | null = null
		for (const b of submitBlocks) {
			if (b.type !== 'image') continue
			const imgBlock = b as ImageBlockType
			const head = imgBlock.images.find(img => img.isHead && img.url)
			if (head) { headImageUrl = head.url; break }
		}

		isSubmitting = true
		submitted = true // 제출 중 임시저장 타이머가 되살아나지 않게

		try {
			if (isEdit) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { error } = await (supabase.rpc as any)('update_user_post', {
					p_id: ep!.id,
					p_log_type: logType,
					p_title: title.trim(),
					p_content_blocks: submitBlocks,
					p_keywords: keywords,
					p_tags: keywords,
					p_is_public: isPublic,
					p_allow_comments: allowComments,
					p_allow_scrap: allowScrap,
					p_allow_ai_save: allowAiSave,
					p_auto_source: autoSource,
					p_ccl: cclEnabled ? 'BY' : null,
					p_thumbnail_url: headImageUrl,
				})
				if (error) throw new Error((error as { message: string }).message)
			} else {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { error } = await (supabase.rpc as any)('create_user_post', {
					p_log_type: logType,
					p_title: title.trim(),
					p_content_blocks: submitBlocks,
					p_keywords: keywords,
					p_tags: keywords,
					p_is_public: isPublic,
					p_allow_comments: allowComments,
					p_allow_scrap: allowScrap,
					p_allow_ai_save: allowAiSave,
					p_auto_source: autoSource,
					p_ccl: cclEnabled ? 'BY' : null,
					p_thumbnail_url: headImageUrl,
				})
				if (error) throw new Error((error as { message: string }).message)
			}

			submitted = true
			clearDraft()
			await goto('/crazylog/list')
		} catch (e) {
			submitted = false
			errorMsg = e instanceof Error ? e.message : '등록 중 오류가 발생했습니다.'
		} finally {
			isSubmitting = false
		}
	}
</script>

<svelte:head>
  <style>
    @media (max-width: 767px) {
      body.crazylog-write .gnb-mobile-wrap,
      body.crazylog-write .gnb-desktop-wrap { display: none !important; }
      body.crazylog-write .fab-bar           { display: none !important; }
      body.crazylog-write .site-footer       { display: none !important; }
      body.crazylog-write .tab-bar           { display: none !important; } /* 키보드 위 도킹 툴바와 겹침 방지 */
    }
  </style>
</svelte:head>

{#snippet draftBanner()}
	{#if draft}
		<div class="draft-banner" role="status">
			<span class="draft-text">임시 저장된 글이 있어요 ({formatSavedAt(draft.savedAt)})</span>
			<span class="draft-actions">
				<button type="button" class="draft-btn draft-btn-on" onclick={restoreDraft}>복원</button>
				<button type="button" class="draft-btn" onclick={discardDraft}>삭제</button>
			</span>
		</div>
	{/if}
{/snippet}

<!-- ============================================================
     MOBILE LAYOUT
     ============================================================ -->
<div class="m-page">
	<!-- Mobile GNB (custom — replaces common GNB on mobile) -->
	<header class="m-gnb-wrap">
		<nav class="m-gnb">
			<button class="m-gnb-close" aria-label="닫기" onclick={() => history.back()}>
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
			<button class="m-gnb-ham" aria-label="더보기 메뉴" onclick={() => moreMenuOpen = true}>
				<svg width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
					<path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
					<path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
				</svg>
			</button>
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
			<div class="m-avatar">
				{#if avatarUrl && !avatarFailed}
					<img src={avatarUrl} alt={data.profile.displayName} class="m-avatar-img" onerror={() => (avatarFailed = true)} />
				{:else}
					{avatarChar}
				{/if}
			</div>
			<div class="m-user-info">
				<div class="m-user-row">
					<span class="m-user-name">{data.profile.displayName}</span>
					{#if membershipGrade && membershipGrade !== 'NONE'}
						<span class="m-user-badge">{membershipGrade}</span>
					{/if}
				</div>
				<div class="m-user-row">
					<span class="m-user-level">{level}</span>
					<span class="m-user-cert">콘텐츠 {data.stats.postCount}개{data.stats.postViewCount !== null ? ` · 조회 ${data.stats.postViewCount}` : ''}</span>
				</div>
			</div>
		</div>

		{#if draft}
			{@render draftBanner()}
		{/if}

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
				<ChevronIcon size={8} direction={typeOpen ? 'up' : 'down'} color="var(--cs-text-dark)" />
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
		<input class="m-input" type="text" placeholder="로그 제목" bind:value={title} oninput={markTouched} />

		<!-- Content editor (워드프로세서형 단일 문서 에디터) -->
		<div class="m-editor-box">
			{#if isMobile === true}
				<RichContentEditor bind:this={editorRef} bind:blocks bind:keywords {uploadPrefix} variant="user" placeholder="내용을 입력하세요" onchange={markTouched} />
			{/if}
		</div>

		<!-- Content options -->
		<!-- Options (toggles) -->
		<div class="m-options">
			<h3 class="m-opts-heading">공개설정</h3>
			<div class="m-toggle-row">
				<span class="m-toggle-label">보류 <span class="m-toggle-hint">(목록 숨김)</span></span>
				<button
					class="m-toggle m-toggle-hold"
					class:m-toggle-on={!isPublic}
					onclick={() => (isPublic = !isPublic)}
					role="switch"
					aria-checked={!isPublic}
					aria-label="보류 — 목록에서 숨김"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<div class="m-toggle-row">
				<span class="m-toggle-label">멤버공개</span>
				<button
					class="m-toggle"
					class:m-toggle-on={isPublic}
					onclick={() => (isPublic = !isPublic)}
					role="switch"
					aria-checked={isPublic}
					aria-label="멤버공개"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<div class="m-divider"></div>
			<h3 class="m-opts-heading">댓글허용</h3>
			<div class="m-toggle-row">
				<span class="m-toggle-label">댓글 허용</span>
				<button
					class="m-toggle"
					class:m-toggle-on={allowComments}
					onclick={() => (allowComments = !allowComments)}
					role="switch"
					aria-checked={allowComments}
					aria-label="댓글 허용"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<div class="m-toggle-row">
				<span class="m-toggle-label">카페·블로그 스크랩</span>
				<button
					class="m-toggle"
					class:m-toggle-on={allowScrap}
					onclick={() => (allowScrap = !allowScrap)}
					role="switch"
					aria-checked={allowScrap}
					aria-label="카페·블로그 스크랩 허용"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<div class="m-toggle-row">
				<span class="m-toggle-label">AI·자동 저장</span>
				<button
					class="m-toggle"
					class:m-toggle-on={allowAiSave}
					onclick={() => (allowAiSave = !allowAiSave)}
					role="switch"
					aria-checked={allowAiSave}
					aria-label="AI·자동 저장 허용"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<div class="m-divider"></div>
			<h3 class="m-opts-heading">기타</h3>
			<div class="m-toggle-row">
				<span class="m-toggle-label">자동출처</span>
				<button
					class="m-toggle"
					class:m-toggle-on={autoSource}
					onclick={() => (autoSource = !autoSource)}
					role="switch"
					aria-checked={autoSource}
					aria-label="자동출처 사용"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
			<div class="m-toggle-row">
				<span class="m-toggle-label">CCL</span>
				<button
					class="m-toggle"
					class:m-toggle-on={cclEnabled}
					onclick={() => (cclEnabled = !cclEnabled)}
					role="switch"
					aria-checked={cclEnabled}
					aria-label="CCL 사용"
				>
					<span class="m-toggle-thumb"></span>
				</button>
			</div>
		</div>

		{#if errorMsg}
			<p role="alert" class="m-error">{errorMsg}</p>
		{/if}

		<!-- Submit button -->
		<button class="m-submit" onclick={handleSubmit} disabled={isSubmitting}>
			<span>{isSubmitting ? '등록 중...' : isEdit ? '로그 수정' : '로그 등록'}</span>
		</button>
	</div>
</div>

<!-- ============================================================
     PC LAYOUT (≥ 768px)
     ============================================================ -->
<div class="d-page">
	<!-- PC sub-GNB — 전역 GNB가 /crazylog/* 에서 제외되므로 SubGnb 표준(noGnbOffset) 적용, 모바일은 자체 헤더 사용 -->
	<SubGnb title="로그 등록" pcOnly noGnbOffset />
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
				{#if draft}
					{@render draftBanner()}
				{/if}

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
						<ChevronIcon size={8} direction={typeOpen ? 'up' : 'down'} color="var(--cs-text-dark)" />
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
				<input class="d-input" type="text" placeholder="로그 제목" bind:value={title} oninput={markTouched} />

				<!-- Content editor (워드프로세서형 단일 문서 에디터) -->
				<div class="d-editor-box">
					{#if isMobile === false}
						<RichContentEditor bind:this={editorRef} bind:blocks bind:keywords {uploadPrefix} variant="user" placeholder="내용을 입력하세요" onchange={markTouched} />
					{/if}
				</div>

				<!-- Submit -->
				{#if errorMsg}
					<p role="alert" class="d-error">{errorMsg}</p>
				{/if}
				<button class="d-submit" onclick={handleSubmit} disabled={isSubmitting}>
					<span>{isSubmitting ? '등록 중...' : isEdit ? '로그 수정' : '로그 등록'}</span>
				</button>
			</div>

			<!-- RIGHT: Sidebar -->
			<aside class="d-sidebar">
				<!-- User info card -->
				<div class="d-user-card">
					<div class="d-avatar">
						{#if avatarUrl && !avatarFailed}
							<img src={avatarUrl} alt={data.profile.displayName} class="d-avatar-img" onerror={() => (avatarFailed = true)} />
						{:else}
							{avatarChar}
						{/if}
					</div>
					<div class="d-user-meta">
						<div class="d-user-name-row">
							<span class="d-user-name">{data.profile.displayName}</span>
							{#if membershipGrade && membershipGrade !== 'NONE'}
								<span class="d-user-badge">{membershipGrade}</span>
							{/if}
							<span class="d-user-level">{level}</span>
						</div>
					</div>
					<div class="d-user-stats">
						<div class="d-stat-tile">
							<span class="d-stat-label">로그</span>
							<span class="d-stat-value">{data.stats.postCount}</span>
						</div>
						{#if data.stats.postViewCount !== null}
						<div class="d-stat-tile">
							<span class="d-stat-label">조회</span>
							<span class="d-stat-value">{data.stats.postViewCount}</span>
						</div>
						{/if}
					</div>
				</div>

				<!-- Content options card -->
				<div class="d-options-card">
					<div class="d-opts-section">
						<h3 class="d-opts-heading">공개설정</h3>
						<div class="d-opt-row">
							<span class="d-opt-label" class:d-hold-active={!isPublic}>보류 <span class="m-toggle-hint">(목록 숨김)</span></span>
							<button
								class="m-toggle m-toggle-hold"
								class:m-toggle-on={!isPublic}
								onclick={() => (isPublic = !isPublic)}
								role="switch"
								aria-checked={!isPublic}
								aria-label="보류 — 목록에서 숨김"
							>
								<span class="m-toggle-thumb"></span>
							</button>
						</div>
						<div class="d-opt-row">
							<span class="d-opt-label">멤버공개</span>
							<button
								class="m-toggle"
								class:m-toggle-on={isPublic}
								onclick={() => (isPublic = !isPublic)}
								role="switch"
								aria-checked={isPublic}
								aria-label="멤버공개"
							>
								<span class="m-toggle-thumb"></span>
							</button>
						</div>
					</div>
					<div class="d-opts-section">
						<h3 class="d-opts-heading">댓글허용</h3>
						<div class="d-opt-row">
							<span class="d-opt-label">댓글 허용</span>
							<button
								class="m-toggle"
								class:m-toggle-on={allowComments}
								onclick={() => (allowComments = !allowComments)}
								role="switch"
								aria-checked={allowComments}
								aria-label="댓글 허용"
							>
								<span class="m-toggle-thumb"></span>
							</button>
						</div>
						<div class="d-opt-row">
							<span class="d-opt-label">카페·블로그 스크랩</span>
							<button
								class="m-toggle"
								class:m-toggle-on={allowScrap}
								onclick={() => (allowScrap = !allowScrap)}
								role="switch"
								aria-checked={allowScrap}
								aria-label="카페·블로그 스크랩 허용"
							>
								<span class="m-toggle-thumb"></span>
							</button>
						</div>
						<div class="d-opt-row">
							<span class="d-opt-label">AI·자동 저장</span>
							<button
								class="m-toggle"
								class:m-toggle-on={allowAiSave}
								onclick={() => (allowAiSave = !allowAiSave)}
								role="switch"
								aria-checked={allowAiSave}
								aria-label="AI·자동 저장 허용"
							>
								<span class="m-toggle-thumb"></span>
							</button>
						</div>
					</div>
					<div class="d-opts-section">
						<h3 class="d-opts-heading">기타</h3>
						<div class="d-opt-row">
							<span class="d-opt-label">자동출처</span>
							<button
								class="m-toggle"
								class:m-toggle-on={autoSource}
								onclick={() => (autoSource = !autoSource)}
								role="switch"
								aria-checked={autoSource}
								aria-label="자동출처 사용"
							>
								<span class="m-toggle-thumb"></span>
							</button>
						</div>
						<div class="d-opt-row">
							<span class="d-opt-label">CCL</span>
							<button
								class="m-toggle"
								class:m-toggle-on={cclEnabled}
								onclick={() => (cclEnabled = !cclEnabled)}
								role="switch"
								aria-checked={cclEnabled}
								aria-label="CCL 사용"
							>
								<span class="m-toggle-thumb"></span>
							</button>
						</div>
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
		min-height: 100dvh; /* 100vh 툴바 재계산 잔떨림 방지 — 되돌리지 말 것(front-uiux §19) */
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

	.m-gnb-ham {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
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
		padding: 15px 18px;
	}

	.m-avatar {
		width: 53px;
		height: 53px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--cs-purple) 0%, var(--cs-red-badge) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 21px;
		font-weight: 900;
		color: var(--cs-white);
		flex-shrink: 0;
		overflow: hidden;
	}
	.m-avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 50%;
	}

	.m-user-info {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}

	.m-user-row {
		display: contents;
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
		font: var(--text-m-script-12);
		color: #888888;
	}

	/* Content options */
	.m-opts-heading {
		font: var(--text-m-title-18B);
		color: var(--cs-text);
		margin: 0;
		letter-spacing: -0.3px;
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
		padding: 11px 22px;
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
		padding: 11px 22px;
		font: var(--text-m-body-16B);
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

	/* 임시저장 복원 안내 */
	.draft-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		border-radius: var(--radius-md);
		background: var(--cs-purple-op10);
	}
	.draft-text {
		font: var(--text-pc-body-14);
		font-weight: 700;
		color: var(--cs-purple);
	}
	.draft-actions { display: flex; gap: 6px; flex-shrink: 0; }
	.draft-btn {
		min-height: 44px;
		min-width: 44px;
		padding: 0 14px;
		border: none;
		border-radius: var(--radius-full);
		background: var(--cs-white);
		color: var(--cs-text);
		font: var(--text-pc-script-12);
		font-weight: 700;
		cursor: pointer;
		transition: background 0.12s;
	}
	.draft-btn:hover { background: var(--cs-lilac); }
	.draft-btn-on { background: var(--cs-purple); color: var(--cs-white); }
	.draft-btn-on:hover { background: var(--cs-purple-hover); }

	.m-editor-box {
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		overflow: clip; /* hidden은 내부 sticky 툴바를 무력화 */
	}

	/* Toggle options */
	.m-options {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--cs-surface-gray);
		border-radius: var(--radius-lg);
		padding: 16px 20px;
	}

	.m-options .m-opts-heading {
		margin: 8px 0 4px;
	}

	.m-options .m-opts-heading:first-child {
		margin-top: 0;
	}

	.m-options .m-divider {
		margin: 8px 0;
	}

	.m-toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 44px;
	}

	.m-toggle-label {
		font: var(--text-m-body-16B);
		color: var(--cs-text-mid);
		letter-spacing: -0.5px;
	}

	.m-toggle-hint {
		font: var(--text-m-script-12);
		color: var(--cs-text-light);
	}

	.m-toggle-hold.m-toggle-on {
		background: var(--cs-orange);
	}

	.m-toggle {
		position: relative;
		width: 36px;
		height: 20px;
		flex-shrink: 0;
		background: var(--cs-disabled-toggle);
		border: none;
		border-radius: 100px;
		cursor: pointer;
		padding: 2px;
		transition: background 0.2s;
		box-sizing: border-box;
	}

	.m-toggle.m-toggle-on {
		background: var(--cs-purple);
	}

	.m-toggle.m-toggle-on .m-toggle-thumb {
		transform: translateX(16px);
	}

	.m-toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		background: var(--cs-white);
		border-radius: 50%;
		transition: transform 0.2s;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
	}


	/* Submit button */
	.m-submit {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 15px;
		width: 100%;
		margin: 0 auto;
		padding: 17px 22px;
		background: var(--cs-text-dark);
		color: var(--cs-white);
		border: none;
		border-radius: var(--radius-xl);
		font: var(--text-m-title-18B);
		cursor: pointer;
		letter-spacing: -0.5px;
		min-height: 44px;
		transition: opacity 0.15s;
	}

	.m-submit:hover:not(:disabled) {
		opacity: 0.85;
	}

	.m-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.m-error {
		font: var(--text-m-script-12);
		color: var(--cs-red);
		margin: 0;
		letter-spacing: -0.3px;
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
			min-height: 100dvh; /* 100vh 툴바 재계산 잔떨림 방지 — 되돌리지 말 것(front-uiux §19) */
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
		flex: 4 1 0;
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
		padding: 11px 22px;
		cursor: pointer;
		text-align: left;
	}

	.d-select-label {
		font: var(--text-pc-title-16);
		color: var(--cs-text);
		letter-spacing: -0.5px;
	}

	.d-select-label.d-placeholder {
		color: var(--cs-text-placeholder);
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
		padding: 11px 22px;
		font: var(--text-pc-title-18);
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
		overflow: clip; /* hidden은 내부 sticky 툴바를 무력화 */
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
		font: var(--text-pc-title-18);
		cursor: pointer;
		letter-spacing: -0.5px;
		min-height: 50px;
		transition: opacity 0.15s;
	}

	.d-submit:hover:not(:disabled) {
		opacity: 0.85;
	}

	.d-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.d-error {
		font: var(--text-pc-script-12);
		color: var(--cs-red);
		margin: 0;
		letter-spacing: -0.3px;
	}

	/* Sidebar — 8:2 비율 (flex: 1 = 20%) */
	.d-sidebar {
		flex: 1 0 0;
		min-width: 220px;
		max-width: 340px;
		position: sticky;
		top: 20px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* User card */
	.d-user-card {
		background: var(--cs-white);
		border-radius: 25px;
		padding: 20px 16px;
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
		overflow: hidden;
	}
	.d-avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 50%;
	}

	.d-user-meta {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
	}

	.d-user-name-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.d-user-name {
		font: var(--text-pc-title-18);
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
		font: var(--text-pc-body-14);
		color: var(--cs-text-mid);
		text-align: center;
		word-break: keep-all;
	}

	.d-stat-value {
		font: var(--text-pc-title-18);
		color: var(--cs-text);
	}

	/* Options card */
	.d-options-card {
		background: var(--cs-white);
		border-radius: 25px;
		padding: 20px 16px;
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

	.d-opt-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 36px;
	}

	.d-opt-label {
		font: var(--text-pc-script-12);
		color: var(--cs-text-mid);
		letter-spacing: -0.3px;
		transition: color 0.2s;
	}

	.d-opt-label.d-hold-active {
		color: var(--cs-orange);
		font-weight: 700;
	}
</style>

<MobileMoreMenu open={moreMenuOpen} onclose={() => moreMenuOpen = false} />
<BottomTabBar />
