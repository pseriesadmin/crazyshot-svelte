<script lang="ts">
  // 전자계약서 원본 확인 (공개, 로그인 불필요)
  // 받은 PDF가 서명 당시 크레이지샷이 보관한 원본과 똑같은지 확인한다. 파일은 서버로 보내지 않고 이 기기에서 파일 지문(SHA-256)만
  // 계산해 보낸다 — 판정은 서버의 보관 기록과의 대조로만 한다(PDF 안에 적힌 해시 글자는 위조될 수 있어 근거로 쓰지 않는다).
  import { MAX_VERIFY_FILE_BYTES, sha256HexOfFile } from '$lib/utils/fileHash'

  type Status = 'authentic' | 'superseded' | 'modified' | 'not_found'
  interface VerifyResponse {
    status: Status
    info: { signedAtKst: string; source: 'original' | 'regenerated'; reservationCode: string | null } | null
    sha256: string
    checkedAt: string
  }

  let phase = $state<'idle' | 'working' | 'done' | 'error'>('idle')
  let fileName = $state('')
  let result = $state<VerifyResponse | null>(null)
  let errorText = $state('')
  let fileInput: HTMLInputElement | null = $state(null)

  function formatChecked(iso: string): string {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return
    result = null
    errorText = ''
    fileName = file.name
    if (file.size > MAX_VERIFY_FILE_BYTES) {
      phase = 'error'
      errorText = '파일이 너무 커요(최대 20MB). 크레이지샷에서 받은 계약서 PDF를 선택해 주세요.'
      return
    }
    phase = 'working'
    try {
      const sha256 = await sha256HexOfFile(file)
      const res = await fetch('/api/contracts/verify-file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha256 }),
      })
      if (res.status === 429) throw new Error('요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')
      if (!res.ok) throw new Error('확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
      result = (await res.json()) as VerifyResponse
      phase = 'done'
    } catch (e) {
      errorText = e instanceof Error ? e.message : '확인에 실패했어요. 잠시 후 다시 시도해 주세요.'
      phase = 'error'
    }
  }

  function onPick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement
    void handleFile(input.files?.[0])
    input.value = '' // 같은 파일을 다시 골라도 확인되도록 초기화
  }
</script>

