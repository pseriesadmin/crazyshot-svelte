<script lang="ts">
  import { goto } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'
  import { callTypedRpc } from '$lib/utils/rpc'
  import { unregisterCurrentPushToken } from '$lib/utils/push'
  import type { UserProfile } from '../../../../routes/account/profile/+page.server'

  interface Props {
    profile: UserProfile | null
    onswitchtab: (tab: string) => void
  }
  let { profile, onswitchtab }: Props = $props()

  // ── 탈퇴 사유 목록 (다중선택)
  const REASONS = [
    { value: 'no_longer_use',      label: '서비스를 더 이상 이용하지 않아요' },
    { value: 'lack_of_options',    label: '원하는 장비·상품이 부족해요' },
    { value: 'complex_process',    label: '대여 절차가 복잡하거나 불편해요' },
    { value: 'using_other_service', label: '다른 서비스를 이용하고 있어요' },
    { value: 'etc',                label: '기타(직접 입력)' },
  ] as const

  type ReasonValue = typeof REASONS[number]['value']

  let selectedReasons = $state<ReasonValue[]>([])
  let etcText = $state('')
  let submitting = $state(false)

  const isEtcSelected = $derived(selectedReasons.includes('etc'))
  const canSubmit = $derived(selectedReasons.length > 0 && !submitting)

  // 이미 탈회 신청된 경우: 삭제 예정일 표시
  const purgeAtDisplay = $derived(
    profile?.withdrawal_purge_at
      ? new Date(profile.withdrawal_purge_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
      : '산정 중'
  )

  function toggleReason(value: ReasonValue) {
    if (selectedReasons.includes(value)) {
      selectedReasons = selectedReasons.filter(r => r !== value)
      if (value === 'etc') etcText = ''
    } else {
      selectedReasons = [...selectedReasons, value]
    }
  }

  async function handleWithdrawal() {
    if (!canSubmit) return

    const confirmed = window.confirm(
      '정말 탈퇴하시겠습니까?\n탈퇴 후 30일 이내 로그인 시 계정이 복구됩니다.\n진행 중인 대여·예약·포인트·쿠폰은 모두 소멸됩니다.'
    )
    if (!confirmed) return

    submitting = true
    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      supabase,
      'request_account_withdrawal',
      {
        p_reasons: selectedReasons as string[],
        p_reason_etc: isEtcSelected && etcText.trim() ? etcText.trim() : null,
      },
    )
    submitting = false

    if (error || !(data as { ok?: boolean })?.ok) {
      const msg = (data as { error?: string })?.error ?? '탈퇴 처리 중 오류가 발생했습니다.'
      csToast.error(msg)
      return
    }

    // 탈퇴 성공 → 로그아웃 시퀀스 (account/+page.svelte handleLogout 동일 패턴)
    await unregisterCurrentPushToken()
    await supabase.auth.signOut()
    goto('/')
  }
</script>

