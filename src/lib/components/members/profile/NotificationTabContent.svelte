<script lang="ts">
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'
  import { callTypedRpc } from '$lib/utils/rpc'

  interface Props {
    rentalAlert:  boolean
    benefitAlert: boolean
  }
  let { rentalAlert, benefitAlert }: Props = $props()

  let rentalState  = $state(rentalAlert)
  let benefitState = $state(benefitAlert)
  let saving = $state(false)

  async function save(nextRental: boolean, nextBenefit: boolean) {
    if (saving) return
    saving = true
    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      supabase,
      'update_notification_settings',
      { p_rental_alert: nextRental, p_benefit_alert: nextBenefit },
    )
    saving = false
    if (error || !(data as { ok?: boolean })?.ok) {
      csToast.error('알림 설정 변경에 실패했습니다.')
      return false
    }
    return true
  }

  async function setRental(next: boolean) {
    if (saving || next === rentalState) return
    rentalState = next
    const ok = await save(next, benefitState)
    if (!ok) rentalState = !next
  }

  async function setBenefit(next: boolean) {
    if (saving || next === benefitState) return
    benefitState = next
    const ok = await save(rentalState, next)
    if (!ok) benefitState = !next
  }
</script>

<div class="bg-white w-full">
  <div class="flex flex-col gap-[20px] items-start px-[25px] py-[40px]">

    <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6] whitespace-nowrap">
      알림설정
    </p>

    <div class="flex flex-col gap-[20px] w-full">
      <div class="flex items-center justify-between w-full">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          대여예약정보 알림
        </p>
        <div class="combo-wrap" role="group" aria-label="대여예약정보 알림 설정">
          <button
            type="button"
            class="combo-btn"
            class:combo-btn-active={rentalState}
            disabled={saving}
            onclick={() => setRental(true)}
          ><span class="combo-label">켜짐</span></button>
          <button
            type="button"
            class="combo-btn"
            class:combo-btn-active={!rentalState}
            disabled={saving}
            onclick={() => setRental(false)}
          ><span class="combo-label">꺼짐</span></button>
        </div>
      </div>

      <div class="flex items-center justify-between w-full">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          혜택정보 알림
        </p>
        <div class="combo-wrap" role="group" aria-label="혜택정보 알림 설정">
          <button
            type="button"
            class="combo-btn"
            class:combo-btn-active={benefitState}
            disabled={saving}
            onclick={() => setBenefit(true)}
          ><span class="combo-label">켜짐</span></button>
          <button
            type="button"
            class="combo-btn"
            class:combo-btn-active={!benefitState}
            disabled={saving}
            onclick={() => setBenefit(false)}
          ><span class="combo-label">꺼짐</span></button>
        </div>
      </div>
    </div>

    <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6] w-full">
      -대여예약정보 알림은 초기에 기본 허용 필수.
    </p>

  </div>
</div>

<style>
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  button:focus { outline: none; }
  button:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: 2px; border-radius: 4px; }

  /* ━━━ 콤보 버튼 선택 그룹(front-uiux.md §16) — 알림 켜짐/꺼짐 단일 선택 ━━━ */
  .combo-wrap {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .combo-wrap::-webkit-scrollbar { display: none; }

  .combo-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: var(--radius-xl);
    border: 1.5px solid #DCDCDC;
    background: #fff;
    cursor: pointer;
    transition: all 0.18s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .combo-btn:hover:not(:disabled) {
    border-color: var(--cs-purple);
    background: #F5F4FA;
  }
  .combo-btn-active {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
  }

  .combo-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .combo-btn-active .combo-label { color: #fff; }

  @media (max-width: 640px) {
    .combo-btn   { padding: 8px 12px; }
    .combo-label { font-size: 12px; }
  }
</style>
