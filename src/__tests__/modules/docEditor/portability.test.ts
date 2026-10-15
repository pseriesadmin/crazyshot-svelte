/**
 * portability.test.ts — doc-editor 이식성 게이트
 *
 * core/·ui/·examples/ 소스는 프로젝트 고유 의존($lib·$app·$env·supabase·/api 호출·csToast)이 없어야 한다.
 * adapters/crazyshot 만 호스트 의존을 가질 수 있다. 위반 시 "다른 프로젝트로 폴더 복사" 계약이 깨진다.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(process.cwd(), 'src/lib/modules/doc-editor')

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const SOURCE_RE = /\.(ts|svelte)$/
const ALLOWED_PACKAGE = [/^svelte(\/.*)?$/, /^svelte-tiptap$/, /^@tiptap\/[\w-]+(\/[\w-]+)*$/, /^prosemirror-[\w-]+$/]

function importSpecifiers(src: string): string[] {
  const out: string[] = []
  const stat = /(?:^|\n)\s*(?:import|export)\s[^'"`]*?from\s+['"]([^'"]+)['"]/g
  const side = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const re of [stat, side, dyn]) for (const m of src.matchAll(re)) out.push(m[1])
  return out
}

/** 주석을 제거해 설명 문구가 오탐되지 않게 한다 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '')
}

const PORTABLE_DIRS = ['core', 'ui', 'examples']
const files = PORTABLE_DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => SOURCE_RE.test(f))

describe('doc-editor 이식성 게이트 (core·ui·examples)', () => {
  it('core 폴더에 소스 파일이 있다(스캔이 비어 통과하는 것 방지)', () => {
    expect(files.filter((f) => f.includes('/core/')).length).toBeGreaterThan(3)
  })

  for (const file of files) {
    const rel = relative(ROOT, file)
    const src = stripComments(readFileSync(file, 'utf-8'))

    it(`${rel}: import 는 상대경로 또는 허용 패키지만`, () => {
      const bad = importSpecifiers(src).filter((spec) => {
        if (spec.startsWith('./') || spec.startsWith('../')) return false
        return !ALLOWED_PACKAGE.some((re) => re.test(spec))
      })
      expect(bad).toEqual([])
    })

    it(`${rel}: 호스트 고유 호출·참조 없음($lib·$app·$env·supabase·/api/·csToast)`, () => {
      expect(src).not.toMatch(/\$lib|\$app|\$env|supabase|csToast/i)
      expect(src).not.toMatch(/['"`]\/api\//)
    })
  }
})

describe('README 설치 패키지 목록 ↔ 실제 package.json', () => {
  it('README의 npm i 패키지가 모두 이 프로젝트 package.json 의존성에 있다(검증된 조합)', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8')
    const block = readme.slice(readme.indexOf('npm i svelte-tiptap'), readme.indexOf('# DB 연동을 쓸 때'))
    const pkgs = [...block.matchAll(/(?:^|\s)((?:@[\w-]+\/)?[\w.-]+)(?:@\^?\d[^\s\\]*)?(?=\s|\\|$)/g)]
      .map((m) => m[1])
      .filter((n) => n !== 'npm' && n !== 'i')
    expect(pkgs.length).toBeGreaterThan(10)
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const have = { ...pkg.dependencies, ...pkg.devDependencies }
    const missing = pkgs.filter((n) => !(n in have))
    expect(missing).toEqual([])
  })
})
