<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { CodeFormat } from './+page.server'
  import { ROOT_COLORS, datePart, buildPreview } from './_shared'

  interface Props {
    data: PageData
    form: ActionData
    dirty?: boolean
  }
  let { data, form, dirty = $bindable(false) }: Props = $props()

  let fmtPrefix  = $state(data.codeFormat.prefix       ?? 'CS')
  let fmtDate    = $state(data.codeFormat.date_format  ?? 'YYMM')
  let fmtSeq     = $state(String(data.codeFormat.seq_digits ?? 3))
  let fmtReset   = $state(data.codeFormat.reset_monthly !== false)
  let fmtSuffix  = $state(data.codeFormat.suffix       ?? '')

  // 현재 탭의 설정값으로 buildPreview 래퍼
  function preview(catCode: string): string {
    const fmt: CodeFormat = {
      prefix: fmtPrefix || 'CS',
      date_format: fmtDate as 'YYMM' | 'YYYYMM',
      seq_digits: Number(fmtSeq) || 3,
      reset_monthly: fmtReset,
      suffix: fmtSuffix,
    }
    return buildPreview(catCode, fmt)
  }

  $effect(() => {
    if (!form) return
    const f = form as { action?: string; success?: boolean; error?: string }
    if (f.error) { csToast.error(f.error); return }
    if (!f.success || f.action !== 'saveFormat') return
    csToast.success('예약코드 형식이 저장되었습니다.')
    dirty = false
  })
</script>

