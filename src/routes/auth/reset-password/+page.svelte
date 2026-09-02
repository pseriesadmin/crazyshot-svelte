<script lang="ts">
  import { goto } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'

  let newPassword = $state('')
  let confirmPassword = $state('')
  let showPassword = $state(false)
  let isLoading = $state(false)
  let errorMsg = $state<string | null>(null)
  let done = $state(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    errorMsg = null

    if (newPassword.length < 8) {
      errorMsg = '비밀번호는 8자 이상이어야 합니다.'
      return
    }
    if (newPassword !== confirmPassword) {
      errorMsg = '비밀번호가 일치하지 않습니다.'
      return
    }

    isLoading = true
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      done = true
      csToast.success('비밀번호가 변경되었습니다.')
      setTimeout(() => goto('/auth/login'), 2000)
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다.'
    } finally {
      isLoading = false
    }
  }
</script>

<svelte:head>
  <title>비밀번호 재설정 — 크레이지샷</title>
</svelte:head>

<div class="rp-wrap">
  <div class="rp-card">
    <h1 class="rp-title">비밀번호 재설정</h1>

    {#if done}
      <div class="rp-done">
        <p class="rp-done-msg">비밀번호가 변경되었습니다.</p>
        <p class="rp-done-sub">잠시 후 로그인 화면으로 이동합니다.</p>
      </div>
    {:else}
      <form class="rp-form" onsubmit={handleSubmit}>
        <div class="rp-group">
          <label class="rp-label" for="rp-new">새 비밀번호</label>
          <div class="rp-input-wrap">
            <input
              id="rp-new"
              class="rp-input"
              type={showPassword ? 'text' : 'password'}
              placeholder="8자 이상 입력"
              bind:value={newPassword}
              autocomplete="new-password"
            />
            <button
              type="button"
              class="rp-eye"
              onclick={() => showPassword = !showPassword}
              aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
            >
              {#if showPassword}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              {:else}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              {/if}
            </button>
          </div>
        </div>

        <div class="rp-group">
          <label class="rp-label" for="rp-confirm">새 비밀번호 확인</label>
          <input
            id="rp-confirm"
            class="rp-input"
            type={showPassword ? 'text' : 'password'}
            placeholder="비밀번호를 한 번 더 입력"
            bind:value={confirmPassword}
            autocomplete="new-password"
          />
        </div>

        {#if errorMsg}
          <p class="rp-error" role="alert">{errorMsg}</p>
        {/if}

        <button class="rp-cta" type="submit" disabled={isLoading}>
          {isLoading ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>

      <button class="rp-back" type="button" onclick={() => goto('/auth/login')}>
        변경 비밀번호 로그인하기
      </button>
    {/if}
  </div>
</div>

<style>
  .rp-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-lilac);
    padding: 40px 20px;
  }
  .rp-card {
    background: #fff;
    border-radius: var(--radius-2xl);
    padding: 48px 40px;
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .rp-title {
    font-family: var(--font-kr);
    font-size: 22px;
    font-weight: 900;
    color: var(--cs-text);
    margin: 0;
    text-align: center;
  }
  .rp-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .rp-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rp-label {
    font-family: var(--font-kr);
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .rp-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .rp-input {
    width: 100%;
    height: 48px;
    border: 1.5px solid #e0e0e0;
    border-radius: var(--radius-md);
    padding: 0 44px 0 16px;
    font-family: var(--font-kr);
    font-size: 15px;
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .rp-input:focus { border-color: var(--cs-purple); }
  .rp-eye {
    position: absolute;
    right: 12px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--cs-text-light);
    display: flex;
    align-items: center;
    padding: 0;
    min-height: 36px;
  }
  .rp-error {
    font-family: var(--font-kr);
    font-size: 13px;
    color: var(--cs-red-badge);
    margin: 0;
  }
  .rp-cta {
    height: 52px;
    background: var(--cs-purple);
    color: #fff;
    border: none;
    border-radius: var(--radius-xl);
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
    margin-top: 4px;
  }
  .rp-cta:disabled { opacity: 0.6; cursor: not-allowed; }
  .rp-cta:not(:disabled):hover { opacity: 0.88; }
  .rp-back {
    height: 52px;
    background: var(--cs-red-badge);
    color: #ffffff;
    border: none;
    border-radius: var(--radius-xl);
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .rp-back:hover { opacity: 0.88; }
  .rp-done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 0;
  }
  .rp-done-msg {
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 900;
    color: var(--cs-purple);
    margin: 0;
  }
  .rp-done-sub {
    font-family: var(--font-kr);
    font-size: 13px;
    color: var(--cs-text-mid);
    margin: 0;
  }

  @media (max-width: 480px) {
    .rp-card { padding: 36px 24px; }
    .rp-title { font-size: 20px; }
  }
</style>
