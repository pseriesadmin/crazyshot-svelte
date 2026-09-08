<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { fly } from 'svelte/transition'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { Coupon } from '$lib/types/database'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import CmsKpiCard from '$lib/components/cms/CmsKpiCard.svelte'
  import CmsStatRing from '$lib/components/cms/CmsStatRing.svelte'
  import CmsStatBars from '$lib/components/cms/CmsStatBars.svelte'
  import CouponDetailPanel from '$lib/components/cms/CouponDetailPanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  // 발행관리 탭 목록 페이지네이션(고객목록 화면과 동일한 CmsPagination 표준 UI, 레이아웃
  // 통일성 정합) — data.coupons는 사용량 리포트 탭의 코드↔쿠폰 매칭(selectCouponById)이
  // 탭과 무관하게 전체 목록을 필요로 하므로 그대로 유지하고, 화면에 보여줄 페이지만
  // 클라이언트에서 잘라낸다(서버 재조회 없음)
  const COUPON_PAGE_SIZE = 30
  let couponPage = $state(1)
  const couponTotalPages = $derived(Math.max(1, Math.ceil(data.coupons.length / COUPON_PAGE_SIZE)))
  const pagedCoupons = $derived(
    data.coupons.slice((couponPage - 1) * COUPON_PAGE_SIZE, couponPage * COUPON_PAGE_SIZE)
  )
  function goCouponPage(p: number) { couponPage = p }
  // 삭제 등으로 목록이 줄어 현재 페이지가 범위를 벗어나면 마지막 페이지로 보정
  $effect(() => {
    if (couponPage > couponTotalPages) couponPage = couponTotalPages
  })

  // ─ 탭 ─
  const TABS = [
    { id: 'dashboard',  label: '대시보드' },
    { id: 'manage',     label: '발행 관리' },
    { id: 'report',     label: '사용량 리포트' },
    { id: 'expire',     label: '만료 관리' },
  ] as const

  let activeTab = $state(data.tab)

  function switchTab(id: string) {
    activeTab = id
    const u = new URL(page.url)
    u.searchParams.set('tab', id)
    goto(u.toString(), { replaceState: true, invalidateAll: true })
  }

  // ─ 목록카드 + DetailPanel 선택 상태 (cms-uiux.md 표준 구조) ─
  let selectedCouponId = $state<string | null>(data.selectedId ?? null)
  let showDistHistory  = $state(false)

  const selectedCoupon = $derived(
    selectedCouponId ? data.coupons.find(c => c.id === selectedCouponId) ?? null : null
  )

  function selectCoupon(c: Coupon) {
    selectedCouponId = c.id
    const u = new URL(page.url)
    u.searchParams.set('selected', c.id)
    goto(u.toString(), { replaceState: true, noScroll: true })
  }

  function closePanel() {
    selectedCouponId = null
    const u = new URL(page.url)
    u.searchParams.delete('selected')
    goto(u.toString(), { replaceState: true, noScroll: true })
  }

  // 사용량 리포트 탭 — 행은 coupon_id만 갖고 있어 data.coupons(전체 목록, tab 무관하게
  // 항상 로드됨)에서 매칭되는 쿠폰을 찾아 발행관리 탭과 동일한 selectCoupon()으로 위임.
  // 과거 리포트 기간에 등장했지만 이후 삭제된 쿠폰처럼 못 찾는 경우는 조용히 무시(패널 안 열림).
  function selectCouponById(couponId: string) {
    const c = data.coupons.find(c => c.id === couponId)
    if (c) selectCoupon(c)
  }

  // ─ 만료 연장 상태 ─
  let reportFrom = $state(data.from.substring(0, 10))
  let reportTo   = $state(data.to.substring(0, 10))

  let extendCouponId = $state('')
  let extendNewUntil = $state('')
  let extendLoading  = $state(false)

  // ─ 삭제 확인 ─
  let deleteId        = $state('')
  let deleteCode      = $state('')
  let showDeleteModal = $state(false)

  function confirmDelete(c: Coupon) {
    deleteId   = c.id
    deleteCode = c.code ?? ''
    showDeleteModal = true
  }

  // ─ action 결과 처리 ─
  $effect(() => {
    if (!form) return
    if (form.ok) {
      csToast.success('완료되었습니다.')
      showDeleteModal = false
      extendCouponId  = ''
      if (deleteId && deleteId === selectedCouponId) closePanel()
    } else if ('error' in form && form.error) {
      csToast.error(String(form.error))
    }
  })

  // data 갱신 시 재동기화
  $effect(() => {
    reportFrom = data.from.substring(0, 10)
    reportTo   = data.to.substring(0, 10)
  })

  // ─ 유틸 ─
  // sequenced 모드 쿠폰은 code가 NULL(실제 코드는 고객이 결제로 "사용"하는 순간에만
  // user_coupons.redeemed_code로 개별 채번됨) — 목록·만료 테이블에서 빈 값 대신
  // code_series 패턴 프리뷰(예: "Z쿠폰코드*")를 보여준다. manual 모드는 code 그대로.
  function codeDisplay(c: { code: string | null; code_mode?: string; code_series?: { prefix?: string; category_code?: string } | null }): string {
    if (c.code) return c.code
    if (c.code_mode === 'sequenced' && c.code_series) {
      const prefix = c.code_series.prefix ?? 'CS'
      const cat = c.code_series.category_code ?? ''
      return `${prefix}${cat}*`
    }
    return '—'
  }

  function discountLabel(c: Coupon): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cc = c as unknown as any
    if (c.discount_type === 'percentage') {
      const max = cc.max_discount_amount ? ` (최대 ${Number(cc.max_discount_amount).toLocaleString()}원)` : ''
      return `${c.discount_value}%${max}`
    }
    if (c.discount_type === 'fixed') return `${c.discount_value.toLocaleString()}원`
    return '무료배송'
  }

  function typeLabel(type: string): string {
    // coupon_type_enum 실제 값 기준(2026-09-08 정정 — 'fixed'/'percent'는 discount_type과
    // 혼동돼 잘못 들어간, 실제로는 존재할 수 없는 값이었음. first_purchase 추가)
    const MAP: Record<string, string> = {
      all: '전체', first_purchase: '첫구매전용', free_delivery: '무료배송',
      first_rental: '첫렌탈', category: '카테고리', bundle: '번들',
      subscription: '구독전용', student: '학생전용', walk_in: '방문픽업',
      reactivation: '휴면복귀', referral: '추천인', event: '이벤트',
    }
    return MAP[type] ?? type
  }

  function formatDate(d: string | null | undefined): string {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })
  }
