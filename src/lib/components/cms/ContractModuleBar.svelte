<script lang="ts">
  import type { ContentBlock } from '$lib/types/content-editor'

  interface Props {
    onInsertBlocks: (blocks: ContentBlock[]) => void
  }

  let { onInsertBlocks }: Props = $props()

  // TextBlock으로 삽입 — contenteditable에서 테이블 WYSIWYG 렌더링
  const CUSTOMER_HTML = `<table class="cs-contract-table" style="width:100%;border-collapse:collapse;"><tbody><tr><th style="width:90px;padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">성명</th><td style="padding:6px 10px;border:1px solid #ddd;">{{고객이름}}</td></tr><tr><th style="width:90px;padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">연락처</th><td style="padding:6px 10px;border:1px solid #ddd;">{{연락처}}</td></tr><tr><th style="width:90px;padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">이메일</th><td style="padding:6px 10px;border:1px solid #ddd;">{{이메일}}</td></tr><tr><th style="width:90px;padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">주소</th><td style="padding:6px 10px;border:1px solid #ddd;">{{주소}}</td></tr></tbody></table>`

  const RESERVATION_HTML = `<table class="cs-contract-table" style="width:100%;border-collapse:collapse;"><tbody><tr><th style="width:110px;padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">예약코드</th><td style="padding:6px 10px;border:1px solid #ddd;">{{예약코드}}</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">상품명</th><td style="padding:6px 10px;border:1px solid #ddd;">{{상품명}} ({{상품코드}})</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">수량</th><td style="padding:6px 10px;border:1px solid #ddd;">{{수량}}</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">수령</th><td style="padding:6px 10px;border:1px solid #ddd;">{{수령형태}} / {{수령일시}}</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">반납</th><td style="padding:6px 10px;border:1px solid #ddd;">{{반납형태}} / {{반납일시}}</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">기본 대여요금</th><td style="padding:6px 10px;border:1px solid #ddd;">{{기본대여요금}}</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">할인금액</th><td style="padding:6px 10px;border:1px solid #ddd;">{{할인금액}}</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">부가세</th><td style="padding:6px 10px;border:1px solid #ddd;">{{부가세}}</td></tr><tr><th style="padding:6px 10px;background:#f6f6f6;border:1px solid #ddd;font-weight:700;text-align:left;">최종 합계</th><td style="padding:6px 10px;border:1px solid #ddd;font-weight:700;">{{최종합계}}</td></tr></tbody></table>`

  const MODULES = [
    {
      id: 'customer',
      label: '고객 정보',
      desc: '이름·연락처·이메일·주소',
      html: CUSTOMER_HTML,
    },
    {
      id: 'reservation',
      label: '예약 정보',
      desc: '예약코드·상품·일정·요금',
      html: RESERVATION_HTML,
    },
  ]
</script>

<div class="module-bar">
  <div class="module-bar-head">
    <span class="module-icon">⊞</span>
    <span class="module-title">데이터 자동 삽입</span>
    <span class="module-hint">버튼 클릭 시 본문에 변수 테이블이 삽입됩니다</span>
  </div>
  <div class="module-chips">
    {#each MODULES as m}
      <button
        type="button"
        class="module-chip"
        onclick={() => onInsertBlocks([{ type: 'text', html: m.html }])}
        title={m.desc}
      >
        <span class="chip-label">{m.label}</span>
        <span class="chip-desc">{m.desc}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .module-bar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(59, 47, 138, 0.03);
    border: 1px solid rgba(59, 47, 138, 0.15);
    border-radius: var(--cms-radius-sm);
    margin-bottom: 4px;
  }

  .module-bar-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .module-icon {
    font-size: 13px;
    color: var(--cs-purple);
    line-height: 1;
  }

  .module-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-purple);
    white-space: nowrap;
  }

  .module-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin-left: 4px;
  }

  .module-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .module-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 7px 14px;
    border: 1px solid rgba(59, 47, 138, 0.3);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }

  .module-chip:hover {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple);
  }

  .chip-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-purple);
    white-space: nowrap;
  }

  .chip-desc {
    font-size: 10px;
    color: var(--cs-text-light);
    white-space: nowrap;
  }
</style>
