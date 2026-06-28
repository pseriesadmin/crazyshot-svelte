<script lang="ts">
  import { enhance } from '$app/forms'
  import { browser } from '$app/environment'
  import type { ActionData } from './$types'

  interface Props { form: ActionData }
  let { form }: Props = $props()

  let isLoading = $state(false)
  let cmsRole = $state<'manager' | 'partner'>('manager')
  let concurrent = $state(true)
  let sessionLimit = $state(false)
  let copied = $state(false)

  type FormResult = {
    error?: string
    success?: boolean
    inviteLink?: string
    email?: string
  } | null

  let result = $derived(form as FormResult)

  let fullInviteLink = $derived(
    browser && result?.inviteLink
      ? window.location.origin + result.inviteLink
      : (result?.inviteLink ?? '')
  )

  // 성공 시 자동 복사
  $effect(() => {
    if (browser && result?.success && fullInviteLink) {
      window.navigator.clipboard.writeText(fullInviteLink).catch(() => {})
    }
  })

  async function copyLink() {
    await window.navigator.clipboard.writeText(fullInviteLink)
    copied = true
    setTimeout(() => { copied = false }, 2000)
  }
</script>

<svelte:head><title>계정 관리 — CrazyShot CMS</title></svelte:head>

<div class="accounts-wrap">
  <div class="accounts-card">

    {#if result?.success && result.inviteLink}
      <!-- 초대링크 발행 완료 화면 -->
      <h1 class="page-title">관리계정 초대링크 정보</h1>

      <div class="invite-box">
        <p class="invite-label">초대 링크가 생성되었습니다</p>
        <code class="invite-link">{fullInviteLink}</code>
        <p class="invite-hint">{result.email}에 전달해 주세요.</p>
      </div>

      <button class="cta-btn" type="button" onclick={copyLink}>
        {copied ? '✓ 복사됨' : '초대링크 복사'}
      </button>

    {:else}
      <!-- 계정 등록 폼 -->
      <h1 class="page-title">관리자 계정 등록</h1>

      {#if result?.error}
        <p class="error-msg" role="alert">{result.error}</p>
      {/if}

      <form
        method="POST"
        action="?/createAccount"
        use:enhance={() => {
          isLoading = true
          return async ({ update }) => { await update(); isLoading = false }
        }}
        class="account-form"
      >
        <label class="field-label" for="name">이름</label>
        <input id="name" name="name" type="text" class="f-input" placeholder="홍길동" required />

        <label class="field-label" for="email">계정 (이메일)</label>
        <input id="email" name="email" type="email" class="f-input" placeholder="manager@crazyshot.kr" required />

        <label class="field-label" for="phone">휴대번호</label>
        <input id="phone" name="phone" type="tel" class="f-input" placeholder="010-0000-0000" required />

        <input type="hidden" name="cms_role" value={cmsRole} />

        <fieldset class="radio-group">
          <legend class="field-label">접근 권한</legend>
          <div class="radio-row">
            <label class="radio-label">
              <input type="radio" name="_role" value="manager" checked={cmsRole === 'manager'} onchange={() => cmsRole = 'manager'} />
              매니저
            </label>
            <label class="radio-label">
              <input type="radio" name="_role" value="partner" checked={cmsRole === 'partner'} onchange={() => cmsRole = 'partner'} />
              파트너
            </label>
          </div>
        </fieldset>

        <input type="hidden" name="cms_allow_concurrent_login" value={String(concurrent)} />

        <div class="toggle-row">
          <span class="field-label">중복 로그인 허용</span>
          <button
            type="button"
            class="toggle-btn"
            class:on={concurrent}
            onclick={() => concurrent = !concurrent}
            aria-pressed={concurrent}
          >
            {concurrent ? 'ON' : 'OFF'}
          </button>
        </div>

        <input type="hidden" name="cms_session_timeout_hours" value={String(sessionLimit)} />

        <div class="toggle-row">
          <span class="field-label">세션 제한 (24시간 미활동 시 로그아웃)</span>
          <button
            type="button"
            class="toggle-btn"
            class:on={sessionLimit}
            onclick={() => sessionLimit = !sessionLimit}
            aria-pressed={sessionLimit}
          >
            {sessionLimit ? 'ON' : 'OFF'}
          </button>
        </div>

        <button class="cta-btn" type="submit" disabled={isLoading}>
          {isLoading ? '처리 중...' : '등록 및 초대 링크 발송'}
        </button>
      </form>
    {/if}

  </div>
</div>

<style>
  .accounts-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    background: var(--cs-lilac);
  }

  .accounts-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 48px 40px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .page-title {
    font: var(--text-m-title-21);
    color: var(--cs-dark);
    margin: 0 0 4px;
  }

  .account-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text);
    display: block;
    margin-bottom: -4px;
  }

  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-md);
    padding: 14px 18px;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .radio-group {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .radio-row {
    display: flex;
    gap: 24px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    cursor: pointer;
    min-height: 44px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .toggle-btn {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-full);
    padding: 8px 20px;
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    min-height: 44px;
    min-width: 72px;
  }
  .toggle-btn.on {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

  .cta-btn {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    height: 56px;
    font: var(--text-m-body-16B);
    cursor: pointer;
    margin-top: 8px;
    transition: background 0.15s;
  }
  .cta-btn:hover    { background: var(--cs-purple-hover); }
  .cta-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .error-msg {
    background: var(--cs-bg-error);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    font: var(--text-m-script-14);
    color: var(--cs-red-badge);
    margin: 0;
  }

  .invite-box {
    background: var(--cs-bg-success);
    border-radius: var(--radius-md);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .invite-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text-success);
    margin: 0;
  }
  .invite-link {
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font-size: 12px;
    word-break: break-all;
    color: var(--cs-text);
  }
  .invite-hint {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }
</style>
