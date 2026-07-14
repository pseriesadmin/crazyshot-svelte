<script lang="ts">
  const ROWS = [
    { label: '월 사용료',        easy: '9,900 원',              pop: '19,000 원',                   crazy: '29,000 원' },
    { label: '이상적인 대상',    easy: '신규 제작자 및\nK-브이로거', pop: '성장하는 제작자 및\nK-Pop 팬덤', crazy: '전업 유튜버 및\n제작사' },
    { label: '무료 배송',        easy: '50% 할인 (월 2회)',      pop: '월 2회',                      crazy: '무제한' },
    { label: '신규 장비 조기 접근', easy: '—',                  pop: '무제한',                      crazy: '무제한' },
    { label: '보증금',           easy: '신용카드 보증금',         pop: '신용카드 보증금',               crazy: '면제' },
    { label: '할인',             easy: '—',                     pop: '추가 10% 할인',               crazy: '모든 대여 10% 할인' },
    { label: '보호',             easy: '손상 보호',              pop: '손상 보호',                   crazy: '손상 보호' },
    { label: '프로 지원',        easy: '—',                     pop: '—',                           crazy: '1:1 프로 상담' },
  ]

  type TabIdx = 0 | 1 | 2
  let activeTab = $state<TabIdx>(0)

  const COLS = [
    { label: 'Easy pack',  headerBg: '#C1BBEC', rowBgs: ['#E1DEF3', 'transparent'] as const },
    { label: 'Pop pack',   headerBg: '#FFB3B3', rowBgs: ['#FFCFCF', '#FFB3B3']    as const, popular: true },
    { label: 'Crazy pack', headerBg: '#C1BBEC', rowBgs: ['#E1DEF3', 'transparent'] as const },
  ]
</script>

