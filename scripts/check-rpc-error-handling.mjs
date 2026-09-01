#!/usr/bin/env node
// scripts/check-rpc-error-handling.mjs
//
// 정적분석: supabase.rpc(...) 호출부가 error를 확인하지 않는 패턴을 탐지한다.
//
// 배경(2026-09-01): production DB에서 promote_draft_reservation RPC가 통째로 누락돼 있었는데,
// 이 결함이 12일간 발견 안 된 이유 중 하나가 cart/+page.svelte의 `const { data } = await
// supabase.rpc(...)` 패턴 — error를 구조분해하지 않아 RPC 자체 실패가 "재고가 없습니다" 같은
// 엉뚱한 fallback 문구로 둔갑해 실제 원인을 가렸다. 같은 파일 안에서도 동일 클래스 결함이
// 반복(5곳)됐던 것은, 이 패턴을 사람이 코드리뷰 때마다 매번 눈으로 찾아야 했기 때문이다.
// 이 스크립트는 그 수작업을 대체해 CI/QA 단계에서 자동으로 잡아낸다.
//
// 탐지 규칙(휴리스틱, AST 완전정밀 아님 — 정밀도보다 재현성·저비용 우선):
//   ① `.rpc(` 호출 직전의 변수 선언이 `const { data } = ...` / `const { data: xxx } = ...`처럼
//      "data"류 필드만 구조분해하고 "error"가 없으면 → VIOLATION
//   ② `.rpc(` 호출 결과를 아예 변수에 할당하지 않고 fire-and-forget으로 await만 하면(다음
//      비-공백 줄이 새 statement) → WARNING(치명적이지 않을 수 있으나 검토 필요)
//   ③ 구조분해에 "error"가 포함돼 있으면 → 통과(그 이후 실제로 error를 사용하는지까지는
//      검사하지 않음 — 그건 코드리뷰 영역)
//
// 사용법: node scripts/check-rpc-error-handling.mjs [--fail-on-violation]
//   --fail-on-violation: VIOLATION이 1건이라도 있으면 exit code 1 (CI 게이트용)
//   기본(옵션 없음): 리포트만 출력, exit code 0 (기존 결함 자산을 깨지 않기 위한 기본값 —
//   신규 위반만 막고 싶다면 별도로 baseline 카운트를 CI에서 비교할 것)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const SRC = join(ROOT, 'src');
const EXT = new Set(['.ts', '.svelte']);
const EXCLUDE_DIRS = new Set(['__tests__', 'node_modules', '.svelte-kit']);

/** @param {string} dir */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (EXT.has(entry.slice(entry.lastIndexOf('.')))) {
      yield full;
    }
  }
}

/**
 * .rpc( 호출부를 찾아 앞쪽 컨텍스트(같은 줄 또는 바로 위 1~2줄)에서
 * "const { ... } = await ...rpc(" 형태의 구조분해 대상에 error가 있는지 확인한다.
 */
function analyzeFile(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const violations = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('.rpc(')) continue;

    // 이 줄 자체 또는 위쪽으로 최대 3줄까지 살펴 구조분해 선언부를 찾는다
    // (멀티라인 타입 캐스팅 `as unknown as XxxFn` 패턴 대응)
    let declLine = null;
    for (let back = 0; back <= 3 && i - back >= 0; back++) {
      const candidate = lines[i - back];
      if (/\bconst\s*\{[^}]*\}\s*=\s*await/.test(candidate) || /\bconst\s*\{[^}]*\}\s*=\s*\(/.test(candidate)) {
        declLine = candidate;
        break;
      }
    }

    const relPath = relative(ROOT, filePath);
    const lineNo = i + 1;
    const snippet = line.trim().slice(0, 100);

    if (declLine) {
      const destructured = declLine.match(/\{([^}]*)\}/)?.[1] ?? '';
      const hasError = /\berror\b/.test(destructured);
      if (!hasError) {
        violations.push({ file: relPath, line: lineNo, snippet, reason: 'error 미구조분해(data만 확인)' });
      }
    } else {
      // 할당 자체가 없는 fire-and-forget 패턴(예: `await (supabase.rpc as ...)(...)`만 단독 statement)
      const isBareAwait = /^\s*(await\s+)?\(?supabase\.rpc\b|^\s*await\s+\(supabase\.rpc/.test(line)
        || (/await\s+\(supabase\.rpc/.test(line) && !/=\s*await/.test(line));
      if (isBareAwait) {
        warnings.push({ file: relPath, line: lineNo, snippet, reason: '반환값 미할당(fire-and-forget)' });
      }
    }
  }

  return { violations, warnings };
}

function main() {
  const failOnViolation = process.argv.includes('--fail-on-violation');
  const allViolations = [];
  const allWarnings = [];

  for (const file of walk(SRC)) {
    const { violations, warnings } = analyzeFile(file);
    allViolations.push(...violations);
    allWarnings.push(...warnings);
  }

  console.log(`\n=== RPC error-handling 정적분석 ===`);
  console.log(`대상: src/**/*.{ts,svelte} (테스트 파일 제외)\n`);

  if (allViolations.length > 0) {
    console.log(`❌ VIOLATION — error 미확인 (${allViolations.length}건):`);
    for (const v of allViolations) {
      console.log(`  ${v.file}:${v.line}  [${v.reason}]`);
      console.log(`    ${v.snippet}`);
    }
    console.log('');
  }

  if (allWarnings.length > 0) {
    console.log(`⚠️  WARNING — 반환값 미할당 (${allWarnings.length}건, 검토 필요 — 의도된 fire-and-forget일 수 있음):`);
    for (const w of allWarnings) {
      console.log(`  ${w.file}:${w.line}`);
      console.log(`    ${w.snippet}`);
    }
    console.log('');
  }

  if (allViolations.length === 0 && allWarnings.length === 0) {
    console.log('✅ 위반 없음.');
  }

  console.log(`요약: VIOLATION ${allViolations.length}건 / WARNING ${allWarnings.length}건\n`);

  if (failOnViolation && allViolations.length > 0) {
    process.exitCode = 1;
  }
}

main();
