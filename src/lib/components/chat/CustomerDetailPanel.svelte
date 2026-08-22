<script lang="ts">
  // GSD-6: P2-1 고객 상세정보 패널 — get_chat_customer_detail RPC 응답 렌더링
  // 기존 5필드(이메일·회원코드·등급·크레이지스코어·블랙리스트) + 신규 필드(이름·전화·인증·구독·예약)
  //
  // 채팅 대화 영역 우측에 겹쳐 노출되는 상시 카드로 전환 — 이전에는 chat-header 하단의
  // 접기/펼치기 스트립이었으나, 이제 대화 목록 영역(chat-messages) 내부 우측에 플로팅으로
  // 노출된다. 헤더 customer-strip에 있던 등급·크레이지스코어·블랙리스트 배지도 여기로 이동해
  // 함께 렌더링 — 읽기전용 표시 전용(수정·삭제 폼 없음).
  //
  // 스타일은 RentalDetailPanel.svelte(대여상세패널)의 패널헤더·섹션타이틀·info-section/info-row
  // 패턴을 그대로 반영해 CMS 디테일 패널 공통 톤앤매너로 통일한다.

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

  interface CustomerSummary {
    user_id: string
    email: string | null
    member_code: string | null
    membership_grade: string | null
    credit_score: number | null
    blacklisted: boolean
  }

  interface Props {
    detail: CustomerDetail | null
    summary?: CustomerSummary | null
    isLoading?: boolean
  }

  let { detail, summary = null, isLoading = false }: Props = $props()

  const STATUS_KO: Record<string, string> = {
    hold: '신청대기', confirmed: '계약완료', shipped: '반출중', in_use: '대여중',
    return_requested: '반납중', returned: '반납완료', completed: '완료', cancelled: '취소', expired: '만료',
  }

  const GRADE_LABEL: Record<string, string> = {
    none: 'NONE', easy: 'EASY', pop: 'POP', crazy: 'CRAZY', admin: 'ADMIN',
  }

  function scoreClass(score: number): string {
    if (score >= 85) return 'score-high'
    if (score >= 70) return 'score-mid'
    if (score >= 50) return 'score-low'
    return 'score-critical'
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return '—'
    return iso.slice(0, 10)
  }
</script>

<div class="cdp">
  <div class="panel-body">
    {#if isLoading}
      <div class="cdp-loading">불러오는 중...</div>
    {:else if !detail && !summary}
      <div class="cdp-empty">정보를 불러올 수 없습니다.</div>
    {:else}
      <!-- 기본정보 -->
      <div class="section-title">기본정보</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">이름</span>
          <span class="info-value fw-bold">{detail?.profile.name ?? '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">아이디</span>
          <span class="info-value">{summary?.email ?? '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">전화번호</span>
          <span class="info-value">{detail?.profile.phone ?? '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">회원코드</span>
          <span class="info-value mono">{summary?.member_code ?? '—'}</span>
        </div>
        {#if summary?.membership_grade || summary?.blacklisted}
          <div class="info-row">
            <span class="info-label">등급</span>
            <span class="info-value">
              {#if summary?.membership_grade}
                <span class="panel-status grade-{summary.membership_grade}">
                  {GRADE_LABEL[summary.membership_grade] ?? summary.membership_grade.toUpperCase()}
                </span>
              {/if}
              {#if summary?.blacklisted}
                <span class="badge-danger">블랙리스트</span>
              {/if}
            </span>
          </div>
        {/if}
        <div class="info-row">
          <span class="info-label">크레이지스코어</span>
          <span class="info-value">
            {#if summary?.credit_score !== null && summary?.credit_score !== undefined}
              <span class="cs-score {scoreClass(summary.credit_score)}">{summary.credit_score}점</span>
            {:else}
              —
            {/if}
          </span>
        </div>
      </div>

      <!-- 본인 인증 (학생·외국인 중 하나라도 해당될 때만) -->
      {#if detail?.profile.identity_type === 'student' || detail?.profile.is_foreign}
        <div class="section-title">본인 인증</div>
        <div class="info-section">
          {#if detail?.profile.identity_type === 'student'}
            <div class="info-row">
              <span class="info-label">학생인증</span>
              <span class="info-value">
                {detail.profile.identity_verified_at ? `완료 (${fmtDate(detail.profile.identity_verified_at)})` : '미완료'}
              </span>
            </div>
          {/if}
          {#if detail?.profile.is_foreign}
            <div class="info-row">
              <span class="info-label">외국인인증</span>
              <span class="info-value">
                {detail.profile.foreign_verified_at ? `완료 (${fmtDate(detail.profile.foreign_verified_at)})` : '미완료'}
              </span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 멤버십 -->
      <div class="section-title">멤버십</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">구독 상태</span>
          <span class="info-value">
            {#if detail?.subscription}
              {detail.subscription.plan_name ?? '구독중'}
            {:else}
              미가입
            {/if}
          </span>
        </div>
      </div>

      <!-- 최근 예약 -->
      <div class="section-title">최근 예약</div>
      {#if detail && detail.reservations.length > 0}
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
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">예약 내역</span>
            <span class="info-value">없음</span>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .cdp {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* 등급 배지 — RentalDetailPanel.svelte .panel-status 반영 (기본정보 섹션 내 값으로 사용) */
  .panel-status {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
  }
  .panel-status.grade-none  { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .panel-status.grade-easy  { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .panel-status.grade-pop   { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }
  .panel-status.grade-crazy { background: rgba(255,69,0,0.12);    color: var(--cs-orange); }
  .panel-status.grade-admin { background: var(--cs-lilac);        color: var(--cs-purple-dark); }

  .badge-danger {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    background: rgba(255,53,53,0.10);
    color: var(--cs-red-badge);
  }

  /* 패널 바디 — RentalDetailPanel.svelte .panel-body 반영 */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px 20px;
    display: block;
  }
  .panel-body > * + * {
    margin-top: 10px;
  }

  .cdp-loading, .cdp-empty {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light);
    padding: 4px 0;
  }

  /* 섹션 타이틀 — RentalDetailPanel.svelte .section-title 반영 */
  .section-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    padding: 4px 0 2px;
  }

  /* 정보 섹션 — RentalDetailPanel.svelte .info-section/.info-row 반영 */
  .info-section {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .info-row {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    gap: 12px;
  }
  .info-row:last-child { border-bottom: none; }

  .info-label {
    flex: 0 0 96px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: 700;
  }
  .info-value {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    word-break: break-all;
  }
  .mono    { font-family: monospace; }
  .fw-bold { font-weight: 700; }

  .cs-score {
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .cs-score.score-high     { color: var(--cs-success-light); }
  .cs-score.score-mid      { color: var(--cs-text-mid); }
  .cs-score.score-low      { color: var(--cs-warning); }
  .cs-score.score-critical { color: var(--cs-red-badge); }

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
