<script lang="ts">
  // GSD-6: P2-1 고객 상세정보 패널 — get_chat_customer_detail RPC 응답 렌더링
  // 기존 5필드(이메일·회원코드·등급·크레이지스코어·블랙리스트) + 신규 필드(이름·전화·인증·구독·예약)

  interface ReservationItem {
    id: string
    status: string
    start_date: string | null
    end_date: string | null
    product_name: string | null
    created_at: string
  }

  interface CustomerDetail {
    profile: {
      name: string | null
      phone: string | null
      is_student: boolean | null
      is_foreign: boolean | null
      identity_type: string | null
      identity_verified_at: string | null
      identity_doc_url: string | null
      foreign_verified_at: string | null
      foreign_doc_url: string | null
    }
    subscription: {
      plan_name: string | null
    } | null
    reservations: ReservationItem[]
  }

  interface Props {
    detail: CustomerDetail | null
    isLoading?: boolean
    expanded?: boolean
    ontoggle?: () => void
  }

  let { detail, isLoading = false, expanded = false, ontoggle }: Props = $props()

  const STATUS_KO: Record<string, string> = {
    hold: '신청대기', confirmed: '승인완료', shipped: '반출중', in_use: '대여중',
    return_requested: '반납중', returned: '반납완료', completed: '완료', cancelled: '취소', expired: '만료',
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return '—'
    return iso.slice(0, 10)
  }
</script>

<div class="cdp" class:cdp--expanded={expanded}>
  <button class="cdp-toggle" onclick={ontoggle} aria-expanded={expanded} aria-label="고객 상세정보 {expanded ? '접기' : '펼치기'}">
    <span class="cdp-toggle-label">고객 상세정보</span>
    <svg class="cdp-chevron" class:rotated={expanded} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  {#if expanded}
    <div class="cdp-body">
      {#if isLoading}
        <div class="cdp-loading">불러오는 중...</div>
      {:else if !detail}
        <div class="cdp-empty">정보를 불러올 수 없습니다.</div>
      {:else}
        <!-- 이름·전화번호 -->
        <div class="cdp-row">
          <span class="cdp-key">이름</span>
          <span class="cdp-val">{detail.profile.name ?? '—'}</span>
        </div>
        <div class="cdp-row">
          <span class="cdp-key">전화번호</span>
          <span class="cdp-val">{detail.profile.phone ?? '—'}</span>
        </div>

        <!-- 학생 인증 -->
        {#if detail.profile.identity_type === 'student'}
          <div class="cdp-row">
            <span class="cdp-key">학생인증</span>
            <span class="cdp-val">
              {detail.profile.identity_verified_at ? `완료 (${fmtDate(detail.profile.identity_verified_at)})` : '미완료'}
            </span>
          </div>
        {/if}

        <!-- 외국인 인증 -->
        {#if detail.profile.is_foreign}
          <div class="cdp-row">
            <span class="cdp-key">외국인인증</span>
            <span class="cdp-val">
              {detail.profile.foreign_verified_at ? `완료 (${fmtDate(detail.profile.foreign_verified_at)})` : '미완료'}
            </span>
          </div>
        {/if}

        <!-- 멤버십 갱신일 -->
        <div class="cdp-row">
          <span class="cdp-key">멤버십</span>
          <span class="cdp-val">
            {#if detail.subscription}
              {detail.subscription.plan_name ?? '구독중'}
            {:else}
              미가입
            {/if}
          </span>
        </div>

        <!-- 최근 예약 목록 -->
        {#if detail.reservations.length > 0}
          <div class="cdp-section-label">최근 예약</div>
          <ul class="cdp-reserve-list">
            {#each detail.reservations as r (r.id)}
              <li class="cdp-reserve-item">
                <span class="cdp-reserve-status status-{r.status}">{STATUS_KO[r.status] ?? r.status}</span>
                <span class="cdp-reserve-product">{r.product_name ?? '상품 정보 없음'}</span>
                <span class="cdp-reserve-period">
                  {fmtDate(r.start_date)} ~ {fmtDate(r.end_date)}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="cdp-row">
            <span class="cdp-key">예약 내역</span>
            <span class="cdp-val">없음</span>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .cdp {
    border-top: 1px solid rgba(16, 11, 50, 0.06);
    flex-shrink: 0;
  }

  .cdp-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 24px;
    /* 상단 고객정보 헤더(--cs-purple-op10, 10%)보다 옅은 4% 톤 — cms-uiux.md 허용 예외
       하드코딩 범위(purple tint 0.04~0.12) 내 최저값, 같은 계열로 위계만 표시 */
    background: rgba(59, 47, 138, 0.04);
    border: none;
    cursor: pointer;
    font: 700 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid);
    letter-spacing: 0.2px;
    text-transform: uppercase;
    min-height: 36px;
    transition: background 0.12s;
  }
  /* 기본(4%)보다 두 단계(4%p씩) 짙은 12% 톤 — 허용 범위 상한과 일치, 클릭 가능 영역임을 명확히 표시 */
  .cdp-toggle:hover { background: rgba(59, 47, 138, 0.12); }

  .cdp-toggle-label { flex: 1; text-align: left; }

  .cdp-chevron {
    flex-shrink: 0;
    color: var(--cs-text-light);
    transition: transform 0.2s;
  }
  .cdp-chevron.rotated { transform: rotate(180deg); }

  .cdp-body {
    padding: 8px 24px 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    /* 펼침 영역도 토글 기본 배경과 동일한 4% 톤 — 하나의 카드처럼 이어지도록 통일 */
    background: rgba(59, 47, 138, 0.04);
    /* uiux-index.md CMS 카드 라운드값 "중" = 20px(var(--radius-lg)) — 하단 좌우 모서리만 */
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  }

  .cdp-loading, .cdp-empty {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light);
    padding: 4px 0;
  }

  .cdp-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .cdp-key {
    font: 700 11px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid);
    min-width: 64px;
    flex-shrink: 0;
  }

  .cdp-val {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    word-break: break-all;
  }

  .cdp-section-label {
    font: 700 10px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 6px;
  }

  .cdp-reserve-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cdp-reserve-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
  }

  .cdp-reserve-status {
    font: 700 10px/1 'Noto Sans KR', sans-serif;
    padding: 2px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* 대여 상태별 색상 (rental-lifecycle.md 기준) */
  .status-hold             { background: rgba(255,69,0,0.1);  color: var(--cs-orange); }
  .status-confirmed        { background: rgba(59,47,138,0.1); color: var(--cs-purple); }
  .status-shipped,
  .status-in_use           { background: rgba(46,204,113,0.1); color: #27ae60; }
  .status-return_requested { background: rgba(255,69,0,0.08); color: var(--cs-orange); }
  .status-returned,
  .status-completed        { background: rgba(16,11,50,0.06); color: var(--cs-text-mid); }
  .status-cancelled,
  .status-expired          { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  .cdp-reserve-product {
    font: 400 11px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cdp-reserve-period {
    font: 400 10px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light);
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