</script>

<div class="page-wrap">
  <!-- 서브탭 -->
  <div class="sub-tabs">
    {#each TABS as t}
      <button
        class="sub-tab-btn"
        class:active={activeTab === t.id}
        onclick={() => switchTab(t.id)}
      >{t.label}</button>
    {/each}
  </div>

  <!-- ────────────────────────────────────────────
       탭1: 대시보드
  ──────────────────────────────────────────── -->
  {#if activeTab === 'dashboard'}
    <div class="section-title">쿠폰 현황</div>

    <!-- 히어로 통계: 전환율 게이지 + 발급/사용 breakdown 바 -->
    <div class="hero-stats">
      <div class="hero-ring">
        <CmsStatRing value={data.stats.conversion_rate} label="쿠폰 사용 전환율" tone="primary" size={140} />
      </div>
      <div class="hero-bars">
        <div class="hero-bars-title">발급 · 사용 · 만료 breakdown</div>
        <CmsStatBars unit="건" items={[
          { label: '총 발급',  value: data.stats.total_issued,  tone: 'primary' },
          { label: '현재 활성', value: data.stats.total_active,  tone: 'info' },
          { label: '누적 사용', value: data.stats.total_used,    tone: 'primary' },
          { label: '만료',    value: data.stats.total_expired, tone: 'danger' },
        ]} />
      </div>
    </div>

    <CmsKpiGrid columns={3} cards={[
      { label: '총 발급 수',        value: data.stats.total_issued,  tone: 'primary' },
      { label: '현재 활성',         value: data.stats.total_active,  tone: 'info' },
      { label: '누적 사용',         value: data.stats.total_used,    tone: 'primary', size: 'sm' },
      { label: '만료 수',           value: data.stats.total_expired, tone: 'danger', size: 'sm' },
      { label: '총 할인 제공액',    value: data.stats.total_discount_amount, unit: '원', tone: 'info', size: 'sm' },
      { label: '쿠폰 사용 전환율',  value: data.stats.conversion_rate, unit: '%', tone: 'primary', size: 'sm', progress: data.stats.conversion_rate },
    ]} />

    {#if data.expiringSoon.length > 0}
      <div class="expire-section">
        <div class="expire-section-title">⚠ 만료 임박 쿠폰 (7일 이내)</div>
        <div class="expire-grid">
          {#each data.expiringSoon.slice(0, 5) as c}
            <CmsKpiCard label={c.code ?? ''} value={formatDate(c.valid_until)} tone="warn" size="sm" />
          {/each}
        </div>
      </div>
    {/if}

  <!-- ────────────────────────────────────────────
       탭2: 발행 관리
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'manage'}
    <div class="toolbar">
      <span class="section-title nm">쿠폰 목록</span>
      <a href="/cms/promotion/coupon/new" class="btn-primary">+ 쿠폰 생성</a>
    </div>

    <!-- 목록카드 + DetailPanel (cms-uiux.md 표준 구조 — /cms/reservation과 동일 패턴) -->
    <div class="content-area" class:panel-open={selectedCouponId != null}>
      <div class="table-card">
      <CmsPagination
        page={couponPage}
        totalPages={couponTotalPages}
        onpage={goCouponPage}
        variant="top"
        ariaLabel="쿠폰 목록 페이지 탐색"
      />
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>코드</th><th>유형</th><th class="col-hide">할인</th>
              <th class="col-hide">유효기간</th><th>사용/한도</th><th>상태</th><th>관리</th>
            </tr>
          </thead>
          <tbody>
            {#each pagedCoupons as c (c.id)}
              {@const cc = c as unknown as Record<string, unknown>}
              <tr
                class:selected={selectedCouponId === c.id}
                onclick={() => selectCoupon(c)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectCoupon(c)}
                aria-label="{codeDisplay(c)} 쿠폰 상세 보기"
              >
                <td class="td-code">{codeDisplay(c)}</td>
                <td><span class="badge badge-info">{typeLabel(c.type)}</span></td>
                <td class="td-date col-hide">
                  {#if cc.validity_type === 'unlimited'}
                    <span class="badge badge-active">무제한</span>
                  {:else}
                    {formatDate(c.valid_from)} ~ {formatDate(c.valid_until)}
                  {/if}
                </td>
                <td class="col-hide">{discountLabel(c)}</td>
                <td>{c.usage_count} / {c.usage_limit ?? '∞'}</td>
                <td>
                  <form method="POST" action="?/toggleCoupon" use:enhance
                    onclick={(e) => e.stopPropagation()}
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="is_active" value={String(c.is_active)} />
                    <button type="submit" class="tog" class:tog-on={c.is_active}
                      role="switch" aria-checked={c.is_active} aria-label="활성화 토글">
                      <span class="tog-thumb"></span>
                    </button>
                  </form>
                </td>
                <td>
                  <button class="btn-danger sm" onclick={(e) => { e.stopPropagation(); confirmDelete(c) }}>삭제</button>
                </td>
              </tr>
            {:else}
              <tr><td colspan="7" class="no-data">등록된 쿠폰이 없습니다.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <CmsPagination
        page={couponPage}
        totalPages={couponTotalPages}
        onpage={goCouponPage}
        variant="bottom"
        ariaLabel="쿠폰 목록 페이지 탐색"
      />

        <!-- 배포 이력 (접이식) -->
        <button type="button" class="dist-history-toggle" onclick={() => showDistHistory = !showDistHistory}>
          {showDistHistory ? '▾' : '▸'} 배포 이력 {data.distributions.length > 0 ? `(${data.distributions.length})` : ''}
        </button>
        {#if showDistHistory}
          <div class="dist-history-table">
            <table>
              <thead>
                <tr><th>배포일</th><th>쿠폰 코드</th><th>대상</th><th>발급 수</th></tr>
              </thead>
              <tbody>
                {#each data.distributions as d}
                  <tr>
                    <td class="td-date">{formatDate(d.created_at)}</td>
                    <td class="td-code">{d.coupons ? codeDisplay(d.coupons) : '—'}</td>
                    <td>{d.target_type}</td>
                    <td>{d.issued_count.toLocaleString()}명</td>
                  </tr>
                {:else}
                  <tr><td colspan="4" class="no-data">배포 이력이 없습니다.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- 상세 패널 -->
      {#if selectedCouponId != null && selectedCoupon}
        <div class="detail-panel-wrap" transition:fly={{ x: 30, duration: 220 }}>
          {#key selectedCouponId}
            <CouponDetailPanel coupon={selectedCoupon} onclose={closePanel} context="manage" />
          {/key}
        </div>
      {/if}
    </div>

  <!-- ────────────────────────────────────────────
       탭3: 사용량 리포트
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'report'}
    <div class="toolbar">
      <span class="section-title nm">사용량 리포트</span>
      <form method="GET" class="filter-form">
        <input type="hidden" name="tab" value="report" />
        <select name="period" class="f-input sm">
          <option value="day"   selected={data.period === 'day'}>일별</option>
          <option value="month" selected={data.period === 'month'}>월별</option>
          <option value="year"  selected={data.period === 'year'}>연별</option>
        </select>
        <CmsDatePicker bind:value={reportFrom} name="from" placeholder="시작일" disablePast={false} />
        <CmsDatePicker bind:value={reportTo} name="to" placeholder="종료일" disablePast={false} />
        <button type="submit" class="btn-primary">조회</button>
      </form>
    </div>
    <div class="content-area" class:panel-open={selectedCouponId != null}>
      <div class="table-card">
        <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>기간</th><th>쿠폰 코드</th><th>유형</th>
              <th>발급 수</th><th>사용 수</th><th>전환율</th>
            </tr>
          </thead>
          <tbody>
            {#each data.usageReport as r}
              <tr
                class:selected={selectedCouponId === r.coupon_id}
                onclick={() => selectCouponById(r.coupon_id)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectCouponById(r.coupon_id)}
                aria-label="{r.coupon_code} 쿠폰 상세 보기"
              >
                <td>{r.period}</td>
                <td class="td-code">{r.coupon_code}</td>
                <td><span class="badge badge-info">{typeLabel(r.coupon_type)}</span></td>
                <td>{r.issued_count.toLocaleString()}</td>
                <td>{r.used_count.toLocaleString()}</td>
                <td>{r.conversion_pct}%</td>
              </tr>
            {:else}
              <tr><td colspan="6" class="no-data">리포트 데이터가 없습니다.</td></tr>
            {/each}
          </tbody>
        </table>
        </div>
      </div>

      <!-- 상세 패널 (발행 관리 탭과 동일 컴포넌트·패턴 재사용 — 단 '배포' 탭은 '사용 채번
           목록'으로 대체되도록 context="report" 전달, Stephen 확정 2026-08-18) -->
      {#if selectedCouponId != null && selectedCoupon}
        <div class="detail-panel-wrap" transition:fly={{ x: 30, duration: 220 }}>
          {#key selectedCouponId}
            <CouponDetailPanel coupon={selectedCoupon} onclose={closePanel} context="report" />
          {/key}
        </div>
      {/if}
    </div>

  <!-- ────────────────────────────────────────────
       탭4: 만료 관리
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'expire'}
    <div class="section-title">만료 임박 (7일 이내)</div>
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>쿠폰 코드</th><th>유형</th>
            <th>사용/한도</th><th>만료일</th><th>연장</th>
          </tr>
        </thead>
        <tbody>
          {#each data.expiringSoon as c}
            <tr>
              <td class="td-code">{codeDisplay(c)}</td>
              <td><span class="badge badge-info">{typeLabel(c.type)}</span></td>
              <td>{c.usage_count} / {c.usage_limit ?? '∞'}</td>
              <td class="td-date">{formatDate(c.valid_until)}</td>
              <td>
                <button class="btn-ghost sm"
                  onclick={() => { extendCouponId = c.id; extendNewUntil = '' }}>
                  기간 연장
                </button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="no-data">만료 임박 쿠폰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="section-title" style="margin-top:20px">만료 완료</div>
    <div class="table-card">
      <table>
        <thead>
          <tr><th>쿠폰 코드</th><th>유형</th><th>총 사용</th><th>만료일</th></tr>
        </thead>
        <tbody>
          {#each data.expiredCoupons as c}
            <tr>
              <td class="td-code">{codeDisplay(c)}</td>
              <td><span class="badge badge-inactive">{typeLabel(c.type)}</span></td>
              <td>{c.usage_count}</td>
              <td class="td-date">{formatDate(c.valid_until)}</td>
            </tr>
          {:else}
            <tr><td colspan="4" class="no-data">만료된 쿠폰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- 기간 연장 모달 -->
{#if extendCouponId}
  <div class="modal-bg" onclick={() => extendCouponId = ''} role="presentation">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="기간 연장"
      onclick={(e) => e.stopPropagation()}>
      <p class="modal-title">쿠폰 유효기간 연장</p>
      <form method="POST" action="?/extendCoupon"
        use:enhance={() => {
          extendLoading = true
          return ({ update }) => { extendLoading = false; update() }
        }}
      >
        <input type="hidden" name="coupon_id" value={extendCouponId} />
        <div class="form-field">
          <label for="ext-until">새 만료일</label>
          <CmsDatePicker bind:value={extendNewUntil} name="new_until" placeholder="새 만료일 선택" disablePast={false} />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick={() => extendCouponId = ''}>취소</button>
          <button type="submit" class="btn-primary" disabled={extendLoading}>
            {extendLoading ? '처리 중...' : '연장 확인'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- 삭제 확인 모달 -->
{#if showDeleteModal}
  <div class="modal-bg" onclick={() => showDeleteModal = false} role="presentation">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="삭제 확인"
      onclick={(e) => e.stopPropagation()}>
      <p class="modal-title">쿠폰 삭제</p>
      <p class="modal-sub"><strong>{deleteCode}</strong> 쿠폰을 삭제합니다.<br>이 작업은 되돌릴 수 없습니다.</p>
      <form method="POST" action="?/deleteCoupon" use:enhance>
        <input type="hidden" name="id" value={deleteId} />
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick={() => showDeleteModal = false}>취소</button>
          <button type="submit" class="btn-danger">삭제</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
/* ─ 레이아웃 ─ */
.page-wrap {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 20px 24px 32px;
}

/* ─ 서브탭 ─ */
.sub-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.sub-tab-btn {
  padding: 6px 18px; border: none;
  border-radius: var(--cms-radius-sm);
  background: transparent; color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer;
  min-height: 34px; transition: background 0.15s, color 0.15s;
}
.sub-tab-btn:hover  { background: rgba(59,47,138,0.08); color: var(--cs-text); }
.sub-tab-btn.active { background: var(--cs-white); color: var(--cs-purple); }

/* ─ 섹션 타이틀 ─ */
.section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 16px; }
.section-title.nm { margin: 0; }

/* ─ KPI 그리드: CmsKpiGrid/CmsKpiCard 공용 컴포넌트로 대체 (dashboard 탭) ─ */

/* ─ 히어로 통계 (게이지 + 바그래프) ─ */
.hero-stats {
  display: flex;
  gap: 24px;
  background: var(--cs-white);
  border-radius: var(--cms-radius-lg);
  padding: 28px 32px;
  margin-bottom: 20px;
  box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
}
.hero-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding-right: 24px;
  border-right: 1px solid var(--cs-surface-gray);
}
.hero-bars {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
}
.hero-bars-title {
  font: var(--text-pc-body-14);
  font-weight: 700;
  color: var(--cs-text);
}

/* ─ 만료 임박 섹션 ─ */
.expire-section       { margin: 20px 0 16px; }
.expire-section-title { font: var(--text-pc-body-14); color: var(--cs-text); margin-bottom: 10px; }
.expire-grid          { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

/* ─ 배포 이력 토글 ─ */
.dist-history-toggle {
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: none; cursor: pointer;
  font: var(--text-pc-body-14); color: var(--cs-purple);
  padding: 8px 0; margin-bottom: 8px;
}

/* ─ 툴바 ─ */
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }

.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

/* ─ 필터 폼 ─ */
.filter-form { display: flex; gap: 8px; align-items: center; }
.f-input.sm  { padding: 6px 10px; font: var(--text-pc-script-12); height: 32px; }

/* ─ 목록카드 + DetailPanel 분할 (cms-uiux.md §목록카드+DetailPanel 필수 구조) ─ */
.content-area {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.content-area .table-card {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.content-area.panel-open .table-card { flex: 4; }
.content-area .table-wrap { flex: 1; min-height: 0; overflow-y: auto; overflow-x: auto; }
.detail-panel-wrap {
  flex: 6;
  min-width: 0;
  /* overflow: hidden 추가 금지 — 패널 스크롤 파괴 */
}
.content-area.panel-open .col-hide { display: none; }

/* ─ 테이블 ─ */
.table-card {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  overflow: hidden; margin-bottom: 16px;
}
table { width: 100%; border-collapse: collapse; font: var(--text-pc-body-14); color: var(--cs-text); }
thead th {
  background: var(--cs-lilac); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); padding: 10px 16px;
  text-align: left; white-space: nowrap;
}
tbody tr { border-bottom: 1px solid var(--cs-surface-gray); cursor: pointer; }
tbody tr:hover { background: rgba(59,47,138,0.04); }
tbody tr.selected { background: rgba(59,47,138,0.08); }
tbody tr:last-child { border-bottom: none; }
td { padding: 10px 16px; vertical-align: middle; }
.td-code { font: var(--text-pc-body-14); color: var(--cs-purple); letter-spacing: .04em; }
.td-date { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.no-data { text-align: center; color: var(--cs-text-light); padding: 32px; }

/* ─ 배포 이력 (접이식 하위 테이블) ─ */
.dist-history-table {
  border-top: 1px solid var(--cs-surface-gray);
  overflow-x: auto;
}

/* ─ 배지 ─ */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); white-space: nowrap;
}
.badge-active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
.badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }
.badge-info     { background: rgba(59,47,138,0.08); color: var(--cs-purple); }

/* ─ 토글 ─ */
.tog {
  position: relative; width: 40px; height: 22px; border: none;
  border-radius: var(--radius-full); background: var(--cs-disabled-toggle);
  cursor: pointer; transition: background 0.2s; flex-shrink: 0;
}
.tog.tog-on { background: var(--cs-purple); }
.tog-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--cs-white); transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.tog.tog-on .tog-thumb { transform: translateX(18px); }

/* ─ 버튼 ─ */
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--cs-purple); color: var(--cs-white); border: none;
  border-radius: var(--radius-sm); padding: 8px 16px;
  font: var(--text-pc-body-14); height: 36px; cursor: pointer;
  transition: background 0.15s; white-space: nowrap; text-decoration: none;
}
.btn-primary:hover    { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
.btn-ghost {
  background: transparent; border: 1.5px solid var(--cs-purple);
  border-radius: var(--radius-sm); color: var(--cs-purple);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
}
.btn-ghost:hover { background: rgba(59,47,138,0.06); }
.btn-danger {
  background: transparent; border: 1.5px solid var(--cs-red-badge);
  border-radius: var(--radius-sm); color: var(--cs-red-badge);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s;
}
.btn-danger:hover { background: rgba(255,53,53,0.08); }
.btn-danger.sm, .btn-ghost.sm {
  padding: 4px 10px; height: 28px; font: var(--text-pc-script-12);
}

/* ─ 입력 필드 ─ */
.f-input {
  background: var(--cs-surface-gray); border: none;
  border-radius: var(--cms-radius-sm); padding: 10px 16px;
  font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

/* ─ 모달 ─ */
.modal-bg {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(16,11,50,0.45);
  display: flex; align-items: center; justify-content: center;
}
.modal-box {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px 32px; min-width: 320px; max-width: 440px; width: 100%;
}
.modal-title   { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0 0 8px; }
.modal-sub     { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; line-height: 1.6; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
</style>
