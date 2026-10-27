import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

/**
 * harness-scan 게이트 동작 평가 (2026-10-20, sp3 독립 검수 지적 M1·M2·M3 반영)
 * 임시 git 저장소(OS 임시 폴더 — 프로젝트 저장소 아님)에서 diff 모드·이월 부채 분리·--files·--fingerprint·--fail-on·git 실패를 검증한다.
 * 게이트 도구는 "입력이 잘못되면 통과"가 아니라 "비정상 종료(exit 2)"여야 한다.
 */
const SCAN = join(process.cwd(), 'scripts/harness-scan.mjs')
let repo = ''
const w = (rel: string, content: string) => { const f = join(repo, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content) }
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, stdio: 'ignore' })
interface Out { status: number | null; stdout: string; stderr: string; json: { findings: { file: string; rule: string; line: number }[]; carriedDebt: { file: string; rule: string }[]; unmatched: string[] } | null }
function scan(...a: string[]): Out {
  const r = spawnSync('node', [SCAN, '--root', repo, '--json', ...a], { cwd: repo, encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* exit 2 등 */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json }
}
const has = (o: Out, file: string, rule: string) => !!o.json?.findings.some((f) => f.file === file && f.rule === rule)

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'harness-gate-'))
  git('init', '-q', '-b', 'main')
  // HEAD: 인증 없는 크론(기존 부채) / 정상 크론 / console.log 가 이미 있는 파일
  w('src/routes/api/cron/debt/+server.ts', "export const GET = async () => new Response('ok')\n")
  w('src/routes/api/cron/regress/+server.ts', "import { env } from '$env/dynamic/private'\nexport const GET = async () => {\n  const cronSecret = env.CRON_SECRET\n  if (!cronSecret) return new Response('x', { status: 401 })\n  return new Response('ok')\n}\n")
  w('src/lib/server/legacy.ts', "console.log('old')\nexport const a = 1\n")
  w('src/lib/server/other.ts', "console.log('other-old')\n")
  git('add', '-A'); git('commit', '-q', '-m', 'base')
  // 작업트리 변경
  appendFileSync(join(repo, 'src/routes/api/cron/debt/+server.ts'), '// touched\n') // 기존 위반 파일을 건드림 → 이월 부채
  w('src/routes/api/cron/regress/+server.ts', "export const GET = async () => new Response('ok')\n") // HEAD엔 CRON_SECRET 있었음 → 이번에 사라짐 = 회귀
  appendFileSync(join(repo, 'src/lib/server/legacy.ts'), 'export const b = 2\n') // 새 줄엔 위반 없음, 옛 console.log 는 그대로
  appendFileSync(join(repo, 'src/lib/server/other.ts'), "console.log('new-line')\n") // 새 줄에 console.log
  w('src/lib/server/한글 파일.ts', "console.log('untracked')\n") // untracked + 한글/공백 경로
})
afterAll(() => { if (repo) rmSync(repo, { recursive: true, force: true }) })

describe('diff 모드 — 신규 줄만 판정', () => {
  it('옛 console.log 는 세지 않고 새로 추가한 줄만 센다', () => {
    const o = scan()
    expect(has(o, 'src/lib/server/legacy.ts', 'QA-CONSOLE')).toBe(false)
    expect(has(o, 'src/lib/server/other.ts', 'QA-CONSOLE')).toBe(true)
    expect(o.json!.findings.find((f) => f.file === 'src/lib/server/other.ts')?.line).toBe(2)
  })
  it('한글·공백 경로의 untracked 파일도 스캔된다 (git quotepath)', () => {
    expect(has(scan(), 'src/lib/server/한글 파일.ts', 'QA-CONSOLE')).toBe(true)
  })
})