<!-- ── PC 피처 테이블 (≥1024px) ──────────────────────────────── -->
<section class="table-pc" aria-label="멤버십 혜택 비교">
  <p class="table-section-label">Plans & features</p>

  <div class="items-kr-wrap" data-name="items-kr">
    <!-- 라벨 열 -->
    <div class="col-label">
      <div class="label-header">혜택 항목</div>
      {#each ROWS as row, i}
        <div class="label-row" class:label-row-alt={i % 2 !== 0}>
          {row.label}
        </div>
      {/each}
    </div>

    <!-- Easy pack 열 -->
    <div class="col-plan col-easy">
      <div class="plan-header-cell">
        <span class="ph-name">Easy pack</span>
        <span class="ph-price">9,900<small>원/월</small></span>
      </div>
      {#each ROWS as row, i}
        <div class="plan-row" class:plan-row-alt={i % 2 !== 0}>{row.easy}</div>
      {/each}
    </div>

    <!-- Pop pack 열 -->
    <div class="col-plan col-pop">
      <div class="plan-header-cell pop-header" data-name="title-bar">
        <span class="ph-name">Pop pack</span>
        <span class="popular-pill">인기</span>
        <span class="ph-price">19,000<small>원/월</small></span>
      </div>
      {#each ROWS as row, i}
        <div class="plan-row pop-row" class:pop-row-alt={i % 2 !== 0}>{row.pop}</div>
      {/each}
    </div>

    <!-- Crazy pack 열 -->
    <div class="col-plan col-crazy">
      <div class="plan-header-cell crazy-header">
        <span class="ph-name">Crazy pack</span>
        <span class="ph-price">29,000<small>원/월</small></span>
      </div>
      {#each ROWS as row, i}
        <div class="plan-row" class:plan-row-alt={i % 2 !== 0}>{row.crazy}</div>
      {/each}
    </div>
  </div>
</section>

<!-- ── Mobile 피처 탭 (<1024px) ──────────────────────────────── -->
<section class="table-mobile" aria-label="멤버십 혜택 비교">
  <!-- 탭 바 -->
  <div class="tab-bar" role="tablist">
    {#each COLS as col, i}
      <button
        class="tab-btn"
        class:tab-active={activeTab === i}
        role="tab"
        aria-selected={activeTab === i}
        onclick={() => { activeTab = i as TabIdx }}
      >
        {col.label}
        {#if col.popular && activeTab === i}
          <span class="tab-popular-active">인기</span>
        {:else if col.popular}
          <span class="tab-popular">인기</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- 슬라이딩 비교 영역 -->
  <div class="tab-body">
    <!-- 라벨 열 (고정) -->
    <div class="tab-labels">
      <div class="tab-header-spacer">혜택 항목</div>
      {#each ROWS as row, i}
        <div class="tab-label-row" class:tab-label-alt={i % 2 !== 0}>
          {row.label}
        </div>
      {/each}
    </div>

    <!-- 슬라이딩 데이터 열 -->
    <div class="tab-data-wrap">
      {#each COLS as col, colIdx}
        <div
          class="tab-col"
          style="
            opacity: {activeTab === colIdx ? 1 : 0};
            transform: translateX({(colIdx - activeTab) * 18}px);
            pointer-events: {activeTab === colIdx ? 'auto' : 'none'};
          "
          aria-hidden={activeTab !== colIdx}
        >
          <!-- 헤더 -->
          <div class="tab-col-header" style="background: {col.headerBg}">
            <span class="tch-name">{col.label}</span>
            {#if col.popular}<span class="tch-popular">인기</span>{/if}
          </div>
          <!-- 행 -->
          {#each ROWS as row, ri}
            {@const data = colIdx === 0 ? row.easy : colIdx === 1 ? row.pop : row.crazy}
            <div
              class="tab-data-row"
              style="background: {ri % 2 === 0 ? col.rowBgs[0] : col.rowBgs[1]}"
            >
              {data}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  <!-- 가입하기 버튼 -->
  <a href="#pricing" class="tab-cta">가입하기</a>
</section>

<style>
  /* ── PC ── */
  .table-pc {
    display: none;
  }
  @media (min-width: 1024px) {
    .table-pc {
      display: flex;
      flex-direction: column;
      gap: 20px;
      width: 1240px;
    }
  }

  .table-section-label {
    font-family: var(--font-en-display);
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-dark);
    margin: 0 0 10px;
  }

  .items-kr-wrap {
    display: flex;
    gap: 0;
  }

  /* PC hover 인터랙션 (App.tsx 정밀 이식) */
  :global([data-name="items-kr"]) > div:nth-child(n+2) {
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                opacity 0.3s ease,
                box-shadow 0.3s ease;
    cursor: pointer;
    border-radius: 30px;
    overflow: hidden;
  }

  :global([data-name="items-kr"]):has(> div:nth-child(n+2):hover) > div:nth-child(n+2) {
    opacity: 0.4;
  }

  :global([data-name="items-kr"]) > div:nth-child(n+2):hover {
    opacity: 1 !important;
    transform: translateY(-8px) scale(1.03);
    box-shadow: 0 24px 48px rgba(16, 11, 50, 0.22),
                0 6px 16px rgba(255, 53, 53, 0.14);
  }

  :global([data-name="items-kr"]) > div:nth-child(n+2):hover :global([data-name="title-bar"]) {
    transition: letter-spacing 0.25s ease;
    letter-spacing: 0.02em;
  }

  /* 라벨 열 */
  .col-label {
    display: flex;
    flex-direction: column;
    width: 200px;
    flex-shrink: 0;
    border-radius: 30px 0 0 30px;
    overflow: hidden;
  }

  .label-header {
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-dark);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
  }

  .label-row {
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    text-align: center;
    background: var(--cs-purple-op10);
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-purple);
    white-space: pre-line;
  }

  .label-row-alt {
    background: var(--cs-purple-pale);
  }

  /* 플랜 열 공통 */
  .col-plan {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .plan-header-cell {
    height: 100px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 16px;
    position: relative;
  }

  .ph-name {
    font-family: var(--font-en-display);
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-dark);
  }

  .ph-price {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-dark);
  }

  .ph-price small {
    font-size: 12px;
    font-weight: 400;
    margin-left: 2px;
  }

  .popular-pill {
    background: var(--cs-red);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 11px;
    font-weight: 700;
    border-radius: 20px;
    padding: 2px 8px;
  }

  /* Easy */
  .col-easy .plan-header-cell { background: transparent; }
  .col-easy .plan-row         { background: var(--cs-white); }
  .col-easy .plan-row-alt     { background: transparent; }

  /* Pop */
  .col-pop { border-radius: 30px 30px 0 0; }
  .pop-header {
    background: var(--cs-red-light);
    border-radius: 30px 30px 0 0;
  }
  .pop-row     { background: var(--cs-chat-in-bg); }
  .pop-row-alt { background: var(--cs-red-light); }

  /* Crazy */
  .col-crazy .plan-header-cell { background: transparent; }
  .col-crazy .plan-row         { background: transparent; }
  .col-crazy .plan-row-alt     { background: var(--cs-purple-op10); }
  .crazy-header { border-radius: 30px; }

  /* 행 공통 */
  .plan-row {
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    text-align: center;
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-dark);
    white-space: pre-line;
  }

  /* ── Mobile ── */
  .table-mobile {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 0 20px 40px;
    width: 100%;
  }
  @media (min-width: 1024px) {
    .table-mobile { display: none; }
  }

  /* 탭 바 */
  .tab-bar {
    display: flex;
    background: var(--cs-dark);
    border-radius: 20px;
    padding: 4px;
    gap: 2px;
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 11px 4px 10px;
    border: none;
    border-radius: 16px;
    background: transparent;
    color: var(--cs-purple-pale);
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.28s, color 0.28s, box-shadow 0.28s;
    white-space: nowrap;
  }

  .tab-btn.tab-active {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-weight: 900;
    box-shadow: 0 4px 14px rgba(255, 53, 53, 0.45);
  }

  .tab-popular {
    background: var(--cs-red);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    border-radius: 6px;
    padding: 1px 5px;
  }

  .tab-popular-active {
    background: rgba(255, 255, 255, 0.22);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    border-radius: 6px;
    padding: 1px 5px;
  }

  /* 탭 바디 */
  .tab-body {
    display: flex;
    overflow: hidden;
    border-radius: 20px;
  }

  /* 라벨 열 (고정) */
  .tab-labels {
    display: flex;
    flex-direction: column;
    width: 90px;
    flex-shrink: 0;
  }

  .tab-header-spacer {
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-dark);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    padding: 0 8px;
  }

  .tab-label-row {
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    text-align: center;
    background: #EAE8F5;
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 700;
    color: #6B5FAA;
    white-space: pre-line;
  }

  .tab-label-alt { background: #F3F2FA; }

  /* 슬라이딩 데이터 */
  .tab-data-wrap {
    position: relative;
    flex: 1;
    overflow: hidden;
  }

  .tab-col {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    transition: opacity 0.35s ease,
                transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  .tab-col-header {
    height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .tch-name {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-dark);
  }

  .tch-popular {
    background: var(--cs-red);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    border-radius: 6px;
    padding: 1px 6px;
  }

  .tab-data-row {
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    text-align: center;
    font-family: var(--font-kr);
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-dark);
    white-space: pre-line;
    flex-shrink: 0;
  }

  /* 가입하기 */
  .tab-cta {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    border-radius: var(--radius-xl);
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    padding: 13px 0;
    text-decoration: none;
    transition: background 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tab-cta:hover {
    background: #E02020;
    transform: scale(1.03);
    box-shadow: 0 6px 20px rgba(255, 53, 53, 0.45);
  }
  .tab-cta:active {
    background: var(--cs-red);
    transform: scale(0.96);
  }
</style>
