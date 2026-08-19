<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import type { Coupon } from '$lib/types/database'

  interface Props {
    coupon:  Coupon
    onclose: () => void
    // 어느 목록 탭에서 이 패널을 열었는지 — Stephen 확정(2026-08-18): 발행관리(manage)와
    // 사용량리포트(report)에서 동일한 '배포' 탭을 중복 노출하는 게 불필요하다고 판단,
    // manage에서는 기존 배포 실행 폼을 그대로 유지하고, report에서는 그 자리를
    // '사용 채번 목록'으로 완전히 대체한다(조건부 3번째 탭 추가 방식은 반려됨).
    context: 'manage' | 'report'
  }
  let { coupon, onclose, context }: Props = $props()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cc = coupon as any

  // report 컨텍스트는 '정보'도 발행관리 탭 패널과 중복이라 판단(Stephen 확정,
  // 2026-08-18) — 탭 자체를 없애고 '사용 채번 목록' 단독 뷰만 보여준다.
  let activeTab = $state<'info' | 'distribute' | 'redemptions'>(context === 'report' ? 'redemptions' : 'info')

  // ─ 사용 채번 목록 (report 컨텍스트 전용, 지연 로드) ─
  // 랜딩 대상은 RentalDetailPanel(/cms/reservation 또는 /cms/rentals, migration 301) —
  // "이 쿠폰이 결제된 정확한 예약"이 아니라 그 사용자의 가장 최근 예약(대여 정보 확인
  // 목적). 서버가 user_id 기준으로 조회하므로 같은 사용자가 쿠폰을 중복 사용해도 항상
  // 정확히 그 사용자로 연결된다. 예약이 하나도 없으면 cmsPath/reservationId가 null.
  interface RedemptionRow {
    userCouponId:  string
    userId:        string
    redeemedCode:  string | null
    usedAt:        string
    userName:      string | null
    userEmail:     string | null
    reservationId: number | null
    cmsPath:       string | null
  }
  let redemptions        = $state<RedemptionRow[]>([])
  let redemptionsLoaded  = $state(false)
  let redemptionsLoading = $state(false)

  async function loadRedemptions() {
    if (redemptionsLoaded || redemptionsLoading) return
    redemptionsLoading = true
    try {
      const res = await fetch(`/api/cms/coupons/${coupon.id}/redemptions`)
      if (res.ok) {
        const body = await res.json()
        redemptions = (body.redemptions ?? []) as RedemptionRow[]
      }
    } finally {
      redemptionsLoading = false
      redemptionsLoaded = true
    }
  }

  function selectTab(tab: typeof activeTab) {
    activeTab = tab
    if (tab === 'redemptions') loadRedemptions()
  }

  // report 컨텍스트는 탭 버튼(클릭)이 없으므로 마운트 시 바로 로드
  $effect(() => {
    if (context === 'report') loadRedemptions()
  })

  function formatDateTime(iso: string): string {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // ─ 핵심 정보 수정 ─
  let u_discount_type   = $state<string>(coupon.discount_type)
  let u_discount_value  = $state(coupon.discount_value)
  let u_max_discount    = $state(cc.max_discount_amount ?? 0)
  let u_usage_limit     = $state(coupon.usage_limit ?? 0)
  let u_user_grade      = $state(cc.user_grade_required ?? '')
  let u_validity_type   = $state<'fixed_period' | 'unlimited'>(cc.validity_type ?? 'fixed_period')
  let u_valid_from      = $state(coupon.valid_from ? coupon.valid_from.substring(0, 10) : '')
  let u_valid_until     = $state(coupon.valid_until ? coupon.valid_until.substring(0, 10) : '')
  let updateLoading     = $state(false)

  // coupon prop 변경 시(invalidateAll 후) 편집 필드 재동기화 — ProductDetailPanel $effect 패턴 동일
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ccEff = coupon as any
    u_discount_type  = coupon.discount_type
    u_discount_value = coupon.discount_value
    u_max_discount   = ccEff.max_discount_amount ?? 0
    u_usage_limit    = coupon.usage_limit ?? 0
    u_user_grade     = ccEff.user_grade_required ?? ''
    u_validity_type  = ccEff.validity_type ?? 'fixed_period'
    u_valid_from     = coupon.valid_from  ? coupon.valid_from.substring(0, 10)  : ''
    u_valid_until    = coupon.valid_until ? coupon.valid_until.substring(0, 10) : ''
  })

  // ─ 배포 대상 ─
  let distTargetT  = $state<'all' | 'grade' | 'specific_user'>('all')
  let distGrade    = $state('')
  let distUuids    = $state('')
  let distLoading  = $state(false)

  let distTargetMeta = $derived(
    distTargetT === 'grade'
      ? JSON.stringify({ grade: distGrade })
      : distTargetT === 'specific_user' && distUuids.trim()
        ? JSON.stringify({ user_ids: distUuids.split('\n').map((s: string) => s.trim()).filter(Boolean) })
        : null
  )

  function typeLabel(type: string): string {
    const MAP: Record<string, string> = {
      fixed: '정액', percent: '정률', free_delivery: '무료배송',
      first_rental: '첫렌탈', category: '카테고리', bundle: '번들',
      subscription: '구독전용', student: '학생전용', walk_in: '방문픽업',
      reactivation: '휴면복귀', referral: '추천인', event: '이벤트', all: '전체',
    }
    return MAP[type] ?? type
  }

  // +page.svelte codeDisplay()와 동일 규칙 — sequenced 모드는 code가 NULL이므로
  // code_series 패턴 프리뷰로 대체 표시(목록·헤더 표기 일관성)
  function codeDisplay(c: { code: string | null; code_mode?: string; code_series?: { prefix?: string; category_code?: string } | null }): string {
    if (c.code) return c.code
    if (c.code_mode === 'sequenced' && c.code_series) {
      const prefix = c.code_series.prefix ?? 'CS'
      const cat = c.code_series.category_code ?? ''
      return `${prefix}${cat}*`
    }
    return '—'
  }
