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
  let fmtCat     = $state(data.codeFormat.cat_code     ?? '')
  let fmtDate    = $state(data.codeFormat.date_format  ?? 'YYMM')
  let fmtSeq     = $state(String(data.codeFormat.seq_digits ?? 3))
  let fmtReset   = $state(data.codeFormat.reset_monthly !== false)
  let fmtSuffix  = $state(data.codeFormat.suffix       ?? '')

  // 활성 분류코드(대분류, depth=1)가 하나도 없으면 "카테고리별 미리보기" 섹션 자체가
  // 빈 헤더만 남는 불필요한 레이아웃이 되므로 조건부로 숨긴다
  const activeMajorCodes = $derived(data.codes.filter(c => c.is_active && c.depth === 1))

  // 현재 탭의 설정값으로 buildPreview 래퍼
  // 분류코드가 비어있으면 실제 채번 시에도 그 세그먼트가 빠지므로, 미리보기도 'CAMML' 같은
  // 가짜 값을 채워넣지 않고 빈 값 그대로 반영해 실제 생성될 코드와 정확히 일치시킨다.
  function preview(catCode?: string): string {
    const fmt: CodeFormat = {
      prefix: fmtPrefix || 'CS',
      date_format: fmtDate as 'YYMM' | 'YYYYMM',
      seq_digits: Number(fmtSeq) || 3,
      reset_monthly: fmtReset,
      suffix: fmtSuffix,
    }
    return buildPreview(catCode ?? fmtCat.trim().toUpperCase(), fmt)
  }

  $effect(() => {
    if (!form) return
    const f = form as { action?: string; success?: boolean; error?: string }
    if (f.error) { csToast.error(f.error); return }
    if (!f.success || f.action !== 'saveFormat') return
    csToast.success('예약코드 설정이 저장되었습니다.')
    dirty = false
  })
</script>

<!-- FormatTab 자체 여백 — .panel(코드목록 탭과 공유하는 상위 컨테이너)은 그대로 두고,
     이 탭 내부에서만 세로 배치 + 안쪽 여백을 적용 -->
<div class="fmt-body">

