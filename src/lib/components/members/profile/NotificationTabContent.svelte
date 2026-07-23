<script lang="ts">
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'

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
    const { data, error } = await supabase.rpc('update_notification_settings', {
      p_rental_alert:  nextRental,
      p_benefit_alert: nextBenefit,
    })
    saving = false
    if (error || !(data as { ok?: boolean })?.ok) {
      csToast.error('알림 설정 변경에 실패했습니다.')
      return false
    }
    return true
  }

  async function toggleRental() {
    const next = !rentalState
    rentalState = next
    const ok = await save(next, benefitState)
    if (!ok) rentalState = !next
  }

  async function toggleBenefit() {
    const next = !benefitState
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
        <button onclick={toggleRental} disabled={saving} aria-label="대여예약정보 알림 토글">
          {#if rentalState}
            <div class="h-[20px] w-[32px] bg-[#444] rounded-full flex items-center justify-end p-[3px]">
              <div class="bg-white rounded-full size-[14px] shrink-0"></div>
            </div>
          {:else}
            <div class="h-[20px] w-[32px] bg-white border border-[#aaa] rounded-full flex items-center justify-start p-[3px]">
              <div class="bg-[#aaa] rounded-full size-[14px] shrink-0"></div>
            </div>
          {/if}
        </button>
      </div>

      <div class="flex items-center justify-between w-full">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          혜택정보 알림
        </p>
        <button onclick={toggleBenefit} disabled={saving} aria-label="혜택정보 알림 토글">
          {#if benefitState}
            <div class="h-[20px] w-[32px] bg-[#444] rounded-full flex items-center justify-end p-[3px]">
              <div class="bg-white rounded-full size-[14px] shrink-0"></div>
            </div>
          {:else}
            <div class="h-[20px] w-[32px] bg-white border border-[#aaa] rounded-full flex items-center justify-start p-[3px]">
              <div class="bg-[#aaa] rounded-full size-[14px] shrink-0"></div>
            </div>
          {/if}
        </button>
      </div>
    </div>

    <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6] w-full">
      -대여예약정보 알림은 초기에 기본 허용 필수.
    </p>

  </div>
</div>

<style>
  button { border: none; background: none; padding: 0; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  button:focus { outline: none; }
  button:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: 2px; border-radius: 4px; }
</style>
