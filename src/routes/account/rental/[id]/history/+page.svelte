<script lang="ts">
  /**
   * /account/rental/[id]/history — 고객 반납 이력 등록 화면
   * Q3 확정: window.open(_blank)으로 열리는 별도 창
   * UI 레퍼런스: /cms/mobile/[id] 이력 탭 패턴 적용
   * Svelte 5 Runes 전용 — Svelte 4 문법 금지
   */
  import type { PageData } from './$types'
  import type { CustomerHistoryRecord, CustomerHistoryImage } from './+page.server'
  import { resizeProductImage } from '$lib/utils/imageResize'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // ── 상태 ────────────────────────────────────────────────────
  // ⚠️ core-rules.md: $state(prop) 초기화 금지 — data.history가 바뀌어도(재검증 등)
  // 이 값이 갱신되도록 $effect로 동기화 (클라이언트에서 직접 갱신하는 refreshHistory()와도 호환)
  let records = $state<CustomerHistoryRecord[]>(data.history)
  $effect(() => {
    records = data.history
  })
  let isLoading = $state(false)
  let globalError = $state<string | null>(null)

  // 신규 이력 폼 상태
  let showNewForm = $state(false)
  let newImages = $state<CustomerHistoryImage[]>([])
  let isUploading = $state(false)
  let isSaving = $state(false)
  let newError = $state<string | null>(null)

  // 편집 상태
  let editingId = $state<string | null>(null)
  let editImages = $state<CustomerHistoryImage[]>([])
  let editDate = $state('')
  let isEditUploading = $state(false)
  let isEditSaving = $state(false)
  let editError = $state<string | null>(null)

  // 삭제 확인 상태
  let deleteConfirmId = $state<string | null>(null)
  let isDeleting = $state(false)

  // 카메라 input refs
  let newCameraEl = $state<HTMLInputElement | null>(null)
  let editCameraEl = $state<HTMLInputElement | null>(null)

  let reservationId = $derived(data.rental.id)

  // Stephen 확정(2026-08-15): 예약 상태에 따라 등록/조회/차단 3단계로 화면 동작 분기
  //   예정(in_use·return_requested)  → 등록 가능
  //   지난(returned·completed)       → 조회만(등록·수정·삭제 불가)
  //   취소·이상(cancelled·damage_claimed) → 완전 차단 + 안내 문구
  const REGISTERABLE_STATUSES = new Set(['in_use', 'return_requested'])
  const BLOCKED_STATUSES = new Set(['cancelled', 'damage_claimed'])
  let canRegister = $derived(REGISTERABLE_STATUSES.has(data.rental.status))
  let isBlocked = $derived(BLOCKED_STATUSES.has(data.rental.status))

  // ── 유틸 ────────────────────────────────────────────────────
  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function todayStr(): string {
    return new Date().toISOString().slice(0, 10)
  }

  // ── 이력 새로고침 ─────────────────────────────────────────────
  async function refreshHistory(): Promise<void> {
    isLoading = true
    globalError = null
    try {
      const res = await fetch(`/api/account/rental/${reservationId}/history`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        globalError = (err as { message?: string }).message ?? '이력 로드 실패'
        return
      }
      const json = await res.json() as { records: CustomerHistoryRecord[] }
      records = json.records
    } catch {
      globalError = '이력을 불러오는 데 실패했습니다.'
    } finally {
      isLoading = false
    }
  }

  // ── 이미지 업로드 (신규) ─────────────────────────────────────
  async function uploadNewImage(file: File): Promise<void> {
    if (newImages.length >= 20) {
      newError = '이미지는 최대 20장까지 등록할 수 있습니다.'
      return
    }
    isUploading = true
    newError = null
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch(`/api/account/rental/${reservationId}/history/upload`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        newError = (err as { message?: string }).message ?? '이미지 업로드 실패'
        return
      }
      const result = await res.json() as { thumbUrl: string; largeUrl: string }
      newImages = [...newImages, {
        url:           result.largeUrl,
        thumb_url:     result.thumbUrl,
        comment:       '',
        display_order: newImages.length,
      }]
    } catch {
      newError = '이미지 업로드 중 오류가 발생했습니다.'
    } finally {
      isUploading = false
    }
  }

  function handleNewCamera(e: Event): void {
    const files = (e.target as HTMLInputElement).files
    if (files?.length) void uploadNewImage(files[0])
    ;(e.target as HTMLInputElement).value = ''
  }

  function updateNewComment(idx: number, val: string): void {
    newImages = newImages.map((img, i) =>
      i === idx ? { ...img, comment: val.slice(0, 50) } : img
    )
  }

  function removeNewImage(idx: number): void {
    newImages = newImages.filter((_, i) => i !== idx)
      .map((img, i) => ({ ...img, display_order: i }))
  }

  // ── 이력 저장 (신규) ─────────────────────────────────────────
  async function saveNew(): Promise<void> {
    if (newImages.length === 0) {
      newError = '이미지를 1장 이상 등록해주세요.'
      return
    }
    isSaving = true
    newError = null
    try {
      const res = await fetch(`/api/account/rental/${reservationId}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recorded_date: todayStr(),
          images: newImages,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        newError = (err as { message?: string }).message ?? '저장 실패'
        return
      }
      showNewForm = false
      newImages = []
      await refreshHistory()
    } catch {
      newError = '저장 중 오류가 발생했습니다.'
    } finally {
      isSaving = false
    }
  }

  function cancelNew(): void {
    showNewForm = false
    newImages = []
    newError = null
  }

  // ── 편집 시작 ─────────────────────────────────────────────────
  function startEdit(record: CustomerHistoryRecord): void {
    editingId = record.id
    editImages = [...record.images]
    editDate = record.recorded_date
    editError = null
  }

  function cancelEdit(): void {
    editingId = null
    editImages = []
    editDate = ''
    editError = null
  }

  // ── 이미지 업로드 (편집) ──────────────────────────────────────
  async function uploadEditImage(file: File): Promise<void> {
    if (editImages.length >= 20) {
      editError = '이미지는 최대 20장까지 등록할 수 있습니다.'
      return
    }
    isEditUploading = true
    editError = null
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch(`/api/account/rental/${reservationId}/history/upload`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        editError = (err as { message?: string }).message ?? '이미지 업로드 실패'
        return
      }
      const result = await res.json() as { thumbUrl: string; largeUrl: string }
      editImages = [...editImages, {
        url:           result.largeUrl,
        thumb_url:     result.thumbUrl,
        comment:       '',
        display_order: editImages.length,
      }]
    } catch {
      editError = '이미지 업로드 중 오류가 발생했습니다.'
    } finally {
      isEditUploading = false
    }
  }

  function handleEditCamera(e: Event): void {
    const files = (e.target as HTMLInputElement).files
    if (files?.length) void uploadEditImage(files[0])
    ;(e.target as HTMLInputElement).value = ''
  }

  function updateEditComment(idx: number, val: string): void {
    editImages = editImages.map((img, i) =>
      i === idx ? { ...img, comment: val.slice(0, 50) } : img
    )
  }

  function removeEditImage(idx: number): void {
    editImages = editImages.filter((_, i) => i !== idx)
      .map((img, i) => ({ ...img, display_order: i }))
  }

  // ── 이력 수정 저장 ────────────────────────────────────────────
  async function saveEdit(): Promise<void> {
    if (!editingId) return
    if (editImages.length === 0) {
      editError = '이미지를 1장 이상 등록해주세요.'
      return
    }
    isEditSaving = true
    editError = null
    try {
      const res = await fetch(`/api/account/rental/${reservationId}/history`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:            editingId,
          recorded_date: editDate,
          images:        editImages,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        editError = (err as { message?: string }).message ?? '수정 실패'
        return
      }
      editingId = null
      editImages = []
      await refreshHistory()
    } catch {
      editError = '수정 중 오류가 발생했습니다.'
    } finally {
      isEditSaving = false
    }
  }

  // ── 삭제 ─────────────────────────────────────────────────────
  async function deleteRecord(id: string): Promise<void> {
    isDeleting = true
    globalError = null
    try {
      const res = await fetch(
        `/api/account/rental/${reservationId}/history?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        globalError = (err as { message?: string }).message ?? '삭제 실패'
        return
      }
      deleteConfirmId = null
      await refreshHistory()
    } catch {
      globalError = '삭제 중 오류가 발생했습니다.'
    } finally {
      isDeleting = false
    }
  }