describe('파일 단위 규칙 — 이월 부채 vs 회귀', () => {
  it('HEAD 에도 있던 위반(인증 없는 크론)은 이월 부채로 분리되고 신규로 세지 않는다', () => {
    const o = scan()
    expect(has(o, 'src/routes/api/cron/debt/+server.ts', 'SEC-CRON-NO-AUTH')).toBe(false)
    expect(o.json!.carriedDebt.some((d) => d.file === 'src/routes/api/cron/debt/+server.ts' && d.rule === 'SEC-CRON-NO-AUTH')).toBe(true)
  })
  it('HEAD 엔 없었는데 이번 변경으로 생긴 위반(CRON_SECRET 제거)은 신규(critical)로 잡힌다', () => {
    expect(has(scan(), 'src/routes/api/cron/regress/+server.ts', 'SEC-CRON-NO-AUTH')).toBe(true)
  })
})

describe('--fail-on 종료 코드', () => {
  it('신규 high 이상이 있으면 exit 1', () => { expect(scan('--fail-on', 'high').status).toBe(1) })
  it('이월 부채·낮은 등급만 있는 범위(--files)는 exit 0', () => {
    expect(scan('--files', 'src/routes/api/cron/debt/+server.ts,src/lib/server/legacy.ts', '--fail-on', 'high').status).toBe(0)
  })
  it('--fail-on 오타·값 누락은 게이트를 끄지 않고 exit 2', () => {
    expect(scan('--fail-on', 'hihg').status).toBe(2)
    expect(scan('--fail-on').status).toBe(2)
  })
})

describe('--files — 오입력이 조용히 통과하지 않는다', () => {
  it('지정 파일이 전부 스캔 대상이 아니면 exit 2 (없는 파일·오타)', () => {
    const o = scan('--files', 'src/nope.ts,src/x.ts', '--fail-on', 'high')
    expect(o.status).toBe(2)
    expect(o.stderr).toContain('통과 아님')
  })
  it('--allow-empty 면 의도적 빈 대상을 허용한다', () => {
    expect(scan('--files', 'src/nope.ts', '--allow-empty').status).toBe(0)
  })
  it('일부만 불일치하면 스캔은 하고 unmatched 로 알린다', () => {
    const o = scan('--files', 'src/lib/server/other.ts,src/nope.ts')
    expect(o.json!.unmatched).toEqual(['src/nope.ts'])
    expect(has(o, 'src/lib/server/other.ts', 'QA-CONSOLE')).toBe(true)
  })
  it('--files 는 목록 밖 파일의 발견을 제외한다 (다른 세션 변경 혼입 방지)', () => {
    const o = scan('--files', 'src/lib/server/legacy.ts')
    expect(o.json!.findings.length).toBe(0)
  })
  it('./ 접두 표기와 절대경로도 같은 파일로 인식한다', () => {
    expect(has(scan('--files', './src/lib/server/other.ts'), 'src/lib/server/other.ts', 'QA-CONSOLE')).toBe(true)
    expect(has(scan('--files', join(repo, 'src/lib/server/other.ts')), 'src/lib/server/other.ts', 'QA-CONSOLE')).toBe(true)
  })
})

describe('git 수집 실패는 통과가 아니라 exit 2', () => {
  it('존재하지 않는 --base', () => {
    const o = scan('--base', 'nonexistentref', '--fail-on', 'high')
    expect(o.status).toBe(2)
    expect(o.stderr).toContain('통과 아님')
  })
})

describe('--fingerprint — REUSE 판단용', () => {
  const fp = (...f: string[]) => spawnSync('node', [SCAN, '--root', repo, '--fingerprint', '--files', f.join(',')], { cwd: repo, encoding: 'utf8' }).stdout.trim()
  it('같은 내용·같은 목록(순서·./ 표기 무관)이면 같은 지문, 내용이 바뀌면 다른 지문', () => {
    const a = fp('src/lib/server/other.ts', 'src/lib/server/legacy.ts')
    expect(a).toMatch(/^fp:[0-9a-f]{12} files=2$/)
    expect(fp('./src/lib/server/legacy.ts', 'src/lib/server/other.ts')).toBe(a)
    appendFileSync(join(repo, 'src/lib/server/legacy.ts'), '// changed\n')
    expect(fp('src/lib/server/other.ts', 'src/lib/server/legacy.ts')).not.toBe(a)
  })
})