<!-- 토큰 시각화 -->
<div class="fmt-section">
  <div class="fmt-section-title">코드 구조 시각화</div>
  <div class="token-row">
    <div class="token tk-prefix"><span class="tk-val">{fmtPrefix||'CS'}</span><span class="tk-role">접두어</span></div>
    <div class="token tk-cat" class:tk-unset={!fmtCat.trim()}>
      <span class="tk-val">{fmtCat.trim().toUpperCase() || '(미설정)'}</span>
      <span class="tk-role">분류코드</span>
    </div>
    <div class="token tk-date"><span class="tk-val">{datePart(fmtDate)}</span><span class="tk-role">날짜형식</span></div>
    <div class="token tk-seq"><span class="tk-val">{'1'.padStart(Number(fmtSeq)||3,'0')}</span><span class="tk-role">{fmtSeq}자리</span></div>
    {#if fmtSuffix.trim()}
    <div class="token tk-sfx"><span class="tk-val">{fmtSuffix.trim().toUpperCase()}</span><span class="tk-role">접미어</span></div>
    {/if}
  </div>
  <div class="full-preview-box">
    <span class="fp-label">실제 생성 예시</span>
    <span class="fp-code">{preview()}</span>
  </div>
</div>

<form method="POST" action="?/saveFormat" use:enhance oninput={() => dirty = true}>

  <!-- 설정 목록 — 다른 CMS 설정 화면(예: /cms/set/rental)과 동일하게 카드형 반응형 그리드
       대신 라벨(왼쪽 고정폭) + 입력(오른쪽) 세로 목록 구조로 통일 -->
  <div class="fmt-list">

    <div class="fmt-row">
      <div class="fr-label"><span class="fc-dot" style="background:var(--cs-dark)"></span>접두어</div>
      <div class="fr-content">
        <input class="fc-in mono-in" name="prefix" type="text" bind:value={fmtPrefix} maxlength="6" placeholder="CS" autocomplete="off" />
        <p class="fc-hint">영문 대문자·숫자, 최대 6자. 브랜드 식별자.</p>
      </div>
    </div>

    <div class="fmt-row">
      <div class="fr-label"><span class="fc-dot" style="background:var(--cs-purple)"></span>분류코드</div>
      <div class="fr-content">
        <input class="fc-in mono-in" name="cat_code" type="text" bind:value={fmtCat} maxlength="10" placeholder="예: CAMML (미설정 시 생략됨)" autocomplete="off" />
        <p class="fc-hint">예약코드에 포함할 분류 식별자. 영문 대문자·숫자 최대 10자.</p>
      </div>
    </div>

    <div class="fmt-row">
      <div class="fr-label"><span class="fc-dot" style="background:var(--cs-info)"></span>날짜 형식</div>
      <div class="fr-content">
        <div class="radio-stack radio-stack--inline">
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
    </div>

    <!-- 순번 설정 — 자동순번 규격·순번 초기화는 둘 다 "순번" 하나를 다루는 연동 옵션이라
         한 카드 안에 결합. 다른 독립 필드(접두어·분류코드·날짜형식·접미어)와 동일하게
         .fmt-list의 일반 항목으로 배치(별도 그룹 래퍼로 감싸지 않음) -->
    <div class="fmt-row">
      <div class="fr-label"><span class="fc-dot" style="background:var(--cs-success-light)"></span>순번 설정</div>
      <div class="fr-content fmt-seq-content">
        <div>
          <div class="fmt-seq-label">자동순번(채번) 규격</div>
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
        <div>
          <div class="fmt-seq-label">순번 초기화</div>
          <div class="radio-stack radio-stack--inline">
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
      </div>
    </div>

    <div class="fmt-row">
      <div class="fr-label"><span class="fc-dot" style="background:var(--cs-warning)"></span>접미어 (선택)</div>
      <div class="fr-content">
        <input class="fc-in mono-in" name="suffix" type="text" bind:value={fmtSuffix} maxlength="4" placeholder="비워두면 미사용" autocomplete="off" />
        <p class="fc-hint">코드 끝에 추가 식별자. 예: KR, B2B, SER (최대 4자).</p>
      </div>
    </div>

  </div>

  <!-- 카테고리별 미리보기 — 표시할 활성 분류코드가 있을 때만 렌더링 (없으면 빈 헤더만
       남는 불필요한 레이아웃이라 섹션 자체를 생략) -->
  {#if activeMajorCodes.length > 0}
  <div class="fmt-section">
    <div class="fmt-section-title">활성 분류코드별 생성 코드 미리보기</div>
    <div class="preview-grid">
      {#each activeMajorCodes.slice(0, 18) as cc}
        {@const color = Object.values(ROOT_COLORS)[data.codes.findIndex(c => c.code === cc.path_codes[0]) % 12] ?? '#888'}
        <div class="pg-item">
          <span class="pg-badge" style="background:{color}">{cc.code}</span>
          <code class="pg-code">{preview(cc.code)}</code>
        </div>
      {/each}
      {#if activeMajorCodes.length > 18}
        <div class="pg-more">+{activeMajorCodes.length - 18}개 더…</div>
      {/if}
    </div>
  </div>
  {/if}

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

</div>

<style>
/* 예약코드 설정 탭 — 가로폭은 /cms/promotion/ad와 동일하게 전체 폭(제한 없음),
   세로 배치·안쪽 여백만 /cms/customers(.page-wrap)와 동일한 값으로 이 탭 내부에 적용
   (.panel은 코드목록 탭과 공유하는 상위 컨테이너라 건드리지 않음 — 여기서만 적용) */
.fmt-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px 32px;
}

/* 좌우 여백은 위 .fmt-body가 이미 담당하므로, 내부 섹션들의 좌우 padding은 제거해
   이중 여백 방지(위아래 padding만 유지) */
.fmt-section { padding: 20px 0; border-bottom: 1px solid rgba(59,47,138,0.06); }
/* 코드 구조 시각화 섹션(.fmt-body 바로 아래 첫 자식)은 .fmt-body 자체 padding-top(20px)과
   겹치므로 자기 몫은 생략 — 상단에 40px씩 이중 여백이 쌓이는 것 방지.
   하단 구분선도 생략 — 바로 아래 카드 목록과 gap(12px)으로 이미 분리되어 있어 불필요. */
.fmt-body > .fmt-section:first-child { padding-top: 0; border-bottom: none; }
.fmt-section-title { font: var(--text-pc-descript-10); font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: var(--cs-text-mid); margin-bottom: 12px; text-align: center; }

.token-row { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
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

/* 미설정 상태 — 실제 값이 아님을 색상으로 명확히 구분(채워진 토큰과 혼동 방지) */
.tk-unset {
  background: var(--cs-white);
  border: 1.5px dashed var(--cs-text-light);
}
.tk-unset .tk-val  { color: var(--cs-text-light); font-weight: 400; letter-spacing: normal; }
.tk-unset .tk-role { color: var(--cs-text-light); }

.full-preview-box {
  display: flex; align-items: center; gap: 14px; padding: 10px 16px;
  background: var(--cs-lilac); border-radius: var(--radius-lg); width: fit-content;
  margin: 0 auto;
}
.fp-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.fp-code  { font: var(--text-pc-title-18); font-weight: 700; color: var(--cs-text); letter-spacing: 0.07em; }

/* 설정 목록 — /cms/set/rental의 라벨+콘텐츠 행 패턴과 동일하게 통일
   (반응형 카드 그리드 대신 고정 라벨폭 + 세로 목록으로 다른 CMS 설정 화면과 정렬) */
/* 카드형 목록 — cms 표준 디자인 시스템 지침 정책 라운드값 '중(20px)' 적용 = var(--radius-lg)
   (uiux-index.md "CMS 카드 라운드값(대/중/소) 정책" 참고 — --cms-radius-md(15px)와는 다른 값). */
/* 간격도 2026-08-15 재확정된 cms-uiux.md §5 소/중/대 스케일 적용: gap 20px(대) */
.fmt-list { display: flex; flex-direction: column; gap: 20px; }
.fmt-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 16px;
  align-items: start;
  padding: 18px 22px;
  background: var(--cs-white);
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-lg);
  box-shadow: 0px 1px 4px rgba(0,0,0,0.04);
}
.fr-label { display: flex; align-items: center; gap: 7px; font: var(--text-pc-body-14); color: var(--cs-text); padding-top: 9px; white-space: nowrap; }
.fr-content { display: flex; flex-direction: column; gap: 8px; }
.fc-dot   { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.fc-in    {
  height: 40px; padding: 0 12px; border: 1.5px solid rgba(59,47,138,0.10);
  border-radius: var(--radius-sm); background: var(--cs-surface-gray);
  font: var(--text-pc-body-14); color: var(--cs-text); width: 160px;
}

/* 순번 설정 카드 내부 — 자동순번 규격 + 순번 초기화, 두 연동 옵션을 세로로 묶어 표시 */
.fmt-seq-content { gap: 18px; }
.fmt-seq-label {
  font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-success-light);
  margin-bottom: 8px;
}
.fc-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
.mono-in { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.fc-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; line-height: 1.5; }

.radio-stack { display: flex; flex-direction: column; gap: 6px; }
.radio-stack--inline { flex-direction: row; flex-wrap: wrap; }
.radio-stack--inline .rl { flex: 1; min-width: 220px; }
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
  padding: 14px 0 0;
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
