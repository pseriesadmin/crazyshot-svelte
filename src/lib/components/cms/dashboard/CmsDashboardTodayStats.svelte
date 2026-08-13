<script lang="ts">
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import type { KpiCardProps } from '$lib/components/cms/CmsKpiGrid.svelte'
  import CmsStatRing from '$lib/components/cms/CmsStatRing.svelte'
  import CmsStatBars from '$lib/components/cms/CmsStatBars.svelte'

  interface Props {
    stats: Record<string, number> | null
    coupon: { issued: number; used: number }
  }

  let { stats, coupon }: Props = $props()

  // 0~100 비율 계산 (분모 0 방어) — CmsStatRing.value는 반드시 비율값이어야 함(원시 카운트 금지)
  function pct(numerator: number, denominator: number): number {
    if (!denominator) return 0
    return Math.max(0, Math.min(100, (numerator / denominator) * 100))
  }

  // ── 히어로: 원형 그래프 3종 + 막대비교 (cms-uiux.md §7-17 표준 패턴) ─────────
  const utilizationPct = $derived(
    stats ? pct(stats.rentals_out_count ?? 0, stats.product_total_count ?? 0) : 0,
  )
  const couponUsePct = $derived(pct(coupon.used, coupon.issued))
  const newCustomerPct = $derived(
    stats ? pct(stats.customers_new_today ?? 0, stats.customers_total ?? 0) : 0,
  )

  const lifecycleBars = $derived(
    stats
      ? [
          { label: '반출중', value: stats.rentals_out_count ?? 0, tone: 'info' as const },
          { label: '반납예정', value: stats.returns_pending_count ?? 0, tone: 'warn' as const },
          { label: '반납완료(누적)', value: stats.returns_completed_total ?? 0, tone: 'neutral' as const },
        ]
      : [],
  )

  // 섹션1: 트래픽 · 결제 (2장)
  const trafficCards = $derived<KpiCardProps[]>(
    stats
      ? [
          {
            label: '오늘 방문자 (추정)',
            value: stats.visits_today_estimate ?? 0,
            unit: '명',
            sub: '추정치 — 실측 트래킹 아님',
            tone: 'neutral',
          },
          {
            label: '오늘 결제 총액',
            value: stats.payment_total_today ?? 0,
            unit: '원',
            tone: 'primary',
          },
        ]
      : [],
  )

  // 섹션2: 고객 (3장)
  const customerCards = $derived<KpiCardProps[]>(
    stats
      ? [
          {
            label: '오늘 신규 고객',
            value: stats.customers_new_today ?? 0,
            unit: '명',
            tone: 'info',
          },
          {
            label: '오늘 탈퇴',
            value: stats.customers_withdrawn_today ?? 0,
            unit: '명',
            tone: 'neutral',
          },
          {
            label: '전체 고객',
            value: stats.customers_total ?? 0,
            unit: '명',
            tone: 'primary',
          },
        ]
      : [],
  )

  // 섹션3: 상품 (2장 — 반출/반납 계열은 위 히어로 막대비교로 이동)
  const productCards = $derived<KpiCardProps[]>(
    stats
      ? [
          {
            label: '카테고리 수',
            value: stats.product_category_count ?? 0,
            unit: '개',
            tone: 'neutral',
          },
          {
            label: '전체 상품 수',
            value: stats.product_total_count ?? 0,
            unit: '개',
            tone: 'neutral',
          },
        ]
      : [],
  )

  // 섹션4: 프로모션 · 이벤트 (3장)
  const promoCards = $derived<KpiCardProps[]>([
    {
      label: '오늘 쿠폰 발행',
      value: coupon.issued,
      unit: '장',
      tone: 'neutral',
    },
    {
      label: '오늘 쿠폰 사용',
      value: coupon.used,
      unit: '장',
      tone: 'info',
    },
    {
      label: '이벤트 응모',
      value: '준비중',
      tone: 'neutral',
      size: 'sm',
      sub: '데이터 모델 미구현',
    },
  ])

  // 섹션5: 리뷰 · 문의 (3장)
  // 문의 등록/미답변 2장은 cs_posts 테이블이 stage·production 모두 미존재로 집계 불가 —
  // "이벤트 응모"와 동일하게 준비중 배지로 표시(2026-08-12, Migration #221 재검증 수정과 연동)
  const reviewCards = $derived<KpiCardProps[]>(
    stats
      ? [
          {
            label: '오늘 리뷰',
            value: stats.reviews_today_count ?? 0,
            unit: '건',
            tone: 'neutral',
          },
          {
            label: '오늘 문의 등록',
            value: '준비중',
            tone: 'neutral',
            size: 'sm',
            sub: '문의 데이터 테이블 미배포',
          },
          {
            label: '미답변 문의',
            value: '준비중',
            tone: 'neutral',
            size: 'sm',
            sub: '문의 데이터 테이블 미배포',
          },
        ]
      : [],
  )
