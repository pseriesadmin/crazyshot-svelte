#!/usr/bin/env node
// scripts/harness-scan.mjs  (v1.0 | Harness Flow v4.0)
//
// sp3-qa-agent(QA) · sp5-security-agent(보안)가 "증거 기반"으로 쓰는 결정적(deterministic) 스캐너.
// 원칙: ① LLM 판단 이전에 기계가 잡을 수 있는 건 기계가 잡는다 ② 기본은 "이번 변경분(diff)에서 새로
// 생긴 줄"만 판정한다(기존 부채는 블로킹 대상이 아님) ③ 모든 발견은 file:line + 규칙ID + 근거를 가진다.
//
// 사용법:
//   node scripts/harness-scan.mjs                       # 작업트리 변경분(HEAD 대비 + untracked), qa+security
//   node scripts/harness-scan.mjs --profile qa|security|all
//   node scripts/harness-scan.mjs --base origin/main    # 지정 기준 대비 변경분
//   node scripts/harness-scan.mjs --all                 # 전체 소스(기존 부채 포함, 감사용)
//   node scripts/harness-scan.mjs --json                # 기계가독 출력
//   node scripts/harness-scan.mjs --fail-on high        # critical|high|medium 이상 발견 시 exit 1
//   node scripts/harness-scan.mjs --migrations 20       # --all 일 때 최신 N개 마이그레이션만 검사(기본 20)
//   node scripts/harness-scan.mjs --files a.ts,b.svelte # 이번 세션 기록에 적힌 파일만 판정(다른 세션 변경 제외, 쉼표 구분)
//   --files 의 항목이 하나도 스캔 대상이 아니면 exit 2(통과 아님, --allow-empty 로 허용). git 수집 실패·잘못된 --base·--fail-on 오값도 exit 2.
//   node scripts/harness-scan.mjs --all --root <dir> --json  # 지정 폴더를 저장소 루트처럼 스캔(평가 세트용)
//   node scripts/harness-scan.mjs --fingerprint --files a.ts,b.svelte
//                                                       # 파일 내용 지문(fp:12자리) 출력 후 종료 — GSD_LOG '🛡️SP5' 재사용 판단용
// 파일 단위 규칙(CRON_SECRET·API 인증 등)은 변경 파일에서 'HEAD에는 없던 위반'만 신규로 센다. HEAD에도 있던 위반은
// '이월 부채(carriedDebt)'로 따로 표시하고 건수·--fail-on 에서 제외한다(파일을 건드렸다는 이유로 옛 문제가 되살아나는 것 방지).
//
// 한계: 이월 부채 판정은 '같은 규칙 위반이 HEAD에도 있었는가'만 본다(있다/없다). 이미 위반이 있는 파일에 같은 종류 위반을 하나 더 추가하면 이월로 분류돼 가려질 수 있다 —
//       변경 줄 자체는 줄 단위 규칙이 계속 잡지만, 파일 단위 규칙(인증 누락 등)은 sp3 Phase 3의 diff 정독으로 보완한다.
// 한계(정직하게): 정규식 휴리스틱이다 — AST/데이터흐름 분석이 아니다. "발견 없음 = 안전"이 아니라
// "기계가 잡는 범위에선 깨끗함"이다. 나머지는 에이전트의 수동 추적(데이터 흐름·권한 경로)이 담당한다.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
// --root <dir>: 스캔 루트 지정(스캐너 자기 검증용 평가 세트 — src/__tests__/security/harnessScanEval.test.ts). 기본은 저장소 루트
const ROOT_OPT = opt('--root', null);
const ROOT = typeof ROOT_OPT === 'string' ? ROOT_OPT : join(new URL('.', import.meta.url).pathname, '..');
const PROFILE = opt('--profile', 'all');
const BASE = opt('--base', 'HEAD');
const ALL = args.includes('--all');
const AS_JSON = args.includes('--json');
const FAIL_ON = opt('--fail-on', null);
if (args.includes('--fail-on') && !(typeof FAIL_ON === 'string' && ['critical', 'high', 'medium', 'low'].includes(FAIL_ON))) {
  console.error('harness-scan: --fail-on 값은 critical|high|medium|low 중 하나여야 합니다(오타·값 누락 시 게이트가 꺼지는 것을 막기 위해 중단)'); process.exit(2);
}
const MIG_N = Number(opt('--migrations', 20)) || 20;
const FILES_OPT = opt('--files', null);
// ROOT 를 resolve/realpath 로 정규화해 끝 슬래시·심볼릭 경로(/var → /private/var 등)에서도 절대경로 --files 를 상대경로로 바꾼다
const ROOT_FORMS = [...new Set([resolve(ROOT), (() => { try { return realpathSync(ROOT); } catch { return resolve(ROOT); } })()])];
const normPath = (x) => {
  let r = x.trim();
  if (r.startsWith('./')) r = r.slice(2);
  for (const root of ROOT_FORMS) if (r.startsWith(root + '/')) { r = r.slice(root.length + 1); break; }
  return r;
};
const FILE_FILTER = typeof FILES_OPT === 'string' ? new Set(FILES_OPT.split(',').map(normPath).filter(Boolean)) : null;
if (FILES_OPT !== null && (!FILE_FILTER || !FILE_FILTER.size)) { console.error('harness-scan: --files 에는 쉼표로 구분한 파일 목록이 필요합니다'); process.exit(2); }
const ALLOW_EMPTY = args.includes('--allow-empty');
const unmatched = [];
const FINGERPRINT = args.includes('--fingerprint');
const SEV_ORDER = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// 비밀 리터럴은 어떤 출력(텍스트·JSON)에도 값을 싣지 않는다 — 규칙ID·위치·앞 4자만 표기
const SECRET_RE = /(sk_live_[A-Za-z0-9]{8,}|sk_test_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/g;
// 순서 중요: 반드시 '마스킹 → 자르기'. 자른 뒤 마스킹하면 토큰이 중간에서 끊겨 패턴에 안 걸리고 조각이 출력에 남는다(평가 세트가 잡은 결함).
// 두 번째 replace 는 끊긴/부분 JWT(eyJ…) 조각까지 가린다.
const maskSecrets = (t) => t.replace(SECRET_RE, (m) => `${m.slice(0, 4)}…<redacted ${m.length}자>`).replace(/eyJ[A-Za-z0-9_.-]{8,}/g, 'eyJ…<redacted>')
  .replace(/(sk_live_|sk_test_|AKIA|ghp_|github_pat_|xox[baprs]-|sk-ant-|AIza)[A-Za-z0-9_-]{4,}/g, (m, pre) => `${pre}…<redacted>`);
const snip = (ln, n) => maskSecrets(ln.trim()).slice(0, n); // 모든 snippet 은 이 함수를 거친다(규칙별 개별 마스킹 금지)

// 한글·공백 경로가 따옴표/8진수로 나오지 않도록 core.quotepath=false
const GIT_ARGS = ['-c', 'core.quotepath=false'];
const git = (a) => { // 관대한 버전: 실패 시 빈 문자열 (git show BASE:path 처럼 '없음'이 정상일 수 있는 곳에서만 사용)
  try { return execFileSync('git', [...GIT_ARGS, ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
};
const gitStrict = (a) => { // 엄격한 버전: diff 수집처럼 실패하면 게이트가 통과로 보이면 안 되는 곳 — 실패 시 exit 2
  try { return execFileSync('git', [...GIT_ARGS, ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { console.error(`harness-scan: git ${a[0]} 실패 — 검사를 중단합니다(통과 아님). ${String(e.stderr || e.message).split('\n')[0]}`); process.exit(2); }
};

// ───────────────────────── 대상 파일 + "추가된 줄" 수집 ─────────────────────────
const SRC_EXT = new Set(['.ts', '.js', '.svelte', '.mjs', '.cjs']);
const AGENT_EXT = new Set(['.md', '.mdc', '.json', '.yaml', '.yml']);
const isAgentCfg = (p) => /^\.(claude|cursor)\//.test(p) && AGENT_EXT.has(extname(p)) && !/\/(archive|telemetry|worktrees)\//.test(p);
const isAgentDoc = (p) => /^\.claude\/(agents|harness\/security)\/|^\.cursor\/rules\/harness-/.test(p); // 에이전트 문서는 공격 패턴을 '설명'하므로 원격실행·blob 규칙 제외
const isTest = (p) => /(^|\/)__tests__\//.test(p) || /\.(test|spec)\.[tj]s$/.test(p);
function* walk(dir) {
  if (!existsSync(dir)) return; // 루트에 src/·.claude/ 등이 없어도 예외 없이 건너뜀
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.svelte-kit', '.git', '.vercel'].includes(e)) continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** @type {Map<string, Set<number>|null>} null = 전체 줄이 대상 */
const targets = new Map();
if (ALL) {
  for (const f of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f);
    if (SRC_EXT.has(extname(rel)) && !isTest(rel)) targets.set(rel, null);
  }
  const migDir = join(ROOT, 'supabase/migrations');
  if (existsSync(migDir)) {
    readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort().slice(-MIG_N)
      .forEach((n) => targets.set(`supabase/migrations/${n}`, null));
  }
  for (const f of ['package.json', 'vercel.json', 'svelte.config.js']) if (existsSync(join(ROOT, f))) targets.set(f, null);
  for (const d of ['.claude', '.cursor']) {
    if (!existsSync(join(ROOT, d))) continue;
    for (const f of walk(join(ROOT, d))) {
      const rel = relative(ROOT, f);
      if (AGENT_EXT.has(extname(rel)) && !/\/(archive|telemetry|worktrees)\//.test(rel)) targets.set(rel, null);
    }
  }
} else {
  if (typeof BASE !== 'string') { console.error('harness-scan: --base 에는 값이 필요합니다'); process.exit(2); }
  gitStrict(['rev-parse', '--verify', '--quiet', `${BASE}^{commit}`]);
  const diff = gitStrict(['diff', '-U0', '--no-color', BASE]);
  let cur = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) { cur = line.slice(6); if (!targets.has(cur)) targets.set(cur, new Set()); continue; }
    if (line.startsWith('+++ ')) { cur = null; continue; }
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (m && cur) {
      const start = Number(m[1]); const n = m[2] === undefined ? 1 : Number(m[2]);
      const set = targets.get(cur);
      for (let i = 0; i < n; i++) set.add(start + i);
    }
  }
  for (const u of gitStrict(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) targets.set(u, null);
  for (const k of [...targets.keys()]) {
    const ok = (SRC_EXT.has(extname(k)) && k.startsWith('src/') && !isTest(k)) || k.startsWith('supabase/migrations/') || ['package.json', 'vercel.json', 'svelte.config.js'].includes(k) || isAgentCfg(k);
    if (!ok || !existsSync(join(ROOT, k))) targets.delete(k);
  }
}

// --files: 호출자가 넘긴(= 이번 세션 기록에 적힌) 파일만 대상으로 제한
if (FILE_FILTER && !FINGERPRINT) {
  for (const k of [...targets.keys()]) if (!FILE_FILTER.has(k)) targets.delete(k);
  // 목록에 있으나 스캔 대상이 아닌 파일(없는 파일·오타·./·이미 커밋돼 diff에 없음·스캔 확장자 아님)을 숨기지 않는다 — 게이트 fail-open 방지
  for (const f of FILE_FILTER) if (!targets.has(f)) unmatched.push(f);
  if (!targets.size && !ALLOW_EMPTY) {
    console.error(`harness-scan: --files 로 지정한 ${FILE_FILTER.size}개 중 스캔 대상이 0개입니다(통과 아님). 없는 파일/경로 표기/이미 커밋되어 diff에 없음/스캔 대상 확장자 아님: ${unmatched.slice(0, 8).join(', ')}\n  의도한 것이면 --allow-empty 를 붙이세요.`);
    process.exit(2);
  }
  if (unmatched.length) console.error(`harness-scan: 경고 — 스캔 대상이 아닌 지정 파일 ${unmatched.length}개: ${unmatched.slice(0, 8).join(', ')}`);
}
// --fingerprint: 파일 내용 기반 짧은 지문 — 같은 파일 목록·같은 내용이면 항상 같은 값(sp5 결과 재사용 판단용)
if (FINGERPRINT) {
  if (!FILE_FILTER || !FILE_FILTER.size) { console.error('--fingerprint 는 --files 와 함께 사용'); process.exit(2); }
  const h = createHash('sha256');
  for (const f of [...FILE_FILTER].sort()) {
    h.update(f + '\0');
    try { h.update(readFileSync(join(ROOT, f))); } catch { h.update('<missing>'); }
    h.update('\0');
  }
  console.log(`fp:${h.digest('hex').slice(0, 12)} files=${FILE_FILTER.size}`);
  process.exit(0);
}

// ───────────────────────── 규칙 정의 ─────────────────────────
/** 줄 단위 규칙: re가 줄에 매칭 + (files 경로 조건) + (unlessFile: 파일 전체에 이 패턴이 있으면 면제) */
const LINE_RULES = [
  // ── QA ──
  { id: 'QA-CONSOLE', p: 'qa', sev: 'high', re: /\bconsole\.(log|debug)\(/, ext: ['.ts', '.svelte', '.js'], skipLine: /harness-allow/, msg: 'console.log/debug 잔류 (core-rules: GATE C 전 전수 제거)' },
  { id: 'QA-ANY', p: 'qa', sev: 'high', re: /(:\s*any\b|<any>|\bas any\b)/, ext: ['.ts', '.svelte'], skipLine: /harness-allow|^\s*(\/\/|\*)/, msg: 'any 타입 사용 (H-06 금지)' },
  { id: 'QA-CAST', p: 'qa', sev: 'medium', re: /\bas unknown as\b/, ext: ['.ts', '.svelte'], skipLine: /harness-allow/, msg: 'as unknown as T 캐스팅 (타입 가드 사용 권장)' },
  { id: 'QA-SVELTE4-EVENT', p: 'qa', sev: 'high', re: /\son:(click|input|submit|change|keydown|keyup|focus|blur|mouse\w+|touch\w+)\b/, ext: ['.svelte'], msg: 'Svelte 4 이벤트 문법 (on:event → onevent)' },
  { id: 'QA-SVELTE4-PROPS', p: 'qa', sev: 'high', re: /^\s*export let\s/, ext: ['.svelte'], msg: 'Svelte 4 props (export let → $props())' },
  { id: 'QA-STORE', p: 'qa', sev: 'medium', re: /from\s+['"]svelte\/store['"]/, ext: ['.svelte', '.ts'], files: /^src\/(lib\/components|routes)\//, msg: 'writable store 사용 (→ $state)' },
  { id: 'QA-EMPTY-CATCH', p: 'qa', sev: 'medium', re: /catch\s*(\([^)]*\))?\s*\{\s*\}/, ext: ['.ts', '.svelte'], msg: '빈 catch 블록 (에러 삼킴 금지)' },
  { id: 'QA-TODO', p: 'qa', sev: 'low', re: /\b(TODO|FIXME|XXX)\b/, ext: ['.ts', '.svelte'], msg: 'TODO/FIXME 잔류 (TASK.md BACKLOG 등록 후 코드에서 제거)' },
  { id: 'QA-QRCASE', p: 'qa', sev: 'high', re: /\.eq\(\s*['"]product_code['"]\s*,[^)]*toUpperCase/, ext: ['.ts'], msg: 'product_code .eq(toUpperCase()) — .ilike()+escapeLikePattern 사용 (QR-CASE-1)' },
  { id: 'QA-LOCALS-CMSROLE', p: 'qa', sev: 'high', re: /\blocals\.cmsRole\b/, ext: ['.ts'], files: /\+page\.server\.ts$/, unlessLine: /getCmsRoleForAction|parent\(\)/, msg: 'form action에서 locals.cmsRole 직접 사용 금지 → getCmsRoleForAction(locals)' },
  { id: 'QA-DIRECT-DML', p: 'qa', sev: 'medium', re: /\.from\(\s*['"][a-z_]+['"]\s*\)\s*\.(insert|update|delete|upsert)\(/, ext: ['.ts', '.svelte'], files: /^src\/(routes|lib)\//, msg: '직접 DML (H-01: RPC 경유 원칙) — 예외 사유 확인 필요' },
  { id: 'QA-LIKE-UNESC', p: 'qa', sev: 'medium', re: /\.ilike\([^)]*\$\{/, ext: ['.ts'], unlessFile: /escapeLikePattern/, msg: 'ilike에 보간 사용 + escapeLikePattern 미사용 (% _ 와일드카드 주입)' },
  { id: 'QA-HARDCODED-COLOR', p: 'qa', sev: 'low', re: /(color|background|border-color|fill|stroke)\s*:\s*#[0-9a-fA-F]{3,8}\b/, ext: ['.svelte'], skipLine: /var\(--/, msg: '하드코딩 색상 (CSS 변수 사용) — 기존 화면 일괄 교체 금지, 신규 줄만 대상' },
  { id: 'QA-STATE-PROP', p: 'qa', sev: 'high', ext: ['.svelte'], special: 'statePropInit', msg: '$state(prop) 초기화 — 마운트 1회만 평가됨 ({#key} 또는 $effect 동기화)' },

  // ── SECURITY ──
  { id: 'SEC-SECRET-LITERAL', p: 'security', sev: 'critical', re: /(sk_live_[A-Za-z0-9]{8,}|sk_test_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/, ext: ['.ts', '.svelte', '.js', '.mjs', '.cjs', '.sql'], skipLine: /harness-allow|^\s*(\*|\/\/|#|--)/, msg: '비밀키/토큰 리터럴 하드코딩 (주석 줄 제외)' },
  { id: 'SEC-PUBLIC-SECRET', p: 'security', sev: 'critical', re: /(import[^;]*\{[^}]*\b(SECRET\w*|\w*SERVICE_ROLE\w*|\w*PRIVATE_KEY\w*)\b[^}]*\}\s*from\s*['"]\$env\/(static|dynamic)\/public|\bPUBLIC_\w*(SECRET|SERVICE_ROLE|PRIVATE_KEY)\w*)/, ext: ['.ts', '.svelte'], skipLine: /harness-allow/, msg: '서버 비밀이 PUBLIC 경로로 노출 (한 줄 import만 탐지 — 여러 줄 import는 수동 확인)' },
  { id: 'SEC-SERVICE-ROLE-CLIENT', p: 'security', sev: 'critical', re: /(SERVICE_ROLE|createAdminClient|\$lib\/server\/|\$env\/(static|dynamic)\/private)/, ext: ['.svelte'], skipLine: /import\s+type\b/, msg: '브라우저 번들 대상(.svelte)에서 서버 전용 모듈/비밀 참조 (import type은 제외)' },
  { id: 'SEC-TIMING-COMPARE', p: 'security', sev: 'high', re: /\b(computed|expected|digest|hmac|signature|sig|mac)\w*\s*(===|!==|==|!=)\s*\w|\w+\s*(===|!==)\s*(computed|expected|digest|hmac|signature|sig)\b/i, ext: ['.ts'], files: /^src\/(routes|lib\/server)\//, requireFile: /createHmac|createHash|crypto/, skipLine: /timingSafeEqual|\.length\s*(===|!==)|typeof|=== null|=== undefined|!== null|!== undefined/, msg: '서명/해시/토큰 비교에 === 사용 — crypto.timingSafeEqual 필요 (타이밍 공격)' },
  { id: 'SEC-WEAK-RANDOM', p: 'security', sev: 'high', re: /Math\.random\(\)/, ext: ['.ts', '.svelte'], files: /^src\/(routes\/api|lib\/server|routes\/.*\+(page|layout)\.server)/, near: /(token|otp|nonce|secret|password|passcode|verification|auth|session|key|code)/i, skipLine: /^\s*(\*|\/\/)/, msg: '보안 값(OTP/토큰/코드)에 Math.random — crypto.randomInt/randomBytes 사용' },
  { id: 'SEC-EVAL', p: 'security', sev: 'high', re: /((?<![\w.])eval\(|new Function\(|from\s+['"](node:)?child_process['"]|(?<![\w.])(execSync|spawnSync|spawn)\()/, ext: ['.ts', '.svelte', '.js'], files: /^src\//, skipLine: /harness-allow|^\s*(\*|\/\/)/, msg: '동적 코드 실행/프로세스 실행 sink' },
  { id: 'SEC-DOM-SINK', p: 'security', sev: 'medium', re: /(document\.write\(|\.innerHTML\s*=(?!=)|\.outerHTML\s*=(?!=))/, ext: ['.ts', '.svelte', '.js'], files: /^src\//, skipLine: /harness-allow|^\s*(\*|\/\/)|sanitize/i, msg: 'DOM 직삽입 sink — 입력 출처(사용자/DB/LLM)와 sanitize 증명 필요' },
  { id: 'SEC-HTML-SINK', p: 'security', sev: 'medium', re: /\{@html\s+[^}]+\}/, ext: ['.svelte'], skipLine: /sanitize|renderTiptap|escapeHtml|DOMPurify/i, msg: '{@html} sink — 입력 출처와 sanitize 경로를 증명해야 함 (USER 화면이면 high로 승격 검토)' },
  { id: 'SEC-POSTGREST-OR', p: 'security', sev: 'high', re: /\.(or|filter)\(\s*`[^`]*\$\{/, ext: ['.ts'], files: /^src\//, msg: 'PostgREST .or()/.filter()에 템플릿 보간 — 필터 문법 주입(Filter Injection) 가능, 값 이스케이프/화이트리스트 필수' },
  { id: 'SEC-RPC-RAW-SQL', p: 'security', sev: 'critical', re: /\.rpc\(\s*['"](exec_sql|execute_sql|run_sql|query|sql)['"]/, ext: ['.ts'], msg: '임의 SQL 실행 RPC 호출' },
  { id: 'SEC-COOKIE-FLAGS', p: 'security', sev: 'medium', re: /cookies\.set\(/, ext: ['.ts'], skipLine: /httpOnly|secure\s*:|sameSite/, near2: /(httpOnly|sameSite)/, msg: 'cookies.set 보안 속성(httpOnly/secure/sameSite) 확인 불가 — 다음 3줄 내 명시 필요' },
  { id: 'SEC-CORS-WILDCARD', p: 'security', sev: 'medium', re: /[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin['"]?\s*[:,]\s*['"]\*/, ext: ['.ts'], msg: 'CORS 와일드카드(*)' },
  { id: 'SEC-LOG-PII', p: 'security', sev: 'medium', re: /console\.(log|info|warn|error)\([^)]*(password|passwd|secret|authorization|bearer|access_token|refresh_token|service_role|otp|주민|card_number|cardNumber)/i, ext: ['.ts', '.svelte'], skipLine: /harness-allow/, msg: '로그에 민감정보 출력 가능성' },
  { id: 'SEC-ERR-LEAK', p: 'security', sev: 'low', re: /json\(\s*\{\s*(error|message|detail)\s*:\s*(e|err|error)\w*(\.message|\.stack)/, ext: ['.ts'], files: /^src\/routes\/api\//, msg: '내부 에러 메시지/스택을 클라이언트에 그대로 반환' },
  { id: 'SEC-LLM-PROMPT-INTERP', p: 'security', sev: 'medium', re: /\bsystem\s*:\s*`[^`]*\$\{/, ext: ['.ts'], msg: 'LLM system 프롬프트에 템플릿 보간 — 사용자/DB 콘텐츠가 섞이면 프롬프트 인젝션 경로 (구분자·역할 분리 확인)' },
  { id: 'SEC-LLM-OUTPUT-SINK', p: 'security', sev: 'high', re: /(completion|aiResult|aiResponse|llmOutput|modelOutput|assistantText)\w*[^\n]*(\{@html|innerHTML|\.rpc\(|\.from\(|eval\()/, ext: ['.ts', '.svelte'], msg: 'LLM 출력이 HTML/RPC/쿼리 sink로 직결 (출력 검증·스키마 파싱 필요)' },
  { id: 'SEC-FETCH-DYNAMIC', p: 'security', sev: 'medium', re: /\bfetch\(\s*(?!['"`]https?:\/\/)(?!`https?:\/\/)(?!['"`]\/)[A-Za-z_]/, ext: ['.ts'], files: /^src\/(routes|lib\/server)\//, skipLine: /harness-allow|fetch\(\s*(url|input)\s*,/, msg: '동적 URL fetch — SSRF 가능성 (호스트 화이트리스트/내부IP·리다이렉트 차단 확인)' },
  { id: 'SEC-REDIRECT-PARAM', p: 'security', sev: 'high', re: /redirect\(\s*\d{3}\s*,\s*(?!['"`])[A-Za-z_]/, ext: ['.ts'], requireFile: /searchParams\.get\(\s*['"](redirect|redirectTo|next|returnTo|return|return_to|callback|continue|dest|url)['"]/, unlessFile: /safeReturnPath|safePath|isSafeRedirect/, msg: '외부 입력 기반 redirect — Open Redirect (safeReturnPath 경유 필수)' },
  { id: 'SEC-GOTO-PARAM', p: 'security', sev: 'high', re: /\bgoto\(\s*(redirectTo|returnTo|next|redirect|target)\b/, ext: ['.svelte', '.ts'], unlessFile: /safeReturnPath/, msg: 'URL 파라미터 기반 goto — Open Redirect (safeReturnPath 경유 필수)' },
  { id: 'SEC-UPLOAD-UNVALIDATED', p: 'security', sev: 'medium', re: /\.upload\(/, ext: ['.ts'], files: /^src\/(routes|lib\/server)\//, unlessFile: /validateUploadFile|MAX_UPLOAD|allowedMime|ALLOWED_MIME|file\.size|\.size\s*>|fileTypeFromBuffer|contentType/i, msg: '업로드 경로에 MIME/크기 검증 흔적 없음' },
  { id: 'SEC-ENV-ECHO', p: 'security', sev: 'high', re: /(json|new Response|return)\([^)]*\benv\.[A-Z_]*(SECRET|KEY|TOKEN|PASSWORD)/, ext: ['.ts'], msg: '환경변수 비밀 값을 응답으로 반환' },
];

/** 파일 단위 규칙 */
const FILE_RULES = [
  {
    id: 'SEC-CRON-NO-AUTH', p: 'security', sev: 'critical',
    when: (f) => /^src\/routes\/api\/cron\/.+\/\+server\.ts$/.test(f),
    check: (src) => (/CRON_SECRET/.test(src) ? null : '크론 엔드포인트에 CRON_SECRET 검증 없음 (누구나 호출 가능)'),
  },
  {
    id: 'SEC-CRON-FAIL-OPEN', p: 'security', sev: 'high',
    when: (f) => /^src\/routes\/api\/cron\/.+\/\+server\.ts$/.test(f),
    check: (src) => (/CRON_SECRET/.test(src) && !/(!cronSecret|!secret|!env\.CRON_SECRET)[\s\S]{0,120}(401|403)/.test(src) ? 'CRON_SECRET 미설정 시 fail-closed(401) 처리 확인 불가' : null),
  },
  {
    id: 'SEC-WEBHOOK-NO-SIGNATURE', p: 'security', sev: 'critical',
    when: (f) => /^src\/routes\/api\/webhooks\/.+\/\+server\.ts$/.test(f),
    check: (src) => (/createHmac|timingSafeEqual|verify\w*Signature|signature/i.test(src) ? null : '웹훅 엔드포인트에 서명 검증 없음'),
  },
  {
    id: 'SEC-API-NO-AUTH', p: 'security', sev: 'high',
    when: (f) => /^src\/routes\/api\/.+\/\+server\.ts$/.test(f) && !/^src\/routes\/api\/(cron|webhooks)\//.test(f),
    check: (src) => {
      const mutating = /export\s+(const|async function|function)\s+(POST|PUT|PATCH|DELETE)\b/.test(src);
      if (!mutating) return null;
      if (/status:\s*410|code:\s*'GONE'/.test(src)) return null; // 폐기(410) 라우트는 제외
      const auth = /safeGetSession|getSession|getUser|requireMenuAccess|requireAnyMenuAccess|getCmsRoleForAction|requireTrueSuperadmin|hasSettingsAccess|params\.token|\btoken\b[\s\S]{0,80}(verify|valid|rpc)|CRON_SECRET|verifyTossSignature|locals\.user|locals\.session/.test(src);
      if (auth) return null;
      const hasRate = /rate.?limit|throttle|ip_?hash|attempts/i.test(src);
      return hasRate ? null : '변경(POST/PUT/PATCH/DELETE) 엔드포인트에 인증/토큰 검증 흔적 없음 — 비인증 공개 엔드포인트라면 속도제한·남용방지(OTP SMS 비용 폭탄 등) 근거 필요';
    },
  },
  {
    id: 'SEC-SDM-NO-SEARCH-PATH', p: 'security', sev: 'high',
    when: (f) => f.startsWith('supabase/migrations/'),
    check: (src) => {
      const fns = src.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[\s\S]*?(?=\$\$\s*;|\$[a-z_]*\$\s*;)/gi) || [];
      const bad = fns.filter((b) => /SECURITY\s+DEFINER/i.test(b) && !/SET\s+search_path/i.test(b));
      return bad.length ? `SECURITY DEFINER 함수 ${bad.length}개에 SET search_path 없음 (search_path 하이재킹)` : null;
    },
  },
  {
    id: 'SEC-NEW-TABLE-NO-RLS', p: 'security', sev: 'high',
    when: (f) => f.startsWith('supabase/migrations/'),
    check: (src) => {
      const created = [...src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)].map((m) => m[1]);
      const missing = created.filter((t) => !new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?"?${t}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(src));
      return missing.length ? `신규 테이블 RLS 미활성: ${missing.join(', ')}` : null;
    },
  },
  {
    id: 'SEC-GRANT-ANON', p: 'security', sev: 'medium',
    when: (f) => f.startsWith('supabase/migrations/'),
    check: (src) => (/GRANT\s+(EXECUTE|ALL|INSERT|UPDATE|DELETE)[^;]*\sTO\s+(anon|PUBLIC)\b/i.test(src) ? 'anon/PUBLIC에 쓰기·실행 권한 GRANT — 의도 증명 필요 (security-auth.md §23)' : null),
  },
  {
    id: 'SEC-SDM-NO-REVOKE', p: 'security', sev: 'medium',
    when: (f) => f.startsWith('supabase/migrations/'),
    check: (src) => (/SECURITY\s+DEFINER/i.test(src) && !/REVOKE\s+(ALL|EXECUTE)[^;]*FROM\s+(PUBLIC|anon)/i.test(src) ? 'SECURITY DEFINER 함수가 있으나 REVOKE FROM PUBLIC/anon 없음 (기본 권한 상속 위험, §23)' : null),
  },
  {
    id: 'SEC-SUPPLY-LIFECYCLE', p: 'security', sev: 'high',
    when: (f) => f === 'package.json',
    check: (src) => {
      let pkg; try { pkg = JSON.parse(src); } catch { return 'package.json 파싱 실패'; }
      const bad = [];
      for (const k of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
        const v = pkg.scripts?.[k];
        if (v && /(curl|wget|\bnc\b|bash\s+-c|sh\s+-c|node\s+-e|eval|base64|https?:\/\/)/i.test(v)) bad.push(`${k}: ${v}`);
      }
      return bad.length ? `수명주기 스크립트에 네트워크/인라인 실행 (공급망 웜 패턴): ${bad.join(' | ')}` : null;
    },
  },
  {
    id: 'SEC-SUPPLY-SPEC', p: 'security', sev: 'medium',
    when: (f) => f === 'package.json',
    check: (src) => {
      let pkg; try { pkg = JSON.parse(src); } catch { return null; }
      const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
      const bad = Object.entries(all).filter(([, v]) => /^(\*|latest|git\+|git:|github:|https?:|file:)/.test(String(v)) || String(v) === '');
      return bad.length ? `고정되지 않은/비-레지스트리 의존성: ${bad.map(([k, v]) => `${k}@${v}`).join(', ')}` : null;
    },
  },
  {
    id: 'SEC-HEADERS-MISSING', p: 'security', sev: 'medium',
    when: (f) => f === 'src/hooks.server.ts',
    check: (src) => (/(content-security-policy|x-frame-options|strict-transport-security|referrer-policy)/i.test(src) ? null : 'hooks.server.ts에 전역 보안 헤더(CSP/X-Frame-Options/HSTS/Referrer-Policy) 설정 없음 — vercel.json/svelte.config.js csp 설정도 없다면 클릭재킹·XSS 완화층 부재'),
  },
];

// ───────────────────────── 실행 ─────────────────────────
const findings = [];
const carriedDebt = [];
const notices = [];
const wanted = (p) => PROFILE === 'all' || PROFILE === p;
const add = (f) => findings.push({ ...f, snippet: maskSecrets(f.snippet || '') }); // 안전망: 어떤 경로로 들어와도 한 번 더 마스킹

for (const [rel, lineSet] of targets) {
  let src;
  try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const lines = src.split('\n');
  const ext = extname(rel);
  const isAdded = (n) => lineSet === null || lineSet.has(n);

  // 비밀키 스캔은 이 스크립트 자신·테스트 픽스처 제외
  if (rel === 'scripts/harness-scan.mjs') continue;

  // AI-7: 에이전트·IDE 설정 오염 — 비가시 유니코드(제로폭·BiDi), 원격 실행 지시, git 쓰기 allow 패턴
  if (isAgentCfg(rel)) {
    if (wanted('security')) {
      const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\u{E0000}-\u{E007F}]/u; // 태그 문자 포함(보이지 않는 지시 은닉) — 변이 선택자(FE0F 등)는 이모지에 정상 사용돼 제외
      lines.forEach((ln, i) => {
        const n = i + 1;
        if (!isAdded(n)) return;
        if (!isAgentDoc(rel) && /\.json$/.test(rel) && SECRET_RE.test(ln)) { SECRET_RE.lastIndex = 0; add({ rule: 'SEC-AGENT-SECRET-LITERAL', sev: 'critical', file: rel, line: n, msg: '에이전트 설정(JSON)에 비밀키/토큰 리터럴 — 허용(allow) 패턴에 명령째 저장된 키는 즉시 폐기·재발급 + 패턴 삭제 권고', snippet: snip(ln, 100) }); }
        SECRET_RE.lastIndex = 0;
        if (HIDDEN.test(ln)) add({ rule: 'SEC-AGENT-HIDDEN-UNICODE', sev: 'critical', file: rel, line: n, msg: '에이전트/규칙 파일에 비가시 유니코드(제로폭·BiDi) — Rules File Backdoor 의심', snippet: JSON.stringify(snip(ln, 100)) });
        if (!isAgentDoc(rel) && /settings(\.local)?\.json$|(^|\/)hooks?\.json$/.test(rel) && /"command"\s*:\s*"[^"]*(curl|wget|\|\s*(ba|z)?sh\b|base64\s+-d|\beval\b)/.test(ln)) add({ rule: 'SEC-AGENT-HOOKS', sev: 'high', file: rel, line: n, msg: 'hook 명령에 원격 다운로드·파이프 실행·eval 패턴 (CVE-2026-48124 유형: hook이 실행 경로가 됨)', snippet: snip(ln, 120) });
        if (!isAgentDoc(rel) && /settings(\.local)?\.json$/.test(rel) && /^\s*"(Bash|Bash\(\*\)|WebFetch|Bash\(curl:\*\)|Bash\(wget:\*\)|Bash\(git (push|commit|add|merge|rebase|reset)[^"]*\))"\s*,?\s*$/.test(ln)) add({ rule: 'SEC-AGENT-ALLOW-BROAD', sev: 'high', file: rel, line: n, msg: '허용(allow) 패턴이 과도하게 넓거나 git 쓰기 명령 자동승인 — 좁은 패턴만 허용(2026-08-19 병렬 세션 사고)', snippet: snip(ln, 120) });
        if (!isAgentDoc(rel) && /mcp[^\/]*\.json$/.test(rel) && /("url"\s*:\s*"https?:\/\/|npx\s+-y\s+(?!@?[\w.\/-]+@\d))/.test(ln)) add({ rule: 'SEC-AGENT-MCP-REMOTE', sev: 'medium', file: rel, line: n, msg: 'MCP 설정에 원격 서버 URL 또는 버전 미고정 npx -y — 허용목록·버전/해시 고정·도구 설명 변경 감지 확인 (tool poisoning/rug pull)', snippet: snip(ln, 120) });
        if (!isAgentDoc(rel) && /(curl|wget)[^\n|]*\|\s*(ba|z)?sh\b/.test(ln)) add({ rule: 'SEC-AGENT-REMOTE-EXEC', sev: 'high', file: rel, line: n, msg: '설정/규칙에 원격 스크립트 파이프 실행(curl|sh) 지시', snippet: snip(ln, 140) });
        if (/settings(\.local)?\.json$/.test(rel) && /"Bash\(git (add|commit|push|merge|rebase|reset|checkout|stash)/.test(ln)) add({ rule: 'SEC-AGENT-GIT-ALLOW', sev: 'high', file: rel, line: n, msg: 'git 쓰기 명령 자동승인(allow) 패턴 — 금지(2026-08-19 병렬 세션 충돌 사고)', snippet: snip(ln, 140) });
        if (!isAgentDoc(rel) && /[A-Za-z0-9+/]{200,}={0,2}/.test(ln) && !/https?:\/\//.test(ln)) add({ rule: 'SEC-AGENT-BLOB', sev: 'medium', file: rel, line: n, msg: '규칙/설정 파일에 긴 base64류 문자열 — 인코딩된 지시 은닉 가능성', snippet: snip(ln, 80) + '…' });
      });
    }
    continue;
  }

  const propNames = new Set();
  if (ext === '.svelte') {
    const m = src.match(/let\s*\{([^}]*)\}\s*(?::\s*[\w<>[\], |.&]+)?\s*=\s*\$props\(\)/);
    if (m) m[1].split(',').forEach((s) => { const n = s.trim().split(/[:=\s]/)[0]; if (n && !n.startsWith('...')) propNames.add(n); });
  }

  for (const r of LINE_RULES) {
    if (!wanted(r.p)) continue;
    if (!r.ext.includes(ext) && !(rel.endsWith('.sql') && r.ext.includes('.sql'))) continue;
    if (r.files && !r.files.test(rel)) continue;
    if (r.requireFile && !r.requireFile.test(src)) continue;
    if (r.unlessFile && r.unlessFile.test(src)) continue;
    lines.forEach((ln, i) => {
      const n = i + 1;
      if (!isAdded(n)) return;
      if (r.special === 'statePropInit') {
        if (!propNames.size) return;
        const m = ln.match(/\$state\(\s*([A-Za-z_]\w*)\b/);
        if (m && propNames.has(m[1]) && !/\$effect|#key/.test(ln)) add({ rule: r.id, sev: r.sev, file: rel, line: n, msg: r.msg, snippet: snip(ln, 160) });
        return;
      }
      if (!r.re.test(ln)) return;
      if (r.skipLine && r.skipLine.test(ln)) return;
      if (r.unlessLine && r.unlessLine.test(ln)) return;
      if (r.near && !r.near.test(lines.slice(Math.max(0, i - 3), i + 4).join('\n'))) return;
      if (r.near2 && r.near2.test(lines.slice(i, i + 4).join('\n'))) return;
      add({ rule: r.id, sev: r.sev, file: rel, line: n, msg: r.msg, snippet: snip(ln, 160) });
    });
  }

  for (const r of FILE_RULES) {
    if (!wanted(r.p) || !r.when(rel)) continue;
    const msg = r.check(src);
    if (!msg) continue;
    // 변경분 모드 + 기존(추적 중) 소스 파일: HEAD(BASE)에서도 같은 위반이면 '이월 부채' — 신규로 세지 않는다.
    // (HEAD에는 없었는데 지금 생긴 위반 = 이번 변경이 만든 회귀 → 신규. 신규 파일·설정·마이그레이션은 항상 신규로 센다)
    if (!ALL && lineSet !== null && rel.startsWith('src/')) {
      const baseSrc = git(['show', `${BASE}:${rel}`]);
      if (baseSrc && r.check(baseSrc)) { carriedDebt.push({ rule: r.id, sev: r.sev, file: rel, msg }); continue; }
    }
    add({ rule: r.id, sev: r.sev, file: rel, line: 1, msg, snippet: '' });
  }
}

// 신규 의존성 알림(슬롭스쿼팅/공급망 검증 대상) — 변경분 모드에서만
if (!ALL && wanted('security') && targets.has('package.json')) {
  const d = git(['diff', '-U0', '--no-color', BASE, '--', 'package.json']);
  const added = [...d.matchAll(/^\+\s+"(@?[\w./-]+)":\s*"([^"]+)"/gm)].map((m) => `${m[1]}@${m[2]}`)
    .filter((s) => !/^(name|version|description|main|type|license|author|keywords)@/.test(s));
  if (added.length) notices.push({ kind: 'NEW-DEPENDENCY', items: added, msg: '신규/변경 의존성 — 실존·생성일·주간 다운로드·메인테이너·설치 스크립트 검증 필수(npm view <pkg> time maintainers scripts). 환각 패키지명(slopsquatting)·타이포스쿼팅 의심 시 즉시 중단.' });
}

findings.sort((a, b) => SEV_ORDER[b.sev] - SEV_ORDER[a.sev] || a.file.localeCompare(b.file) || a.line - b.line);
const counts = findings.reduce((m, f) => ((m[f.sev] = (m[f.sev] || 0) + 1), m), {});
const byRule = findings.reduce((m, f) => ((m[f.rule] = (m[f.rule] || 0) + 1), m), {});

if (AS_JSON) {
  console.log(JSON.stringify({ mode: ALL ? 'all' : `diff:${BASE}`, profile: PROFILE, scannedFiles: targets.size, counts, byRule, findings, carriedDebt, unmatched, notices }, null, 2));
} else {
  console.log(`harness-scan | mode=${ALL ? 'ALL(전체·감사용)' : `DIFF(${BASE} 대비 변경 줄만)`} | profile=${PROFILE} | 대상 파일 ${targets.size}개`);
  if (!findings.length) console.log('발견 없음 — (정규식 휴리스틱 범위 내. 데이터흐름·권한경로는 에이전트 수동 추적 필요)');
  for (const f of findings) console.log(`[${f.sev.toUpperCase()}] ${f.rule}  ${f.file}:${f.line}\n    ${f.msg}${f.snippet ? `\n    > ${f.snippet}` : ''}`);
  for (const d of carriedDebt) console.log(`[이월부채·참고] ${d.rule}  ${d.file}\n    ${d.msg}  (HEAD에도 있던 위반 — 이번 변경 아님, 의심 신호로 쓰지 않음)`);
  if (unmatched.length) console.log(`[경고] 스캔 대상이 아닌 지정 파일 ${unmatched.length}개: ${unmatched.join(', ')}`);
  for (const n of notices) console.log(`[NOTICE] ${n.kind}: ${n.items.join(', ')}\n    ${n.msg}`);
  console.log(`\n요약: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || '0건'}`);
  if (ALL) console.log('규칙별: ' + Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
}

if (FAIL_ON && typeof FAIL_ON === 'string') {
  const th = SEV_ORDER[FAIL_ON] ?? 3;
  if (findings.some((f) => SEV_ORDER[f.sev] >= th)) process.exit(1);
}