{#if profile?.withdrawal_status === 'requested'}
  <!-- 이미 탈회 신청된 상태 안내 -->
  <div class="bg-white w-full">
    <div class="flex flex-col gap-[24px] items-start px-[25px] py-[40px]">
      <div class="flex flex-col gap-[8px]">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          탈회 신청 완료
        </p>
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#888] tracking-[-0.5px] leading-[1.6]">
          이미 탈회가 신청된 상태입니다.
        </p>
      </div>
      <div class="notice-block">
        <p class="notice-title">신청 안내</p>
        <ul class="notice-list">
          <li>개인정보 자동 삭제 예정일: <strong class="text-[#444]">{purgeAtDisplay}</strong></li>
          <li>삭제 예정일 이전에 동일 계정으로 다시 로그인하면 탈퇴 신청이 자동으로 취소되고 계정이 복구됩니다.</li>
          <li>예정일이 지나면 개인정보는 완전히 삭제되며 복구할 수 없습니다.</li>
        </ul>
      </div>
    </div>
  </div>
{:else}
<div class="bg-white w-full">
  <div class="flex flex-col gap-[24px] items-start px-[25px] py-[40px]">

    <!-- 헤더 -->
    <div class="flex flex-col gap-[8px]">
      <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6]">
        회원 탈퇴 안내
      </p>
      <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#888] tracking-[-0.5px] leading-[1.6]">
        그동안 Crazyshot을 이용해 주셔서 감사합니다.<br />탈퇴 전, 아래 내용을 가볍게 확인해 주세요 🙂
      </p>
    </div>

    <!-- 탈퇴 사유 선택 -->
    <div class="flex flex-col gap-[12px] w-full">
      <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">
        탈퇴 사유 <span class="text-[#888] font-normal">(복수선택 가능)</span>
      </p>
      <div class="reason-wrap">
        {#each REASONS as reason (reason.value)}
          <button
            type="button"
            class="combo-btn"
            class:combo-btn-active={selectedReasons.includes(reason.value)}
            disabled={submitting}
            onclick={() => toggleReason(reason.value)}
          >
            <span class="combo-label">{reason.label}</span>
          </button>
        {/each}
      </div>

      <!-- 기타 텍스트 입력 -->
      {#if isEtcSelected}
        <div class="etc-wrap">
          <textarea
            class="etc-input"
            placeholder="탈퇴 사유를 입력해 주세요"
            maxlength="300"
            rows="3"
            disabled={submitting}
            bind:value={etcText}
          ></textarea>
          <p class="etc-count">{etcText.length} / 300</p>
        </div>
      {/if}
    </div>

    <!-- 유의사항 안내 블록 -->
    <div class="notice-block">
      <p class="notice-title">탈퇴 전 확인사항</p>
      <ul class="notice-list">
        <li>탈퇴 후 30일간 개인정보가 보관되며, 이 기간 안에 동일 계정으로 다시 로그인하면 자동으로 계정이 복구됩니다. 30일이 지나면 개인정보는 완전히 삭제되며 복구할 수 없습니다.</li>
        <li>진행 중인 대여 주문, 예약, 보관 중인 포인트·쿠폰은 탈퇴와 동시에 모두 소멸되며 복구되지 않습니다.</li>
        <li>관련 법령(전자상거래법 등)에 따라 보존이 의무화된 거래 기록은 별도 기간 동안 보관될 수 있습니다.</li>
      </ul>
    </div>

    <!-- 최종 탈회하기 버튼 -->
    <button
      type="button"
      class="withdraw-btn"
      disabled={!canSubmit}
      onclick={handleWithdrawal}
    >
      {submitting ? '처리 중...' : '최종 탈회하기'}
    </button>

  </div>
</div>
{/if}

<style>
  button:focus { outline: none; }
  button:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: 2px; border-radius: 4px; }

  /* ━━━ 사유 선택 버튼 래퍼 (세로 정렬) ━━━ */
  .reason-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  /* ━━━ 콤보 버튼 (NotificationTabContent.svelte 패턴 재사용) ━━━ */
  .combo-btn {
    display: flex;
    align-items: center;
    padding: 9px 16px;
    border-radius: var(--radius-xl);
    border: 1.5px solid #DCDCDC;
    background: #fff;
    cursor: pointer;
    transition: all 0.18s;
    white-space: nowrap;
    text-align: left;
    min-height: 44px;
  }
  .combo-btn:hover:not(:disabled) {
    border-color: var(--cs-purple);
    background: #F5F4FA;
  }
  .combo-btn-active {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
  }
  .combo-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .combo-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .combo-btn-active .combo-label { color: #fff; }

  /* ━━━ 기타 텍스트 입력 ━━━ */
  .etc-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }
  .etc-input {
    width: 100%;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    border: 1.5px solid #DCDCDC;
    background: #fff;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: var(--cs-text);
    letter-spacing: -0.5px;
    line-height: 1.6;
    resize: none;
    transition: border-color 0.18s;
    box-sizing: border-box;
  }
  .etc-input:focus {
    outline: none;
    border-color: var(--cs-purple);
  }
  .etc-input:disabled { opacity: 0.6; cursor: not-allowed; }
  .etc-input::placeholder { color: #aaa; }
  .etc-count {
    text-align: right;
    font-size: 12px;
    font-weight: 500;
    color: #aaa;
    font-family: 'Noto Sans KR', sans-serif;
  }

  /* ━━━ 유의사항 안내 블록 ━━━ */
  .notice-block {
    width: 100%;
    background: #F6F6F6;
    border-radius: var(--radius-md);
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
  }
  .notice-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: #444;
    letter-spacing: -0.5px;
  }
  .notice-list {
    margin: 0;
    padding-left: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .notice-list li {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #666;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }

  /* ━━━ 최종 탈회하기 버튼 ━━━ */
  .withdraw-btn {
    width: 100%;
    min-height: 50px;
    padding: 0 24px;
    border-radius: var(--radius-xl);
    border: none;
    background: var(--cs-red-badge, #FF3535);
    color: #fff;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.5px;
    cursor: pointer;
    transition: opacity 0.18s;
  }
  .withdraw-btn:hover:not(:disabled) { opacity: 0.85; }
  .withdraw-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .combo-btn   { padding: 8px 14px; }
    .combo-label { font-size: 12px; }
    .withdraw-btn { min-height: 44px; font-size: 15px; }
  }
</style>