<!-- 토큰 시각화 -->
<div class="fmt-section">
  <div class="fmt-section-title">코드 구조 시각화</div>
  <div class="token-row">
    <div class="token tk-prefix"><span class="tk-val">{fmtPrefix||'CS'}</span><span class="tk-role">접두어</span></div>
    <div class="token tk-cat"><span class="tk-val">CAMML</span><span class="tk-role">분류코드</span></div>
    <div class="token tk-date"><span class="tk-val">{datePart(fmtDate)}</span><span class="tk-role">{fmtDate}</span></div>
    <div class="token tk-seq"><span class="tk-val">{'1'.padStart(Number(fmtSeq)||3,'0')}</span><span class="tk-role">{fmtSeq}자리</span></div>
    {#if fmtSuffix.trim()}
    <div class="token tk-sfx"><span class="tk-val">{fmtSuffix.trim().toUpperCase()}</span><span class="tk-role">접미어</span></div>
    {/if}
  </div>
  <div class="full-preview-box">
    <span class="fp-label">실제 생성 예시</span>
    <span class="fp-code">{preview('CAMML')}</span>
  </div>
</div>

<form method="POST" action="?/saveFormat" use:enhance oninput={() => dirty = true}>

  <!-- 설정 그리드 -->
  <div class="fmt-grid">

    <div class="fmt-card">
      <div class="fc-title"><span class="fc-dot" style="background:var(--cs-dark)"></span>접두어</div>
      <input class="fc-in mono-in" name="prefix" type="text" bind:value={fmtPrefix} maxlength="6" placeholder="CS" autocomplete="off" />
      <p class="fc-hint">영문 대문자·숫자, 최대 6자. 브랜드 식별자.</p>
    </div>

    <div class="fmt-card">
      <div class="fc-title"><span class="fc-dot" style="background:var(--cs-info)"></span>날짜 형식</div>
      <div class="radio-stack">
        <label class="rl" class:rl-on={fmtDate==='YYMM'}>
          <input type="radio" name="date_format" value="YYMM" bind:group={fmtDate} />
          <div><div class="rl-val">YYMM</div><div class="rl-ex">{datePart('YYMM')} — 4자리 간결형</div></div>
        </label>
        <label class="rl" class:rl-on={fmtDate==='YYYYMM'}>
          <input type="radio" name="date_format" value="YYYYMM" bind:group={fmtDate} />
          <div><div class="rl-val">YYYYMM</div><div class="rl-ex">{datePart('YYYYMM')} — 6자리 명시형</div></div>
        </label>
      </div>
    </div>

    <div class="fmt-card">
      <div class="fc-title"><span class="fc-dot" style="background:var(--cs-success-light)"></span>일련번호 자릿수</div>
      <div class="seg-grid">
        {#each [['2','99'], ['3','999'], ['4','9,999'], ['5','99,999'], ['6','999,999']] as [d, cap]}
          <label class="seg" class:seg-on={fmtSeq===d}>
            <input type="radio" name="seq_digits" value={d} bind:group={fmtSeq} />
            <span class="seg-n">{d}자리</span>
            <span class="seg-c">max {cap}</span>
          </label>
        {/each}
      </div>
      <p class="fc-hint">월 최대 자산 등록 수 기준. 렌탈업 표준: 3자리.</p>
    </div>

    <div class="fmt-card">
      <div class="fc-title"><span class="fc-dot" style="background:var(--cs-success-light)"></span>순번 초기화</div>
      <div class="radio-stack">
        <label class="rl" class:rl-on={fmtReset}>
          <input type="radio" name="reset_monthly" value="true" checked={fmtReset} onchange={() => fmtReset=true} />
          <div><div class="rl-val">매월 초기화 <span class="recommend">권장</span></div><div class="rl-ex">월 전환 시 001부터 재시작</div></div>
        </label>
        <label class="rl" class:rl-on={!fmtReset}>
          <input type="radio" name="reset_monthly" value="false" checked={!fmtReset} onchange={() => fmtReset=false} />
          <div><div class="rl-val">누적 증가</div><div class="rl-ex">월과 무관하게 계속 증가</div></div>
        </label>
      </div>
    </div>

    <div class="fmt-card">
      <div class="fc-title"><span class="fc-dot" style="background:var(--cs-warning)"></span>접미어 (선택)</div>
      <input class="fc-in mono-in" name="suffix" type="text" bind:value={fmtSuffix} maxlength="4" placeholder="비워두면 미사용" autocomplete="off" />
      <p class="fc-hint">코드 끝에 추가 식별자. 예: KR, B2B, SER (최대 4자).</p>
    </div>

  </div>

  <!-- 카테고리별 미리보기 -->
  <div class="fmt-section">
    <div class="fmt-section-title">활성 분류코드별 생성 코드 미리보기</div>
    <div class="preview-grid">
      {#each data.codes.filter(c => c.is_active && c.depth === 1).slice(0, 18) as cc}
        {@const color = Object.values(ROOT_COLORS)[data.codes.findIndex(c => c.code === cc.path_codes[0]) % 12] ?? '#888'}
        <div class="pg-item">
          <span class="pg-badge" style="background:{color}">{cc.code}</span>
          <code class="pg-code">{preview(cc.code)}</code>
        </div>
      {/each}
      {#if data.codes.filter(c => c.is_active && c.depth === 1).length > 18}
        <div class="pg-more">+{data.codes.filter(c => c.is_active && c.depth === 1).length - 18}개 더…</div>
      {/if}
    </div>
  </div>

  <!-- 저장 버튼 -->
  <div class="fmt-actions">
    {#if dirty}
      <span class="unsaved">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        저장되지 않은 변경사항
      </span>
    {/if}
    <button type="submit" class="btn-save" class:btn-save-active={dirty}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>
      형식 저장
    </button>
  </div>

</form>

<style>
/* 예약코드 형식 탭 */
.fmt-section { padding: 20px 22px; border-bottom: 1px solid rgba(59,47,138,0.06); }
.fmt-section-title { font: var(--text-pc-descript-10); font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: var(--cs-text-mid); margin-bottom: 12px; }

.token-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.token {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 18px; border-radius: var(--radius-lg); min-width: 68px;
}
.tk-prefix { background: var(--cs-dark); }
.tk-cat    { background: var(--cs-purple); }
.tk-date   { background: var(--cs-info); }
.tk-seq    { background: var(--cs-success-light); }
.tk-sfx    { background: var(--cs-warning); }
.tk-val  { font: var(--text-pc-title-16); font-weight: 700; color: var(--cs-white); letter-spacing: 0.05em; }
.tk-role { font: var(--text-pc-descript-10); color: rgba(255,255,255,0.55); white-space: nowrap; }
.tk-sep  { font: var(--text-pc-title-16); font-weight: 700; color: var(--cs-text-light); padding-bottom: 12px; margin: 0 -2px; }

.full-preview-box {
  display: flex; align-items: center; gap: 14px; padding: 10px 16px;
  background: var(--cs-lilac); border-radius: var(--radius-lg); width: fit-content;
}
.fp-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.fp-code  { font: var(--text-pc-title-18); font-weight: 700; color: var(--cs-text); letter-spacing: 0.07em; }

.fmt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1px; background: rgba(59,47,138,0.06); }
.fmt-card { background: var(--cs-white); padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
.fc-title { display: flex; align-items: center; gap: 7px; font: var(--text-pc-body-14); color: var(--cs-text); }
.fc-dot   { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.fc-in    {
  height: 40px; padding: 0 12px; border: 1.5px solid rgba(59,47,138,0.10);
  border-radius: var(--radius-sm); background: var(--cs-surface-gray);
  font: var(--text-pc-body-14); color: var(--cs-text); width: 110px;
}
.fc-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
.mono-in { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.fc-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; line-height: 1.5; }

.radio-stack { display: flex; flex-direction: column; gap: 6px; }
.rl {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border: 1.5px solid rgba(59,47,138,0.08); border-radius: var(--radius-sm); cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.rl-on { border-color: var(--cs-purple); background: rgba(59,47,138,0.04); }
.rl input[type="radio"] { accent-color: var(--cs-purple); flex-shrink: 0; }
.rl-val { font: var(--text-pc-body-14); color: var(--cs-text); }
.rl-ex  { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin-top: 1px; }
.recommend { display: inline-block; padding: 1px 5px; background: var(--cs-success-light); color: var(--cs-white); border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700; margin-left: 4px; }

.seg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.seg {
  display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 8px 6px;
  border: 1.5px solid rgba(59,47,138,0.08); border-radius: var(--radius-sm); cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.seg-on { border-color: var(--cs-purple); background: rgba(59,47,138,0.04); }
.seg input[type="radio"] { display: none; }
.seg-n { font: var(--text-pc-body-14); color: var(--cs-text); }
.seg-c { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

.preview-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.pg-item { display: flex; align-items: center; gap: 7px; }
.pg-badge {
  display: inline-block; padding: 2px 8px; color: var(--cs-white); border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); font-weight: 700; white-space: nowrap;
}
.pg-code { font: var(--text-pc-script-12); color: var(--cs-text-dark); white-space: nowrap; }
.pg-more { font: var(--text-pc-script-12); color: var(--cs-text-light); align-self: center; }

.fmt-actions {
  display: flex; align-items: center; justify-content: flex-end; gap: 14px;
  padding: 14px 22px; border-top: 1px solid rgba(59,47,138,0.07);
}
.unsaved { display: flex; align-items: center; gap: 5px; font: var(--text-pc-script-12); color: var(--cs-orange); font-weight: 700; }
.btn-save {
  display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 22px;
  border: none; border-radius: var(--radius-sm);
  background: rgba(59,47,138,0.10); color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s, color 0.12s;
}
.btn-save-active { background: var(--cs-purple); color: var(--cs-white); }
.btn-save-active:hover { background: var(--cs-purple-hover); }
</style>
