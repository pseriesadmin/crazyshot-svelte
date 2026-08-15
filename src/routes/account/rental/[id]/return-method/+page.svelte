<script lang="ts">
  /**
   * /account/rental/[id]/return-method — 고객 반납 방법 선택 화면
   * window.open(_blank)으로 열리는 별도 창
   * UI: /account/rental/[id]/history와 동일한 최소 헤더 패턴
   *     반납 방법 선택 = front-uiux.md §16 콤보 버튼 표준
   * Svelte 5 Runes 전용 — Svelte 4 문법 금지
   */
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // ── 반납 방법 선택지 ──────────────────────────────────────────
  const RETURN_METHOD_OPTIONS: { value: string; label: string; sub?: string }[] = [
    { value: 'visit',         label: '방문 반납',    sub: '본점 직접 반납' },
    { value: 'epost',         label: '택배',          sub: '일반 택배 발송' },
    { value: 'quick',         label: '당일퀵',        sub: '당일 퀵 배송' },
    { value: 'crazydelivery', label: '크레이지샷 배송', sub: '수거 서비스 이용' },
    { value: 'locker',        label: '무인 보관함',   sub: '보관함 반납' },
  ]

  // ── 상태 ────────────────────────────────────────────────────
  let selectedMethod = $state<string>('')
  let isSaving = $state(false)
  let saveError = $state<string | null>(null)
  let saveSuccess = $state(false)

  $effect(() => {
    selectedMethod = data.rental.return_method ?? ''
  })

  let reservationId = $derived(data.rental.id)

  // ── 유틸 ────────────────────────────────────────────────────
  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function methodLabel(value: string | null): string {
    if (!value) return '-'
    return RETURN_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? value
  }

  // ── 저장 ─────────────────────────────────────────────────────
  async function saveMethod(): Promise<void> {
    if (!selectedMethod) {
      saveError = '반납 방법을 선택해주세요.'
      return
    }
    if (selectedMethod === data.rental.return_method) {
      // 변경 없음 — 창 닫기
      window.close()
      return
    }

    isSaving = true
    saveError = null
    try {
      const res = await fetch(`/api/chat/return-method/${reservationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_method: selectedMethod }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        saveError = (err as { message?: string }).message ?? '저장 중 오류가 발생했습니다.'
        return
      }
      saveSuccess = true
      // 1초 후 창 닫기 (성공 메시지 확인 후)
      setTimeout(() => window.close(), 1200)
    } catch {
      saveError = '저장 중 오류가 발생했습니다.'
    } finally {
      isSaving = false
    }
  }
</script>

<svelte:head>
  <title>반납 방법 선택 — 크레이지샷</title>
</svelte:head>

<div class="page-wrap">
  <!-- 최소 헤더 — /account/rental/[id]/history 와 동일 패턴 -->
  <header class="page-header">
    <button
      type="button"
      class="back-btn"
      onclick={() => window.close()}
      aria-label="창 닫기"
    >‹</button>
    <span class="page-title">반납 방법 선택</span>
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
      {#if data.rental.return_method}
        <div class="date-row">
          <span class="date-label">현재 반납 방법</span>
          <span class="date-value method-chip">{methodLabel(data.rental.return_method)}</span>
        </div>
      {/if}
    </div>

    {#if data.isLocked}
      <!-- 변경 불가 안내 -->
      <div class="locked-banner" role="status">
        <p class="locked-title">반납 방법을 변경할 수 없습니다</p>
        <p class="locked-desc">이미 처리 중인 반납이라 변경할 수 없습니다.<br>반납 방법 변경이 필요하면 상담채팅을 이용해주세요.</p>
      </div>

    {:else}
      <!-- 반납 방법 선택 — front-uiux.md §16 콤보 버튼 표준 -->
      <div class="section">
        <p class="section-label">반납 방법을 선택해주세요</p>
        <div class="combo-group" role="radiogroup" aria-label="반납 방법">
          {#each RETURN_METHOD_OPTIONS as option (option.value)}
            <button
              type="button"
              class="combo-btn"
              class:selected={selectedMethod === option.value}
              onclick={() => { selectedMethod = option.value; saveError = null }}
              role="radio"
              aria-checked={selectedMethod === option.value}
              aria-label={option.label}
            >
              <span class="combo-label">{option.label}</span>
              {#if option.sub}
                <span class="combo-sub">{option.sub}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      {#if saveError}
        <p class="save-error" role="alert">{saveError}</p>
      {/if}

      {#if saveSuccess}
        <div class="save-success" role="status">
          반납 방법이 저장됐습니다. 잠시 후 창이 닫힙니다.
        </div>
      {/if}
    {/if}

  </div><!-- .content -->

  <!-- 하단 CTA (변경 가능 상태이고 성공 전일 때만) -->
  {#if !data.isLocked && !saveSuccess}
    <div class="bottom-cta">
      <button
        type="button"
        class="btn-cta"
        onclick={saveMethod}
        disabled={isSaving || !selectedMethod}
      >
        {isSaving ? '저장 중...' : '반납 방법 확인'}
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
    padding-bottom: 100px;
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
    background: rgba(255, 255, 255, 0.1);
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
    white-space: nowrap;
  }

  .date-value {
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
  }

  .method-chip {
    background: var(--cs-lilac, #ECEBF4);
    border-radius: 20px;
    padding: 3px 10px;
    font: 700 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-purple, #3B2F8A);
  }

  /* ── 잠금 안내 배너 ─────────────────────────────────────── */
  .locked-banner {
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-xl, 30px);
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .locked-title {
    font: 700 15px/1.3 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    margin: 0;
  }

  .locked-desc {
    font: 400 13px/1.6 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  /* ── 선택 섹션 ───────────────────────────────────────────── */
  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-label {
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    margin: 0;
    padding: 0 4px;
  }

  /* ── 콤보 버튼 그룹 — front-uiux.md §16 ─────────────────── */
  .combo-group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .combo-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 9px 16px;
    border: 1.5px solid #DCDCDC;
    border-radius: var(--radius-xl, 30px);
    background: #fff;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    min-height: 44px;
  }

  .combo-btn.selected {
    background: var(--cs-purple, #3B2F8A);
    border-color: var(--cs-purple, #3B2F8A);
  }

  .combo-btn:hover:not(.selected) {
    border-color: var(--cs-purple, #3B2F8A);
    background: rgba(59, 47, 138, 0.04);
  }

  .combo-label {
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
  }

  .combo-btn.selected .combo-label {
    color: #fff;
  }

  .combo-sub {
    font: 400 11px/1.3 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
  }

  .combo-btn.selected .combo-sub {
    color: rgba(255, 255, 255, 0.8);
  }

  /* ── 에러 / 성공 ─────────────────────────────────────────── */
  .save-error {
    font: 400 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-error, #CF0000);
    margin: 0;
    padding: 0 4px;
  }

  .save-success {
    background: rgba(46, 204, 113, 0.12);
    color: #1a8a4a;
    border-radius: var(--radius-md, 15px);
    padding: 14px 20px;
    font: 700 14px/1.4 'Noto Sans KR', sans-serif;
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

  .btn-cta:hover:not(:disabled) {
    filter: brightness(0.9);
  }

  .btn-cta:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
