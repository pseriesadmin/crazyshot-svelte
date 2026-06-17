<script lang="ts">
  interface Props {
    startDate: string;
    endDate: string;
    onStartDateChange?: (date: string) => void;
    onEndDateChange?: (date: string) => void;
    onMethodChange?: (method: string) => void;
    selectedMethod?: string;
  }

  let {
    startDate,
    endDate,
    onStartDateChange,
    onEndDateChange,
    onMethodChange,
    selectedMethod = 'crazydelivery'
  }: Props = $props();

  // 렌탈 기간 분류 계산 ($derived: props 변경 시 재계산)
  let rentalDays = $derived(Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) /
    (1000 * 60 * 60 * 24)
  ));

  let rentalType = $derived.by(() => {
    if (rentalDays <= 7) return '일간 (1~7일)';
    if (rentalDays <= 30) return '주간 (8~30일)';
    return '월간 (31일+)';
  });

  function readFieldValue(event: { currentTarget: { value: string } }): string {
    return event.currentTarget.value;
  }
</script>

<div class="rental-options">
  <h3 class="section-title">렌탈 옵션</h3>

  <div class="date-group">
    <div class="date-input">
      <label for="start-date">시작일</label>
      <input 
        id="start-date"
        type="date" 
        value={startDate}
        onchange={(e) => onStartDateChange?.(readFieldValue(e))}
        min={new Date().toISOString().split('T')[0]}
      />
    </div>

    <div class="date-input">
      <label for="end-date">종료일</label>
      <input 
        id="end-date"
        type="date" 
        value={endDate}
        onchange={(e) => onEndDateChange?.(readFieldValue(e))}
        min={startDate}
      />
    </div>
  </div>

  <div class="rental-period">
    <div class="period-info">
      <span class="label">렌탈 기간</span>
      <span class="value">{rentalDays}일 ({rentalType})</span>
    </div>
  </div>

  <div class="shipment-group">
    <label for="shipment-method">배송 방식</label>
    <select 
      id="shipment-method"
      value={selectedMethod}
      onchange={(e) => onMethodChange?.(readFieldValue(e))}
    >
      <option value="crazydelivery">크레이지배송 (무료, 19:00 마감)</option>
      <option value="quick">특급배송 (5k, 17:00 마감)</option>
      <option value="locker">락커 (5k, 18:00 마감)</option>
      <option value="visit">픽업 (5k, 19:00 마감)</option>
      <option value="airport">공항배송 (5k, 15:00 마감)</option>
    </select>
  </div>
</div>

<style>
  .rental-options {
    padding: var(--spacing-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }

  .section-title {
    margin: 0 0 var(--spacing-4) 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .date-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-3);
    margin-bottom: var(--spacing-4);
  }

  .date-input {
    display: flex;
    flex-direction: column;
  }

  .date-input label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-bottom: var(--spacing-2);
  }

  .date-input input {
    padding: var(--spacing-2) var(--spacing-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 1rem;
    color: var(--color-text);
    background: var(--color-surface);
    min-height: 44px;
  }

  .date-input input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(255, 69, 0, 0.1);
  }

  .rental-period {
    padding: var(--spacing-3);
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    margin-bottom: var(--spacing-4);
  }

  .period-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .period-info .label {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .period-info .value {
    font-weight: 600;
    color: var(--color-text);
  }

  .shipment-group {
    display: flex;
    flex-direction: column;
  }

  .shipment-group label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-bottom: var(--spacing-2);
  }

  .shipment-group select {
    padding: var(--spacing-2) var(--spacing-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    color: var(--color-text);
    background: var(--color-surface);
    min-height: 44px;
    cursor: pointer;
  }

  .shipment-group select:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(255, 69, 0, 0.1);
  }
</style>