</script>

{#if stats === null}
  <div class="stats-error">
    <p>통계 데이터를 불러오지 못했습니다.</p>
    <p class="stats-error-hint">잠시 후 다시 시도해주세요. 문제가 계속되면 서버 로그를 확인하세요.</p>
  </div>
{:else}
  <div class="stats-wrap">
    <!-- 히어로: 원형 그래프 3종(재고 가동률 · 쿠폰 사용률 · 신규고객 비중) + 대여현황 막대비교 -->
    <div class="hero-stats">
      <div class="hero-rings">
        <div class="hero-ring">
          <CmsStatRing
            value={utilizationPct}
            centerText={String(stats.rentals_out_count ?? 0)}
            label="재고 가동률"
            tone="primary"
            size={128}
          />
        </div>
        <div class="hero-ring">
          <CmsStatRing
            value={couponUsePct}
            centerText={String(coupon.used)}
            label="쿠폰 사용률"
            tone="info"
            size={128}
          />
        </div>
        <div class="hero-ring">
          <CmsStatRing
            value={newCustomerPct}
            centerText={String(stats.customers_new_today ?? 0)}
            label="신규고객 비중"
            tone="warn"
            size={128}
          />
        </div>
      </div>
      <div class="hero-bars">
        <div class="hero-bars-title">대여 라이프사이클 현황</div>
        <CmsStatBars unit="건" items={lifecycleBars} />
      </div>
    </div>

    <!-- 섹션1: 트래픽 · 결제 -->
    <section class="stats-section">
      <h3 class="section-title">트래픽 · 결제</h3>
      <CmsKpiGrid columns={3} cards={trafficCards} />
    </section>

    <!-- 섹션2: 고객 -->
    <section class="stats-section">
      <h3 class="section-title">고객</h3>
      <CmsKpiGrid columns={3} cards={customerCards} />
    </section>

    <!-- 섹션3: 상품 -->
    <section class="stats-section">
      <h3 class="section-title">상품</h3>
      <CmsKpiGrid columns={3} cards={productCards} />
    </section>

    <!-- 섹션4: 프로모션 · 이벤트 -->
    <section class="stats-section">
      <h3 class="section-title">프로모션 · 이벤트</h3>
      <CmsKpiGrid columns={3} cards={promoCards} />
    </section>

    <!-- 섹션5: 리뷰 · 문의 -->
    <section class="stats-section">
      <h3 class="section-title">리뷰 · 문의</h3>
      <CmsKpiGrid columns={3} cards={reviewCards} />
    </section>
  </div>
{/if}

<style>
  .stats-wrap {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  /* ── 히어로: 원형 그래프 + 막대비교 (cms-uiux.md §7-17 표준) ── */
  .hero-stats {
    display: flex;
    gap: 24px;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
  }

  .hero-rings {
    display: flex;
    gap: 24px;
    flex: 0 0 auto;
    padding-right: 24px;
    border-right: 1px solid var(--cs-surface-gray);
  }

  .hero-ring {
    display: flex;
    align-items: center;
    justify-content: center;
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

  .stats-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-title {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .stats-error {
    padding: 40px;
    text-align: center;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
  }

  .stats-error-hint {
    margin-top: 8px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  @media (max-width: 1100px) {
    .hero-stats {
      flex-direction: column;
    }
    .hero-rings {
      border-right: none;
      border-bottom: 1px solid var(--cs-surface-gray);
      padding-right: 0;
      padding-bottom: 20px;
      flex-wrap: wrap;
      justify-content: center;
    }
  }
</style>
