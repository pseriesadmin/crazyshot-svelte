// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * sanitize-html CJS↔ESM 호환 회귀 방지 (2026-10-06, Production 500 사고)
 *
 * 사고: sanitize-html@2.18.0(CommonJS)이 htmlparser2@^12(ESM 전용)를 require()해서 Vercel 런타임에서
 *       ERR_REQUIRE_ESM → /crazylog/view/* 전부 500. 로컬(Vite·vitest·Node 22)은 ESM require를 허용해 통과했다.
 * 수정: sanitize-html을 2.17.2(htmlparser2@^10 — CJS 지원)로 정확 고정.
 * 이 테스트는 Vercel과 같은 조건(Node의 ESM require 비활성)으로 실제 로드해, 버전을 올렸다가 같은 사고가 나면 배포 전에 실패한다.
 */
describe('sanitize-html — 서버리스(CJS→ESM require 불가) 환경에서 로드된다', () => {
  it('ESM require를 끈 Node에서 require("sanitize-html")이 성공하고 정화가 동작한다', () => {
    const out = execFileSync(
      process.execPath,
      ['--no-experimental-require-module', '-e', "const s=require('sanitize-html');process.stdout.write(s('<p>a</p><script>1</script>'))"],
      { encoding: 'utf8' },
    )
    expect(out).toBe('<p>a</p>')
  })

  it('package.json이 sanitize-html을 정확 버전으로 고정한다(^ 범위 금지 — 마이너 업데이트가 ESM 전용 의존성을 끌어옴)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> }
    const v = pkg.dependencies?.['sanitize-html'] ?? ''
    expect(v).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