</script>

<svelte:head>
  <title>반납 이력 등록 — 크레이지샷</title>
</svelte:head>

<div class="page-wrap">
  <!-- 최소 헤더 (back + title) — Q3 확정: 별도 창이므로 GNB/BottomTabBar 없음 -->
  <header class="page-header">
    <button
      type="button"
      class="back-btn"
      onclick={() => window.close()}
      aria-label="창 닫기"
    >‹</button>
    <span class="page-title">반납 이력 등록</span>
  </header>

  <div class="content">

    <!-- 예약 정보 카드 -->
    <div class="rental-card">
      {#if data.rental.product_name}
        <p class="product-name">{data.rental.product_name}</p>
      {/if}
      {#if data.rental.reservation_code}
        <p class="reservation-code">{data.rental.reservation_code}</p>
      {/if}
      <div class="date-row">
        <span class="date-label">대여기간</span>
        <span class="date-value">
          {formatDate(data.rental.start_date)} ~ {formatDate(data.rental.end_date)}
        </span>
      </div>
    </div>

    {#if isBlocked}
      <div class="status-banner status-banner--blocked" role="status">
        이 예약은 반납 이력을 등록할 수 없는 상태입니다.
      </div>
    {:else if !canRegister}
      <div class="status-banner" role="status">
        반납이 완료된 예약입니다. 등록된 이력만 확인할 수 있습니다.
      </div>
    {/if}

    {#if globalError}
      <div class="global-error" role="alert">{globalError}</div>
    {/if}

    <!-- 이력 목록 -->
    {#if isLoading}
      <div class="loading-state" aria-label="로딩 중">
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
      </div>
    {:else if records.length === 0 && !showNewForm}
      <div class="empty-state">
        <p class="empty-msg">{canRegister ? '상품이력을 등록해주세요.' : '등록된 이력이 없습니다.'}</p>
        {#if canRegister}
          <p class="empty-sub">반납 전 상품 상태 사진을 등록하면<br>분쟁 발생 시 증거로 활용됩니다.</p>
        {/if}
      </div>
    {:else}
      <div class="record-list">
        {#each records as record (record.id)}
          <div class="record-card">
            {#if editingId === record.id}
              <!-- 편집 폼 -->
              <div class="edit-form">
                <p class="form-label">사진 수정</p>
                <div class="thumb-grid">
                  {#each editImages as img, idx (img.url)}
                    <div class="thumb-wrap">
                      <img
                        src={img.thumb_url || img.url}
                        alt="이력 이미지 {idx + 1}"
                        class="thumb-img"
                        width="80"
                        height="80"
                        loading="lazy"
                      />
                      <div class="thumb-actions">
                        <input
                          type="text"
                          class="comment-input"
                          placeholder="코멘트 (최대 50자)"
                          maxlength="50"
                          value={img.comment}
                          oninput={(e) => updateEditComment(idx, (e.target as HTMLInputElement).value)}
                          aria-label="이미지 {idx + 1} 코멘트"
                        />
                        <button
                          type="button"
                          class="remove-btn"
                          onclick={() => removeEditImage(idx)}
                          aria-label="이미지 {idx + 1} 삭제"
                        >✕</button>
                      </div>
                    </div>
                  {/each}
                  {#if editImages.length < 20}
                    <button
                      type="button"
                      class="add-photo-btn"
                      onclick={() => editCameraEl?.click()}
                      disabled={isEditUploading}
                      aria-label="사진 추가"
                    >
                      {#if isEditUploading}
                        <span class="uploading-dot"></span>
                      {:else}
                        <span class="plus-icon">+</span>
                        <span class="add-label">사진 추가</span>
                      {/if}
                    </button>
                  {/if}
                </div>
                <input
                  bind:this={editCameraEl}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style="display:none"
                  onchange={handleEditCamera}
                  aria-hidden="true"
                />
                {#if editError}
                  <p class="form-error" role="alert">{editError}</p>
                {/if}
                <div class="form-btns">
                  <button
                    type="button"
                    class="btn-cancel"
                    onclick={cancelEdit}
                    disabled={isEditSaving}
                  >취소</button>
                  <button
                    type="button"
                    class="btn-save"
                    onclick={saveEdit}
                    disabled={isEditSaving || isEditUploading || editImages.length === 0}
                  >
                    {isEditSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            {:else}
              <!-- 이력 카드 뷰 -->
              <div class="record-header">
                <span class="record-date">{formatDate(record.recorded_date)}</span>
                {#if canRegister && record.registered_by === 'customer'}
                  <div class="record-actions">
                    <button
                      type="button"
                      class="action-btn"
                      onclick={() => startEdit(record)}
                      aria-label="이력 수정"
                    >수정</button>
                    <button
                      type="button"
                      class="action-btn action-btn--delete"
                      onclick={() => { deleteConfirmId = record.id }}
                      aria-label="이력 삭제"
                    >삭제</button>
                  </div>
                {/if}
              </div>
              {#if record.images.length > 0}
                <div class="record-thumbs">
                  {#each record.images as img, idx (img.url)}
                    <div class="record-thumb-wrap">
                      <img
                        src={img.thumb_url || img.url}
                        alt="이력 이미지 {idx + 1}"
                        class="record-thumb"
                        width="80"
                        height="80"
                        loading="lazy"
                      />
                      {#if img.comment}
                        <p class="record-comment">{img.comment}</p>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="no-images">이미지 없음</p>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- 신규 이력 등록 폼 -->
    {#if showNewForm}
      <div class="new-form-wrap">
        <p class="form-label">오늘({todayStr()}) 상품 상태 사진 등록</p>
        <div class="thumb-grid">
          {#each newImages as img, idx (img.url)}
            <div class="thumb-wrap">
              <img
                src={img.thumb_url || img.url}
                alt="신규 이미지 {idx + 1}"
                class="thumb-img"
                width="80"
                height="80"
                loading="lazy"
              />
              <div class="thumb-actions">
                <input
                  type="text"
                  class="comment-input"
                  placeholder="코멘트 (최대 50자)"
                  maxlength="50"
                  value={img.comment}
                  oninput={(e) => updateNewComment(idx, (e.target as HTMLInputElement).value)}
                  aria-label="이미지 {idx + 1} 코멘트"
                />
                <button
                  type="button"
                  class="remove-btn"
                  onclick={() => removeNewImage(idx)}
                  aria-label="이미지 {idx + 1} 제거"
                >✕</button>
              </div>
            </div>
          {/each}
          {#if newImages.length < 20}
            <button
              type="button"
              class="add-photo-btn"
              onclick={() => newCameraEl?.click()}
              disabled={isUploading}
              aria-label="사진 추가"
            >
              {#if isUploading}
                <span class="uploading-dot"></span>
              {:else}
                <span class="plus-icon">+</span>
                <span class="add-label">카메라</span>
              {/if}
            </button>
          {/if}
        </div>
        <input
          bind:this={newCameraEl}
          type="file"
          accept="image/*"
          capture="environment"
          style="display:none"
          onchange={handleNewCamera}
          aria-hidden="true"
        />
        {#if newError}
          <p class="form-error" role="alert">{newError}</p>
        {/if}
        <div class="form-btns">
          <button
            type="button"
            class="btn-cancel"
            onclick={cancelNew}
            disabled={isSaving}
          >취소</button>
          <button
            type="button"
            class="btn-save"
            onclick={saveNew}
            disabled={isSaving || isUploading || newImages.length === 0}
          >
            {isSaving ? '저장 중...' : '이력 등록'}
          </button>
        </div>
      </div>
    {/if}

    <!-- 삭제 확인 다이얼로그 -->
    {#if deleteConfirmId}
      <div class="confirm-overlay" role="dialog" aria-modal="true" aria-label="삭제 확인">
        <div class="confirm-box">
          <p class="confirm-msg">이 이력을 삭제할까요?<br>삭제 후 복원이 불가합니다.</p>
          <div class="confirm-btns">
            <button
              type="button"
              class="btn-cancel"
              onclick={() => { deleteConfirmId = null }}
              disabled={isDeleting}
            >취소</button>
            <button
              type="button"
              class="btn-danger"
              onclick={() => deleteConfirmId && deleteRecord(deleteConfirmId)}
              disabled={isDeleting}
            >
              {isDeleting ? '삭제 중...' : '삭제'}
            </button>
          </div>
        </div>
      </div>
    {/if}

  </div><!-- .content -->

  <!-- 하단 CTA 버튼 (이력 등록 폼이 열려 있지 않을 때 + 등록 가능 상태일 때만) -->
  {#if canRegister && !showNewForm && editingId === null}
    <div class="bottom-cta">
      <button
        type="button"
        class="btn-cta"
        onclick={() => { showNewForm = true; newImages = []; newError = null }}
      >
        이력 등록하기
      </button>
    </div>
  {/if}
</div>

<style>
  /* ── 레이아웃 ─────────────────────────────────────────────── */
  .page-wrap {
    min-height: 100dvh;
    background: var(--cs-lilac, #ECEBF4);
    display: flex;
    flex-direction: column;
    max-width: 480px;
    margin: 0 auto;
    padding-bottom: 80px;
  }

  /* ── 헤더 ────────────────────────────────────────────────── */
  .page-header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--cs-dark, #100B32);
    color: #fff;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    height: 56px;
    min-height: 56px;
  }

  .back-btn {
    background: none;
    border: none;
    color: #fff;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 8px;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md, 15px);
    transition: background 0.15s;
  }

  .back-btn:hover {
    background: rgba(255,255,255,0.1);
  }

  .page-title {
    font: 700 16px/1 'Noto Sans KR', sans-serif;
    color: #fff;
  }

  /* ── 컨텐츠 ──────────────────────────────────────────────── */
  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }

  /* ── 예약 카드 ───────────────────────────────────────────── */
  .rental-card {
    background: #fff;
    border-radius: var(--radius-xl, 30px);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .product-name {
    font: 700 16px/1.3 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    margin: 0;
  }

  .reservation-code {
    font: 400 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  .date-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .date-label {
    font: 400 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
  }

  .date-value {
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
  }

  /* ── 상태 안내 배너(조회전용/차단) ────────────────────────── */
  .status-banner {
    background: var(--cs-surface-gray, #f6f6f6);
    color: var(--cs-text-mid, #777777);
    border-radius: var(--radius-md, 15px);
    padding: 12px 16px;
    font: 400 13px/1.5 'Noto Sans KR', sans-serif;
  }
  .status-banner--blocked {
    background: rgba(207, 0, 0, 0.08);
    color: var(--cs-error, #CF0000);
  }

  /* ── 글로벌 에러 ─────────────────────────────────────────── */
  .global-error {
    background: rgba(207, 0, 0, 0.1);
    color: var(--cs-error, #CF0000);
    border-radius: var(--radius-md, 15px);
    padding: 12px 16px;
    font: 400 13px/1.5 'Noto Sans KR', sans-serif;
  }

  /* ── 로딩 ─────────────────────────────────────────────────── */
  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px;
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cs-purple, #3B2F8A);
    animation: bounce 1.2s infinite ease-in-out;
  }

  .loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .loading-dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%           { transform: scale(1);   opacity: 1;   }
  }

  /* ── 빈 상태 ─────────────────────────────────────────────── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    gap: 8px;
  }

  .empty-msg {
    font: 700 16px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    margin: 0;
  }

  .empty-sub {
    font: 400 13px/1.6 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  /* ── 이력 목록 ───────────────────────────────────────────── */
  .record-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .record-card {
    background: #fff;
    border-radius: var(--radius-xl, 30px);
    padding: 16px 20px;
  }

  .record-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .record-date {
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
  }

  .record-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    background: none;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    padding: 4px 12px;
    min-height: 30px;
    font: 400 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    transition: background 0.15s;
  }

  .action-btn:hover {
    background: var(--cs-lilac, #ECEBF4);
  }

  .action-btn--delete {
    color: var(--cs-error, #CF0000);
    border-color: rgba(207, 0, 0, 0.2);
  }

  .action-btn--delete:hover {
    background: rgba(207, 0, 0, 0.06);
  }

  .record-thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .record-thumb-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 80px;
  }

  .record-thumb {
    width: 80px;
    height: 80px;
    border-radius: var(--radius-sm, 8px);
    object-fit: cover;
  }

  .record-comment {
    font: 400 11px/1.3 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
    word-break: break-word;
  }

  .no-images {
    font: 400 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  /* ── 폼 공통 ─────────────────────────────────────────────── */
  .form-label {
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    margin: 0 0 12px;
  }

  .thumb-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }

  .thumb-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 80px;
  }

  .thumb-img {
    width: 80px;
    height: 80px;
    border-radius: var(--radius-sm, 8px);
    object-fit: cover;
  }

  .thumb-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .comment-input {
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: 6px;
    font: 400 11px/1.3 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    background: var(--cs-surface-gray, #f6f6f6);
    box-sizing: border-box;
  }

  .comment-input:focus {
    outline: none;
    border-color: var(--cs-purple, #3B2F8A);
  }

  .remove-btn {
    background: rgba(207, 0, 0, 0.1);
    border: none;
    border-radius: 6px;
    color: var(--cs-error, #CF0000);
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    padding: 4px;
    cursor: pointer;
    min-height: 22px;
    transition: background 0.15s;
  }

  .remove-btn:hover {
    background: rgba(207, 0, 0, 0.18);
  }

  .add-photo-btn {
    width: 80px;
    height: 80px;
    border: 2px dashed var(--cs-purple, #3B2F8A);
    border-radius: var(--radius-sm, 8px);
    background: rgba(59, 47, 138, 0.04);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .add-photo-btn:hover:not(:disabled) {
    background: rgba(59, 47, 138, 0.1);
  }

  .add-photo-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .plus-icon {
    font-size: 24px;
    color: var(--cs-purple, #3B2F8A);
    line-height: 1;
  }

  .add-label {
    font: 400 10px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-purple, #3B2F8A);
  }

  .uploading-dot {
    width: 20px;
    height: 20px;
    border: 2px solid var(--cs-purple, #3B2F8A);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .form-error {
    font: 400 12px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-error, #CF0000);
    margin: 0 0 8px;
  }

  .form-btns {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* ── 버튼 ─────────────────────────────────────────────────── */
  .btn-cancel {
    background: #fff;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-md, 15px);
    padding: 0 20px;
    min-height: 44px;
    font: 400 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-cancel:hover:not(:disabled) {
    background: var(--cs-lilac, #ECEBF4);
  }

  .btn-save {
    background: var(--cs-purple, #3B2F8A);
    border: none;
    border-radius: var(--radius-md, 15px);
    padding: 0 24px;
    min-height: 44px;
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: #fff;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .btn-save:hover:not(:disabled) {
    filter: brightness(0.9);
  }

  .btn-save:disabled,
  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger {
    background: var(--cs-error, #CF0000);
    border: none;
    border-radius: var(--radius-md, 15px);
    padding: 0 24px;
    min-height: 44px;
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: #fff;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .btn-danger:hover:not(:disabled) {
    filter: brightness(0.9);
  }

  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── 신규 폼 ─────────────────────────────────────────────── */
  .new-form-wrap {
    background: #fff;
    border-radius: var(--radius-xl, 30px);
    padding: 20px;
  }

  /* ── 편집 폼 ─────────────────────────────────────────────── */
  .edit-form {
    padding: 4px 0;
  }

  /* ── 삭제 확인 오버레이 ──────────────────────────────────── */
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }

  .confirm-box {
    background: #fff;
    border-radius: var(--radius-xl, 30px);
    padding: 28px 24px;
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .confirm-msg {
    font: 400 15px/1.6 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    margin: 0;
    text-align: center;
  }

  .confirm-btns {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  /* ── 하단 CTA ─────────────────────────────────────────────── */
  .bottom-cta {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    padding: 16px;
    background: linear-gradient(to top, var(--cs-lilac, #ECEBF4) 60%, transparent);
    box-sizing: border-box;
  }

  .btn-cta {
    width: 100%;
    background: var(--cs-purple, #3B2F8A);
    border: none;
    border-radius: var(--radius-xl, 30px);
    min-height: 52px;
    font: 700 16px/1 'Noto Sans KR', sans-serif;
    color: #fff;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .btn-cta:hover {
    filter: brightness(0.9);
  }
</style>
