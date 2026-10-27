#!/usr/bin/env node
// scripts/harness-scan-eval.mjs
//
// harness-scan.mjs 자가 점검(이식용·vitest 불필요). 어느 프로젝트에 복사해도 `node scripts/harness-scan-eval.mjs` 로 실행한다.
//   · scripts/eval-fixtures/cases.json 의 심은 취약 파일을 임시 폴더에 풀어 `--all --root <tmp> --json` 으로 스캔
//   · 재현율: expect 의 (파일, 규칙)을 전부 검출하는가 / 오탐: clean 대조군 발견 0건인가 / 마스킹: 출력에 가짜 키 원문·조각이 없는가
//   · 실패 시 exit 1 (CI·훅에서 스캐너가 조용히 무뎌지는 것을 막는다)
// crazyshot 의 vitest 평가(src/__tests__/security/harnessScanEval.test.ts)와 같은 로직이며, 게이트 동작(diff·이월부채·--files·exit 2)은
// harnessScanGate.test.ts 가 별도로 검증한다(git 임시 저장소 필요 — 이식 프로젝트에서 필요하면 그 테스트를 복사).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scan = join(here, 'harness-scan.mjs');
const casesPath = join(here, 'eval-fixtures', 'cases.json');
if (!existsSync(scan) || !existsSync(casesPath)) {
  console.error('harness-scan-eval: scripts/harness-scan.mjs 또는 scripts/eval-fixtures/cases.json 이 없습니다');
  process.exit(2);
}

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'harness-selftest-'));
let failed = 0;
const fail = (msg) => { failed++; console.error('  ✗ ' + msg); };
try {
  for (const [rel, content] of Object.entries(cases.files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const run = (extra) => execFileSync('node', [scan, '--all', '--root', dir, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const jsonOut = run(['--json']);
  const textOut = run([]);
  const report = JSON.parse(jsonOut);

  const missed = cases.expect.filter((e) => !report.findings.some((f) => f.file === e.file && f.rule === e.rule));
  const fp = report.findings.filter((f) => cases.clean.includes(f.file));
  const leaked = (cases._masking_strings || []).filter((x) => jsonOut.includes(x) || textOut.includes(x));
  const partial = /sk_live_[A-Za-z0-9]{4,}/.test(jsonOut) || /AKIA[A-Z0-9]{8,}/.test(textOut);

  console.log(`harness-scan 자가 점검 | 재현율 ${cases.expect.length - missed.length}/${cases.expect.length} | 대조군 오탐 ${fp.length}건 | 비밀 원문 노출 ${leaked.length + (partial ? 1 : 0)}건`);
  for (const m of missed) fail(`미탐: ${m.file} → ${m.rule}`);
  for (const f of fp) fail(`오탐(깨끗한 대조군): ${f.file} → ${f.rule}`);
  for (const l of leaked) fail(`비밀 원문이 출력에 남음: ${l.slice(0, 6)}…`);
  if (partial) fail('비밀 조각(접두+연속 문자)이 출력에 남음');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
