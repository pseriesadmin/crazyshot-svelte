// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * 파일 저장용 새 의존성 안전장치 (2026-10-29)
 *  - 정확 버전 고정(^ 금지): 마이너 업데이트가 ESM 전용 의존성을 끌어와 Vercel 런타임에서 깨진 sanitize-html 사고(2026-10-06)의 재발 방지
 *  - docx 는 ESM 비활성 Node(Vercel 서버리스와 같은 조건)에서도 로드된다
 *  - 한글 엔진 파일은 기록한 해시와 같아야 한다(무심코 바뀐 엔진·변조 방지 — HOP와 같은 방식)
 */
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> }

describe('파일 저장 의존성 — 정확 버전 고정', () => {
  for (const name of ['@rhwp/core', 'docx', 'exceljs']) {
    it(`${name} 는 정확한 버전으로 고정돼 있다`, () => {
      expect(pkg.dependencies?.[name] ?? '').toMatch(/^\d+\.\d+\.\d+$/)
    })
  }
  it('고정 버전이 합의된 값이다(올릴 때는 이 테스트·엔진 해시를 함께 갱신)', () => {
    expect(pkg.dependencies?.['@rhwp/core']).toBe('0.8.7')
    expect(pkg.dependencies?.['docx']).toBe('9.15.0')
    expect(pkg.dependencies?.['exceljs']).toBe('4.4.0')
  })
})

describe('docx — 서버리스(ESM require 불가) 조건에서 로드', () => {
  it('ESM require를 끈 Node에서 docx 와 docx/html 이 로드된다', () => {
    const out = execFileSync(
      process.execPath,
      ['--no-experimental-require-module', '-e', "const d=require('docx');const h=require('docx/html');process.stdout.write(typeof d.Document+','+typeof h.htmlToContent)"],
      { encoding: 'utf8' },
    )
    expect(out).toBe('function,function')
  })
})

describe('한글 엔진 파일 해시', () => {
  it('@rhwp/core 0.8.7 의 rhwp_bg.wasm 이 기록한 해시와 같다', () => {
    const sha = createHash('sha256').update(readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')).digest('hex')
    expect(sha).toBe('54cf95014312e605c51b98eb9021247ea79ef2bbd0a7080e11c011d0246e3989')
  })
  it('엔진 패키지의 버전·라이선스가 기록과 같다(MIT)', () => {
    const p = JSON.parse(readFileSync('node_modules/@rhwp/core/package.json', 'utf8')) as { version: string; license: string }
    expect(p.version).toBe('0.8.7')
    expect(p.license).toBe('MIT')
  })
})