<svelte:head>
  <title>전자계약서 원본 확인 — 크레이지샷</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="verify-page">
  <section class="verify-card">
    <h1 class="verify-title">전자계약서 원본 확인</h1>
    <p class="verify-lead">
      받으신 계약서 PDF가 <strong>서명 당시 크레이지샷이 보관한 원본</strong>과 똑같은지 확인해요.
      파일은 서버로 전송되지 않고, 이 기기에서 파일 지문만 계산해 비교합니다.
    </p>

    <input
      class="verify-file-input"
      type="file"
      accept="application/pdf,.pdf"
      bind:this={fileInput}
      onchange={onPick}
      aria-label="확인할 계약서 PDF 파일 선택"
    />
    <button type="button" class="verify-pick-btn" onclick={() => fileInput?.click()} disabled={phase === 'working'}>
      {phase === 'working' ? '확인하는 중…' : 'PDF 파일 선택'}
    </button>
    {#if fileName}<p class="verify-file-name">{fileName}</p>{/if}

    {#if phase === 'error'}
      <div class="verify-result verify-ng" role="alert"><strong>{errorText}</strong></div>
    {:else if phase === 'done' && result}
      {#if result.status === 'authentic'}
        <div class="verify-result verify-ok" role="status">
          <strong>서명 당시 보관된 원본과 일치합니다</strong>
          {#if result.info}
            <dl class="verify-info">
              <dt>서명 일시</dt><dd>{result.info.signedAtKst} (한국시간)</dd>
              {#if result.info.reservationCode}<dt>예약코드</dt><dd>{result.info.reservationCode}</dd>{/if}
              <dt>보관본 구분</dt><dd>{result.info.source === 'original' ? '서명 시점 원본' : '재생성본(서명 당시 저장된 내용으로 다시 만든 사본)'}</dd>
            </dl>
          {/if}
        </div>
      {:else if result.status === 'superseded'}
        <div class="verify-result verify-warn" role="status">
          <strong>서명 당시 발급된 문서이지만, 현재는 효력이 없는 이전 본입니다</strong>
          <p>이후 계약이 취소되었거나 다시 서명되어 새 계약서가 있습니다. 최신 계약서 PDF를 받아 다시 확인해 주세요.</p>
        </div>
      {:else}
        <div class="verify-result verify-ng" role="alert">
          <strong>보관된 원본과 일치하지 않습니다</strong>
          <p>
            내용을 고쳤거나, 다른 프로그램·AI로 다시 저장·변환한 파일이면 눈으로 같아 보여도 일치하지 않아요.
            크레이지샷에서 받은 원본 PDF로 다시 확인하시거나 고객센터로 문의해 주세요.
          </p>
        </div>
      {/if}
      <p class="verify-meta">확인 일시 {formatChecked(result.checkedAt)} · 파일 지문(SHA-256) <span class="verify-hash">{result.sha256}</span></p>
    {/if}

    <ul class="verify-notes">
      <li>진위는 문서 안에 적힌 해시 값이 아니라 <strong>이 화면의 확인 결과</strong>로만 판단하세요. 문서 안의 글자는 고쳐 쓸 수 있어요.</li>
      <li>이 화면을 캡처한 이미지는 증빙이 되지 않아요. 제출·확인이 필요하면 <strong>crazyshot.kr/contract-verify</strong>에서 직접 확인하세요.</li>
      <li>PDF를 열어 보기만 해도 파일은 바뀌지 않지만, 편집 프로그램에서 저장하면 다른 파일이 됩니다.</li>
    </ul>
  </section>
</div>

<style>
  .verify-page {
    min-height: 100dvh;
    padding: 40px 25px 80px;
    background: var(--cs-lilac);
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }
  .verify-card {
    width: 100%;
    max-width: 640px;
    padding: 36px 32px;
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    color: var(--cs-text);
  }
  .verify-title { margin: 0 0 12px; font: var(--text-pc-htitle-25); }
  .verify-lead { margin: 0 0 24px; font: var(--text-pc-body-14); color: var(--cs-text-dark); line-height: 1.7; }
  .verify-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .verify-pick-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 50px;
    padding: 0 30px;
    border: none;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .verify-pick-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .verify-pick-btn:disabled { background: var(--cs-text-light); cursor: default; }
  .verify-file-name { margin: 10px 0 0; font: var(--text-pc-script-12); color: var(--cs-text-mid); word-break: break-all; }

  .verify-result { margin-top: 20px; padding: 18px 20px; border-radius: var(--radius-lg); font: var(--text-pc-body-14); line-height: 1.7; }
  .verify-result p { margin: 8px 0 0; font-weight: 500; }
  .verify-ok { background: var(--cs-surface-gray); }
  .verify-warn { background: var(--cs-purple-op10); }
  .verify-ng { background: var(--cs-red-xlight); }
  .verify-info { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 12px 0 0; }
  .verify-info dt { color: var(--cs-text-mid); }
  .verify-info dd { margin: 0; }
  .verify-meta { margin: 14px 0 0; font: var(--text-pc-script-12); color: var(--cs-text-mid); line-height: 1.7; }
  .verify-hash { word-break: break-all; }
  .verify-notes { margin: 28px 0 0; padding-left: 18px; font: var(--text-pc-script-12); color: var(--cs-text-mid); line-height: 1.8; }

  @media (max-width: 640px) {
    .verify-page { padding: 24px 25px 60px; }
    .verify-card { padding: 28px 20px; border-radius: 30px; }
    .verify-title { font: var(--text-m-htitle-24B); }
    .verify-lead { font: var(--text-m-script-14B); }
    .verify-pick-btn { height: 44px; padding: 0 20px; font: var(--text-m-body-16B); width: 100%; }
    .verify-result { border-radius: 20px; font: var(--text-m-script-14B); }
    .verify-notes, .verify-file-name, .verify-meta { font: var(--text-m-script-12); }
  }
</style>
