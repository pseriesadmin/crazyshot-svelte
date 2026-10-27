import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

/**
 * harness-scan 평가(eval) 세트 — 스캐너 자기 검증 (2026-10-20)
 * scripts/eval-fixtures/cases.json 의 심은 취약 파일을 임시 폴더에 풀어 `--all --root <tmp> --json` 으로 스캔하고
 *   · 재현율: expect 로 지정한 (파일, 규칙) 이 전부 검출되는가 (규칙 수정 시 조용한 미탐 회귀 방지)
 *   · 오탐:  clean 대조군 파일에서 발견이 0건인가
 *   · 비밀 마스킹: 출력에 가짜 키 원문이 남지 않는가
 * 를 측정한다. 이 테스트는 "스캐너"의 성능이며, LLM 에이전트(sp3/sp5)의 평가는 .claude/harness/security/AGENT_EVALS.md 참고.
 */
interface Cases { files: Record<string, string>; expect: { file: string; rule: string }[]; clean: string[]; _masking_strings: string[] }
interface Report { findings: { file: string; rule: string; snippet: string }[] }

const cases = JSON.parse(readFileSync(join(process.cwd(), 'scripts/eval-fixtures/cases.json'), 'utf8')) as Cases
let dir = ''
let stdout = ''
let textOut = ''
let report: Report = { findings: [] }

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-eval-'))
  for (const [rel, content] of Object.entries(cases.files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  stdout = execFileSync('node', [join(process.cwd(), 'scripts/harness-scan.mjs'), '--all', '--root', dir, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  report = JSON.parse(stdout) as Report
  textOut = execFileSync('node', [join(process.cwd(), 'scripts/harness-scan.mjs'), '--all', '--root', dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
})
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('harness-scan 평가 세트', () => {
  it('재현율 100% — 심은 (파일, 규칙) 을 전부 검출한다', () => {
    const missed = cases.expect.filter((e) => !report.findings.some((f) => f.file === e.file && f.rule === e.rule))
    expect(missed).toEqual([])
    expect(cases.expect.length).toBeGreaterThanOrEqual(25)
  })

  it('오탐 0건 — 깨끗한 대조군에서 발견이 없다', () => {
    const fp = report.findings.filter((f) => cases.clean.includes(f.file))
    expect(fp).toEqual([])
  })

  it('비밀 리터럴 원문·조각은 어떤 출력(JSON·텍스트)에도 남지 않는다 — 에이전트 설정 파일의 hooks·allow·blob·숨은 문자 줄 포함', () => {
    for (const secret of cases._masking_strings) {
      expect(stdout, `JSON 출력에 ${secret.slice(0, 6)}… 잔존`).not.toContain(secret)
      expect(textOut, `텍스트 출력에 ${secret.slice(0, 6)}… 잔존`).not.toContain(secret)
    }
    // 잘린 토큰 조각(접두 + 연속 영숫자)도 없어야 한다
    expect(stdout).not.toMatch(/sk_live_[A-Za-z0-9]{4,}/)
    expect(textOut).not.toMatch(/AKIA[A-Z0-9]{8,}/)
  })
})