</script>

<div class="panel">
  <!-- 패널 헤더 -->
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-label">쿠폰</span>
      <span class="panel-id">{codeDisplay(coupon)}</span>
      <span class="panel-status">{typeLabel(coupon.type)}</span>
    </div>
    <button class="close-btn" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  <!-- 탭 — manage 컨텍스트에서만 노출(정보+배포, 기존 그대로). report 컨텍스트는 '정보'도
       발행관리 패널과 중복이라 판단해 탭 자체를 없애고 '사용 채번 목록' 단독 뷰만 표시
       (Stephen 확정, 2026-08-18). -->
  {#if context === 'manage'}
    <div class="panel-tabs" role="tablist">
      {#each [{ id: 'info', label: '정보' }, { id: 'distribute', label: '배포' }] as tab}
        <button
          class="tab"
          class:tab-active={activeTab === tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onclick={() => selectTab(tab.id as typeof activeTab)}
        >{tab.label}</button>
      {/each}
    </div>
  {/if}

  <!-- 탭 바디 -->
  <div class="panel-body">

    <!-- ─── 탭1: 정보 ─── -->
    {#if activeTab === 'info'}
      <div class="section-title">현황</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">사용/한도</span>
          <span class="info-value">{coupon.usage_count} / {coupon.usage_limit ?? '∞'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">상태</span>
          <span class="info-value">{coupon.is_active ? '활성' : '비활성'}</span>
        </div>
      </div>

      <div class="section-title">핵심 정보 수정</div>
      <form method="POST" action="?/updateCoupon"
        use:enhance={() => {
          updateLoading = true
          return async ({ result, update }) => {
            updateLoading = false
            if (result.type === 'success') csToast.success('저장되었습니다.')
            await update()
          }
        }}
      >
        <input type="hidden" name="id" value={coupon.id} />
        <div class="form-grid">
          <div class="form-field">
            <label for="uc-dtype">할인 방식</label>
            <select id="uc-dtype" name="discount_type" class="f-input" bind:value={u_discount_type}>
              <option value="fixed">정액 (원)</option>
              <option value="percent">정률 (%)</option>
              <option value="free_shipping">무료배송</option>
            </select>
          </div>
          <div class="form-field">
            <label for="uc-dval">할인값</label>
            <input id="uc-dval" name="discount_value" type="number" min="0"
              class="f-input" bind:value={u_discount_value} />
          </div>
          {#if u_discount_type === 'percent'}
            <div class="form-field">
              <label for="uc-maxd">최대 할인 한도 (원, 0=무제한)</label>
              <input id="uc-maxd" name="max_discount_amount" type="number" min="0"
                class="f-input" bind:value={u_max_discount} />
            </div>
          {/if}
          <div class="form-field">
            <label for="uc-tul">전체 발급 한도 (0=무제한)</label>
            <input id="uc-tul" name="usage_limit" type="number" min="0"
              class="f-input" bind:value={u_usage_limit} />
          </div>
          <div class="form-field">
            <label for="uc-grade">필수 회원 등급 (선택)</label>
            <select id="uc-grade" name="user_grade_required" class="f-input" bind:value={u_user_grade}>
              <option value="">전체 회원</option>
              <option value="BASIC">BASIC</option>
              <option value="PRO">PRO</option>
              <option value="CRAZY">CRAZY</option>
            </select>
          </div>
        </div>
        <div class="radio-group">
          <label class="radio-lbl">
            <input type="radio" name="validity_type" value="fixed_period" bind:group={u_validity_type} />
            제한 기간
          </label>
          <label class="radio-lbl">
            <input type="radio" name="validity_type" value="unlimited" bind:group={u_validity_type} />
            무제한
          </label>
        </div>
        {#if u_validity_type === 'fixed_period'}
          <div class="form-grid">
            <div class="form-field">
              <label for="uc-vf">시작일</label>
              <CmsDatePicker bind:value={u_valid_from} name="valid_from" placeholder="시작일 선택" disablePast={false} />
            </div>
            <div class="form-field">
              <label for="uc-vu">종료일</label>
              <CmsDatePicker bind:value={u_valid_until} name="valid_until" placeholder="종료일 선택" disablePast={false} />
            </div>
          </div>
        {/if}
        <div class="panel-actions">
          <button type="submit" class="btn-primary" disabled={updateLoading}>
            {updateLoading ? '저장 중...' : '정보 저장'}
          </button>
        </div>
      </form>

    <!-- ─── 탭2: 배포 ─── -->
    {:else if activeTab === 'distribute'}
      <div class="section-title">배포 대상</div>
      <form method="POST" action="?/distributeCoupon"
        use:enhance={() => {
          distLoading = true
          return async ({ result, update }) => {
            distLoading = false
            if (result.type === 'success') csToast.success('배포되었습니다.')
            await update()
          }
        }}
      >
        <input type="hidden" name="coupon_id" value={coupon.id} />
        <div class="radio-group">
          <label class="radio-lbl">
            <input type="radio" bind:group={distTargetT} value="all" />
            전체 회원
          </label>
          <label class="radio-lbl">
            <input type="radio" bind:group={distTargetT} value="grade" />
            특정 등급
          </label>
          <label class="radio-lbl">
            <input type="radio" bind:group={distTargetT} value="specific_user" />
            특정 사용자 UUID
          </label>
        </div>
        {#if distTargetT === 'grade'}
          <div class="form-field">
            <label for="dist-grade">등급</label>
            <select id="dist-grade" class="f-input" bind:value={distGrade}>
              <option value="BASIC">BASIC</option>
              <option value="PRO">PRO</option>
              <option value="CRAZY">CRAZY</option>
            </select>
          </div>
        {/if}
        {#if distTargetT === 'specific_user'}
          <div class="form-field">
            <label for="dist-uuids">사용자 이메일 또는 UUID (줄바꿈 구분)</label>
            <textarea id="dist-uuids" class="f-input ta" rows="4"
              placeholder="user@example.com&#10;uuid-1234-..." bind:value={distUuids}></textarea>
            <span class="hint">이메일과 UUID를 섞어서 입력할 수 있습니다.</span>
          </div>
        {/if}
        <input type="hidden" name="target_type" value={distTargetT} />
        <input type="hidden" name="target_meta" value={distTargetMeta ?? ''} />
        <div class="panel-actions">
          <button type="submit" class="btn-primary" disabled={distLoading}>
            {distLoading ? '배포 중...' : '배포 실행'}
          </button>
        </div>
      </form>

    <!-- ─── 탭3: 채번내역 (sequenced 모드 전용) ─── -->
    {:else if activeTab === 'redemptions'}
      <div class="section-title">사용 채번 목록</div>
      {#if redemptionsLoading}
        <p class="hint">불러오는 중...</p>
      {:else if redemptions.length === 0}
        <p class="hint">아직 사용된 내역이 없습니다.</p>
      {:else}
        <div class="redemption-list">
          {#each redemptions as r (r.userCouponId)}
            <!-- sequenced 모드는 개별 채번된 redeemedCode, manual 모드는 redeemedCode가
                 없으므로(사용자별로 다른 코드가 생기지 않음) 쿠폰 고유 code로 대체 표시.
                 랜딩은 RentalDetailPanel — "이 쿠폰이 결제된 정확한 예약"이 아니라 그
                 사용자의 가장 최근 예약(대여 정보 확인 목적, migration 301). 서버가
                 user_id 기준으로 대표 예약을 고르므로 중복 쿠폰 사용에도 항상 정확히
                 그 사용자로 연결됨 — 단, 그 사용자에게 예약이 하나도 없으면 비활성. -->
            {#if r.cmsPath && r.reservationId}
              <a
                class="redemption-row redemption-row--linked"
                href="{r.cmsPath}?selected={r.reservationId}"
                target="_blank"
                rel="noopener"
                title="대여 정보 열기"
              >
                <span class="redemption-code">{r.redeemedCode ?? coupon.code ?? '—'}</span>
                <span class="redemption-meta">{formatDateTime(r.usedAt)}</span>
                <span class="redemption-user">{r.userName ?? '이름 미등록'} ({r.userEmail ?? '이메일 없음'})</span>
              </a>
            {:else}
              <div class="redemption-row" title="이 사용자의 대여 정보를 찾을 수 없습니다">
                <span class="redemption-code">{r.redeemedCode ?? coupon.code ?? '—'}</span>
                <span class="redemption-meta">{formatDateTime(r.usedAt)}</span>
                <span class="redemption-user">{r.userName ?? '이름 미등록'} ({r.userEmail ?? '이메일 없음'})</span>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}

  </div>
</div>

<style>
  /* 패널 루트 (cms-uiux.md §목록카드+DetailPanel 필수 구조) */
  .panel {
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  }

  /* 패널 헤더 */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .panel-title-wrap { display: flex; align-items: center; gap: 8px; }
  .panel-label { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .panel-id    { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); letter-spacing: .04em; }
  .panel-status {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700;
    background: rgba(59,47,138,0.10); color: var(--cs-purple);
  }
  .close-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border: none; background: none; cursor: pointer;
    font-size: 14px; color: var(--cs-text-mid);
    border-radius: 6px; transition: background 0.12s;
  }
  .close-btn:hover { background: var(--cs-surface-gray); }

  /* 탭 */
  .panel-tabs { display: flex; border-bottom: 1px solid var(--cs-lilac); flex-shrink: 0; }
  .tab {
    flex: 1; padding: 10px 8px;
    background: none; border: none; border-bottom: 2px solid transparent;
    cursor: pointer; font: var(--text-pc-script-12); font-weight: 400;
    color: var(--cs-text-mid); transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .tab:hover  { color: var(--cs-purple); }
  .tab-active { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  /* 패널 바디 — display: block 필수 (overflow:hidden 자식 압축 방지) */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: block;
    padding: 16px 20px 20px;
  }
  .panel-body > * + * { margin-top: 10px; }

  .section-title {
    font: var(--text-pc-script-12); font-weight: 700;
    color: var(--cs-text-mid); padding: 4px 0 2px;
  }

  .info-section {
    display: flex; flex-direction: column;
    border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .info-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; border-bottom: 1px solid var(--cs-lilac);
  }
  .info-row:last-child { border-bottom: none; }
  .info-label { flex: 0 0 96px; font: var(--text-pc-script-12); color: var(--cs-text-mid); font-weight: 700; }
  .info-value { flex: 1; font: var(--text-pc-body-14); color: var(--cs-text); }

  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-field { display: flex; flex-direction: column; gap: 6px; }
  .form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .hint { font: var(--text-pc-script-12); color: var(--cs-text-light); }

  .radio-group { display: flex; gap: 16px; flex-wrap: wrap; }
  .radio-lbl {
    display: flex; align-items: center; gap: 6px;
    font: var(--text-pc-body-14); color: var(--cs-text);
    cursor: pointer; min-height: 28px;
  }

  .f-input {
    background: var(--cs-surface-gray); border: none;
    border-radius: var(--cms-radius-sm); padding: 10px 16px;
    font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-input.ta { resize: vertical; height: auto; }

  .panel-actions { display: flex; justify-content: flex-end; }

  /* 채번내역 탭 */
  .redemption-list { display: flex; flex-direction: column; gap: 8px; }
  .redemption-row {
    display: flex; flex-direction: row; align-items: center; gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm);
    text-decoration: none;
  }
  .redemption-row--linked { cursor: pointer; transition: border-color 0.12s, background 0.12s; }
  .redemption-row--linked:hover { border-color: var(--cs-purple); background: var(--cs-purple-op10); }
  .redemption-code {
    font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text);
    letter-spacing: .04em;
    flex: 0 0 auto;
  }
  .redemption-meta {
    font: var(--text-pc-script-12); color: var(--cs-text-mid);
    flex: 0 0 auto; white-space: nowrap;
  }
  .redemption-user {
    font: var(--text-pc-script-12); color: var(--cs-text-light);
    flex: 1 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    text-align: right;
  }

  .btn-primary {
    background: var(--cs-purple); color: var(--cs-white); border: none;
    border-radius: var(--radius-sm); padding: 8px 16px;
    font: var(--text-pc-body-14); height: 36px; cursor: pointer;
    transition: background 0.15s; white-space: nowrap;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
</style>
