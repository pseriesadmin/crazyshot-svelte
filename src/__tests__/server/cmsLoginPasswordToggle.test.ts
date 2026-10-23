/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * CMS 로그인 비밀번호 표시/숨기기 버튼 (2026-10-23) — 소스 점검
 * 사용자 로그인(/auth/login)과 같은 기능을 관리자 로그인에도 제공한다. 호버는 BG 색만 바뀌어야 한다(cms bds §0-10).
 */
const src = readFileSync(resolve(__dirname, '../../routes/cms/login/+page.svelte'), 'utf8')

describe('CMS 로그인 — 비밀번호 표시/숨기기', () => {
  it('로그인 비밀번호 입력이 showPassword 상태로 type 을 바꾼다(기본은 가림)', () => {
    expect(src).toMatch(/let showPassword = \$state\(false\)/)
    expect(src).toMatch(/type=\{showPassword \? 'text' : 'password'\}/)
  })

  it('토글 버튼은 button type=button + 상태별 aria-label + aria-pressed', () => {
    expect(src).toMatch(/<button\s+type="button"\s+class="pw-eye-btn"/)
    expect(src).toContain("showPassword ? '비밀번호 숨기기' : '비밀번호 표시'")
    expect(src).toMatch(/aria-pressed=\{showPassword\}/)
  })

  it('호버는 BG 색만 변경 — outline·box-shadow 없음, 터치 타겟 44px, 하드코딩 색 없음', () => {
    const css = src.slice(src.indexOf('.pw-eye-btn {'), src.indexOf('.pw-eye-btn:hover'))
    expect(css).toContain('width: 44px')
    expect(css).toContain('height: 44px')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    const hover = src.slice(src.indexOf('.pw-eye-btn:hover'), src.indexOf('.pw-eye-btn:hover') + 80)
    expect(hover).toContain('background: var(--cs-lilac)')
    expect(hover).not.toMatch(/outline|box-shadow/)
  })

  it('로그인 비밀번호의 한글 차단·글자수 제한은 그대로 유지', () => {
    expect(src).toContain('maxlength={72}')
    expect(src).toContain("csToast.warning('영문(숫자)으로 입력하세요.')")
  })
})
