#!/usr/bin/env node
/**
 * package-contract-kit.mjs — 전자계약 모듈을 다른 프로젝트로 옮길 수 있는 폴더로 패키징한다(2026-10-17).
 *
 * 사용: node scripts/package-contract-kit.mjs [출력폴더]
 *   기본 출력: <저장소 상위폴더>/crazyshot-contract-kit
 *
 * 동작(원본 소스는 읽기만 한다 — 저장소 파일을 수정하지 않는다):
 *   1. 모듈 시작점(SEEDS)에서 import 를 따라가 "필요한 파일 전체(closure)"를 모은다.
 *   2. src/lib/** 를 lib/ 아래 같은 구조로 복사하고, `$lib/` import 를 `$lib/contract-kit/` 로 바꾼다
 *      (받는 쪽은 lib/ 를 src/lib/contract-kit/ 에 그대로 넣으면 된다).
 *   3. 호스트 앱이 채워야 할 곳(HOST_TODO.md)·npm 의존성(deps.json)·필요한 CSS 토큰(host/tokens.css)·
 *      DB 스키마(sql/)·원본 참고용(reference/)·테스트(tests/)·MANIFEST.json(파일별 sha256)을 함께 만든다.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, '..', 'crazyshot-contract-kit'))
const KIT_VERSION = '1.1.0'
const NS = 'contract-kit' // src/lib/<NS>/ 에 들어간다

// ── 1. 시작점 ─────────────────────────────────────────────────────────────────────
const SEEDS = [
  'src/lib/modules/doc-editor', // 문서 & 양식 통합 편집기(이식형 모듈 — 이미 자체 완결)
  'src/lib/types/contract-document.ts',
  'src/lib/types/contract-module.ts',
  'src/lib/types/contract-template.ts',
  'src/lib/utils/contract-substitution.ts',
  'src/lib/utils/contract-content-mode.ts',
  'src/lib/utils/contract-apply-template.ts',
  'src/lib/utils/contractIssueDate.ts',
  'src/lib/utils/contractIssueGuard.ts',
  'src/lib/utils/contractLineItems.ts',
  'src/lib/utils/contractSpecs.ts',
  'src/lib/contract-signature',
  'src/lib/server/contractArchive',
  'src/lib/components/common/SignatureCanvas.svelte',
  'src/lib/components/cms/contract-editor',
  'src/lib/components/cms/ContractEditorModal.svelte',
]

// 렌탈 도메인(예약·결제·채팅·역할)과 결합돼 그대로 옮길 수 없는 파일 — reference/ 로 원본 그대로 복사한다.
const REFERENCE = [
  'src/lib/server/contractAutoIssue.ts',
  'src/lib/server/autoIssueOnDocApproval.ts',
  'src/lib/server/contractApprovalGuard.ts',
  'src/lib/server/clearIssuedContractHelper.ts',
  'src/lib/server/checkout/contractPay.ts',
  'src/lib/server/account/loadRentalContractStatus.ts',
  'src/lib/utils/holdContractTimer.ts',
  'src/lib/components/cms/ContractTemplatePanel.svelte',
  'src/lib/components/cms/ContractTemplatePreviewModal.svelte',
  'src/lib/components/cms/RentalContractViewer.svelte',
  'src/lib/components/cms/ReservationContractSpecs.svelte',
  'src/routes/api/cms/contracts',
  'src/routes/api/cms/contract-templates',
  'src/routes/api/cms/reservations/[id]/init-contract',
  'src/routes/api/cms/reservations/[id]/contract-data',
  'src/routes/api/cms/reservations/[id]/contract-specs',
  'src/routes/api/contracts',
  'src/routes/api/cron/contract-archive',
  'src/routes/contract',
  'src/routes/contract-verify',
  'src/routes/cms/reservation/contracts',
  // 양식 화면(ContractTemplatePanel) 단위 테스트 — 패널이 reference 라 같이 둔다
  'src/__tests__/components/contractTemplatePanelGrow.mount.test.ts',
  // 양식 화면(ContractTemplatePanel)이 쓰는 작성 중 보호 유틸(이탈 경고·임시저장·복구) — 패널이 reference 라 같이 둔다(2026-10-29)
  'src/lib/utils/contractModeDraft.ts',
  'src/lib/utils/contractSheetDraft.ts',
  'src/lib/utils/contractUnsavedGuard.ts',
  'src/__tests__/services/contractModeDraft.test.ts',
  'src/__tests__/services/contractSheetDraft.test.ts',
]
// 편집기 기능 계약 문서(지원/미지원/브라우저 범위 ↔ 자동 테스트 매핑)
const DOCS = [['.claude/rules-ref/editor-capabilities.md', 'docs/editor-capabilities.md']]

// 계약 테이블만 다루는 마이그레이션(번호 순) — 렌탈 테이블 참조 여부는 아래에서 자동 표시한다.
const SQL_PICK = [
  '20260529000021_21_contracts.sql',
  '20260723000145_145_contract_signings_signature.sql',
  '20260723000146_146_contract_signings_expiry.sql',
  '20260723000148_148_contract_templates.sql',
  '20260723000149_149_contracts_content_fields.sql',
  '20260812000217_217_contract_signings_content_hash.sql',
  '20260812000218_218_contract_audit_log.sql',
  '20260812000219_219_contract_issuer_signatures_and_assets.sql',
  '20260821000000_323_contract_signed_content_snapshot.sql',
  '20260824010000_332_cms_signature_default_atomic.sql',
  '20260907000000_450_html_issuer_signature_url.sql',
  '20260907010000_451_html_issuer_signature_width.sql',
  '20260907070000_457_contract_audit_log_cancelled_event.sql',
  '20260908070000_463_html_issuer_signature_offset.sql',
  '20260908080000_464_contract_terms_privacy_text_columns.sql',
  '20260910000000_478_contracts_per_contract_terms_privacy_text.sql',
  '20261006020000_650_contract_signature_evidence_and_archive.sql',
  '20261006030000_651_contract_audit_log_event_types_evidence.sql',
  '20261008010000_669_contract_final_document_seals.sql',
  '20261015140000_717_contract_template_auto_issue_default.sql',
]

// 함께 넣을 테스트(이식 검증용). 원본 프로젝트 전용 파일을 읽는 테스트는 실행 시 걸러진다(TESTS_NOTE).
const TEST_SEEDS = [
  'src/__tests__/modules/docEditor',
  'src/__tests__/components/docEditor.mount.test.ts',
  'src/__tests__/components/docEditorExample.mount.test.ts',
  'src/__tests__/components/docEditorHost.mount.test.ts',
  'src/__tests__/components/docEditorImageUpdate.mount.test.ts',
  'src/__tests__/components/docEditorPanel.mount.test.ts',
  'src/__tests__/components/docEditorToolbarAll.mount.test.ts',
  'src/__tests__/components/contractImportModal.mount.test.ts',
  'src/__tests__/components/contractCanvasImageViewer.mount.test.ts',
  // 구형 엑셀(.xls) 가져오기·스프레드시트 격자(2026-10-29)
  'src/__tests__/services/xlsBiff.test.ts',
  'src/__tests__/services/spreadsheetTrim.test.ts',
  'src/__tests__/utils/hwpxFormatting.test.ts',
  'src/__tests__/utils/hwpxImport.test.ts',
  'src/__tests__/utils/hwpxEditorRoundtrip.test.ts',
]

// ── 유틸 ──────────────────────────────────────────────────────────────────────────
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/')
const abs = (r) => path.join(REPO, r)
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const TEXT_EXT = /\.(ts|js|mjs|svelte|css|sql|md|json|txt)$/

function walk(r) {
  const p = abs(r)
  if (!fs.existsSync(p)) return []
  const st = fs.statSync(p)
  if (st.isFile()) return [r]
  const out = []
  for (const name of fs.readdirSync(p)) {
    if (name === 'node_modules' || name === '.DS_Store') continue
    out.push(...walk(`${r}/${name}`))
  }
  return out
}

const IMPORT_RE = /(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
function resolveImport(from, spec) {
  let base
  if (spec.startsWith('$lib/')) base = `src/lib/${spec.slice(5)}`
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  else return { kind: spec.startsWith('$') ? 'sveltekit' : 'bare', spec }
  const clean = base.replace(/\?.*$/, '')
  const noJs = clean.replace(/\.js$/, '') // TS 가 `./x.js` 로 쓰는 import 는 실제 파일이 x.ts
  for (const c of [clean, `${clean}.ts`, `${clean}.js`, `${clean}.svelte`, `${clean}/index.ts`, `${clean}.json`, `${noJs}.ts`, `${noJs}.svelte`]) {
    if (fs.existsSync(abs(c)) && fs.statSync(abs(c)).isFile()) return { kind: 'file', file: c }
  }
  return { kind: 'missing', spec, base: clean }
}

// ── 2. closure ───────────────────────────────────────────────────────────────────
const seen = new Set()
const queue = []
for (const s of SEEDS) for (const f of walk(s)) if (!seen.has(f)) { seen.add(f); queue.push(f) }
const sveltekitUses = []
const bareUses = new Map()
const missing = []
while (queue.length) {
  const f = queue.pop()
  if (!/\.(ts|svelte)$/.test(f)) continue
  const txt = fs.readFileSync(abs(f), 'utf-8')
  for (const m of txt.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2]
    const r = resolveImport(f, spec)
    if (r.kind === 'sveltekit') sveltekitUses.push([f, spec])
    else if (r.kind === 'bare') {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (!bareUses.has(pkg)) bareUses.set(pkg, new Set())
      bareUses.get(pkg).add(f)
    } else if (r.kind === 'missing') {
      // 폰트 `?inline` 같은 번들러 전용 자원은 이미 시작점 폴더 안에 있어 누락이 아니다
      if (!/\.(woff2?|ttf|css)$/.test(r.base)) missing.push([f, spec])
    } else if (!seen.has(r.file)) {
      if (REFERENCE.some((x) => r.file === x || r.file.startsWith(`${x}/`))) continue
      seen.add(r.file); queue.push(r.file)
    }
  }
}
const kitFiles = [...seen].filter((f) => !REFERENCE.some((x) => f === x || f.startsWith(`${x}/`))).sort()
const seedSet = new Set(SEEDS.flatMap((s) => walk(s)))

// ── 3. 출력 ──────────────────────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true })
const manifest = { name: 'crazyshot-contract-kit', version: KIT_VERSION, generatedAt: new Date().toISOString(), sourceCommit: null, sourceDirtyFiles: [], docEditorModuleVersion: null, namespace: `src/lib/${NS}/`, files: [] }
const git = (args) => { try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf-8' }) } catch { return '' } }
manifest.sourceCommit = git(['rev-parse', 'HEAD']).trim() || null
// 키트에 들어가는 원본 중 아직 커밋되지 않은(수정·신규) 파일 — 원본 커밋과 키트가 어긋나는 지점을 눈에 보이게 한다
const dirty = new Set(git(['status', '--porcelain', '--untracked-files=all']).split('\n').map((l) => l.slice(3).replace(/^"|"$/g, '')).filter(Boolean))
const modMd = fs.existsSync(abs('src/lib/modules/doc-editor/MODULE.md')) ? fs.readFileSync(abs('src/lib/modules/doc-editor/MODULE.md'), 'utf-8') : ''
manifest.docEditorModuleVersion = (modMd.match(/^- (\d+\.\d+\.\d+) \(/m) ?? [])[1] ?? null

function put(outRel, content, meta = {}) {
  const dest = path.join(OUT, outRel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, content)
  manifest.files.push({ path: outRel, sha256: sha(content), bytes: content.length, ...meta })
}
function rewriteLib(txt) {
  return txt.replace(/(['"`])\$lib\//g, `$1$lib/${NS}/`)
}

// lib/ — 키트 본체
for (const f of kitFiles) {
  const buf = fs.readFileSync(abs(f))
  const underLib = f.replace(/^src\/lib\//, '')
  const content = TEXT_EXT.test(f) ? Buffer.from(rewriteLib(buf.toString('utf-8'))) : buf
  put(`lib/${underLib}`, content, { source: f, layer: layerOf(f), seed: seedSet.has(f) })
}
function layerOf(f) {
  if (f.startsWith('src/lib/modules/doc-editor/')) return f.includes('/adapters/crazyshot/') ? 'doc-editor(참고용 어댑터)' : 'doc-editor(이식형 본체)'
  if (f.startsWith('src/lib/server/')) return 'server'
  if (f.includes('/components/')) return 'ui'
  if (f.startsWith('src/lib/types/')) return 'types'
  return 'core'
}

// reference/ — 원본 그대로(렌탈 도메인 결합)
let refCount = 0
for (const r of REFERENCE) for (const f of walk(r)) { put(`reference/${f}`, fs.readFileSync(abs(f)), { source: f, layer: 'reference(원본 그대로)' }); refCount++ }

// sql/
const migDir = abs('supabase/migrations')
const rentalWords = /rental_reservations|reservations\b|orders\b|user_profiles|is_cms_user|cms_role|public_holidays/i
const sqlRows = []
for (const name of SQL_PICK) {
  const p = path.join(migDir, name)
  if (!fs.existsSync(p)) { sqlRows.push({ name, missing: true }); continue }
  const txt = fs.readFileSync(p, 'utf-8').replace(/vnbpmvxruyciuuaermyh|ezyvffjvuwmtuhpxdjrw/g, '<project-ref>') // 원본 프로젝트 식별자는 주석에서도 지운다
  const hits = [...new Set((txt.match(new RegExp(rentalWords, 'gi')) ?? []).map((s) => s.toLowerCase()))]
  put(`sql/crazyshot-original/${name}`, Buffer.from(txt), { source: `supabase/migrations/${name}`, layer: 'sql(원본)', hostCoupling: hits })
  sqlRows.push({ name, hits })
}
for (const f of walk('src/lib/modules/doc-editor/sql')) put(`sql/doc-editor/${path.posix.basename(f)}`, fs.readFileSync(abs(f)), { source: f, layer: 'sql(이식형·멱등)' })

// tests/ — 이식 검증용(경로를 키트 구조로 치환)
//   ① 명시 시작점(TEST_SEEDS) + ② 자동 선별: 키트 파일만 import 하고(SvelteKit 환경·라이브 DB·원본 라우트 의존 없음) 키트에 실제로 들어간 모듈을 시험하는 테스트 전부
let testCount = 0
const kitSet = new Set(kitFiles)
const testFiles = new Set(TEST_SEEDS.flatMap((s) => walk(s)).filter((f) => /\.test\.ts$/.test(f)))
const autoTests = []
const hostScanTests = []
const LIVE = /process\.env|PUBLIC_SUPABASE|createClient\(|service_role|\$env\/|\$app\//
for (const f of walk('src/__tests__')) {
  if (!/\.test\.ts$/.test(f) || testFiles.has(f)) continue
  const txt = fs.readFileSync(abs(f), 'utf-8')
  if (LIVE.test(txt)) continue
  let locals = 0, ok = true
  for (const m of txt.matchAll(/(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|vi\.mock\(\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1] ?? m[2] ?? m[3]
    const r = resolveImport(f, spec)
    if (r.kind === 'file') { locals++; if (!kitSet.has(r.file)) { ok = false; break } }
    else if (r.kind === 'missing' || r.kind === 'sveltekit') { ok = false; break }
  }
  if (!ok || locals === 0) continue
  // 소스 파일을 직접 읽어 검사하는 테스트(src/... 경로 문자열)는 읽는 파일이 모두 키트 안에 있을 때만 키트 테스트로 둔다 —
  // 호스트(라우트·화면)를 읽는 테스트는 reference/ 로 보낸다(원본 앱에서만 의미가 있다)
  const readsHost = [...txt.matchAll(/['"`](src\/[\w./\[\]+@-]+)['"`]/g)].some((m) => {
    const lit = m[1].replace(/\/$/, '')
    return !(kitSet.has(lit) || [...kitSet].some((k) => k.startsWith(`${lit}/`)))
  })
  const readsRelative = /readFileSync|readdirSync/.test(txt) && !/process\.cwd\(\)/.test(txt) // __dirname 기준 상대경로로 소스를 읽는 테스트 — 경로를 안전하게 옮길 수 없어 reference 로 보낸다
  if (readsHost || readsRelative) { hostScanTests.push(f); continue }
  testFiles.add(f); autoTests.push(f)
}
for (const f of hostScanTests) put(`reference/${f}`, fs.readFileSync(abs(f)), { source: f, layer: 'reference(호스트 소스를 읽는 테스트)' })
for (const f of [...testFiles].sort()) {
  let txt = fs.readFileSync(abs(f), 'utf-8')
  txt = rewriteLib(txt).replace(/(\.\.\/)+lib\//g, `$lib/${NS}/`).replace(/src\/lib\//g, `src/lib/${NS}/`)
  put(`tests/${f.replace(/^src\/__tests__\//, '')}`, Buffer.from(txt), { source: f, layer: autoTests.includes(f) ? 'tests(자동 선별)' : 'tests' }); testCount++
}


// tests/kit-smoke — 키트 전용 통합 확인: 실제 파일 형식(docx·xlsx)을 만들어 "불러오기 → {{변수}} 치환"까지 한 줄로 이어 본다
put('tests/kit-smoke/importAndVariables.mount.test.ts', Buffer.from(`// @vitest-environment jsdom
/**
 * 키트 전용 통합 테스트(원본 저장소에는 없음 · mammoth 는 브라우저 빌드가 필요해 jsdom 컴포넌트 설정으로 실행) — 불러오기 문서 포맷 → 변수 치환이 한 흐름으로 동작하는지 확인한다.
 * 픽스처 파일 없이 docx(JSZip)·xlsx(SheetJS)를 메모리에서 만든다.
 */
import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { importDocx } from '$lib/${NS}/utils/docImport/docxImport'
import { importWorkbookAsSpreadsheetDocument } from '$lib/${NS}/utils/docImport/xlsxToSpreadsheetDocument'
import { substituteHtmlDocument, substituteSpreadsheetDocument } from '$lib/${NS}/utils/contract-substitution'
import { substituteTiptapDoc } from '$lib/${NS}/utils/tiptapRender'

// mammoth 는 브라우저 번들(mammoth.browser.js)이어야 arrayBuffer 입력을 받는다(앱에서는 Vite 가 자동 선택, vitest 는 Node 판을 고르므로 명시)
vi.mock('mammoth', async () => {
  // @ts-ignore — 브라우저 번들은 타입 선언이 없다
  const m = (await import('mammoth/mammoth.browser.js')) as { default?: unknown }
  return { default: m.default ?? m }
})

async function makeDocx(text: string): Promise<File> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:body></w:document>')
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new File([buf], 'contract.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

describe('불러오기 → 변수 치환(통합)', () => {
  it('docx: 본문의 {{고객이름}} 이 가져오기 후에도 유지되고 치환된다', async () => {
    const r = await importDocx(await makeDocx('계약자 {{고객이름}} 님'))
    expect(r.html).toContain('{{고객이름}}')
    const out = substituteHtmlDocument(r.html, { 고객이름: '홍길동' })
    expect(out).toContain('홍길동')
    expect(out).not.toContain('{{고객이름}}')
  })

  it('xlsx: 셀의 {{고객이름}} 이 시트로 들어오고, 치환은 원본 문서를 바꾸지 않는다', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['성명', '{{고객이름}}']]), '계약서')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const doc = await importWorkbookAsSpreadsheetDocument(new File([buf], 'c.xlsx'))
    expect(doc.sheets[0].rows[0]).toContain('{{고객이름}}')
    const out = substituteSpreadsheetDocument(doc, { 고객이름: '홍길동' })
    expect(out.sheets[0].rows[0]).toContain('홍길동')
    expect(doc.sheets[0].rows[0]).toContain('{{고객이름}}')
  })

  it('편집기 문서(tiptap-doc): 변수 칩(mergeField)이 값 글자로 바뀐다', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '계약자 ' }, { type: 'mergeField', attrs: { variable: '고객이름', label: '고객이름' } }] }] }
    const out = JSON.stringify(substituteTiptapDoc(doc as never, { 고객이름: '홍길동' }))
    expect(out).toContain('홍길동')
    expect(out).not.toContain('mergeField')
  })
})
`), { layer: 'tests(키트 전용 통합)' }); testCount++

// e2e/ — 실제 브라우저(Chrome·Safari) 자동 검증. 키트만 있는 프로젝트에서 그대로 실행되도록 상품설명 편집기 부분을 걷어낸 판
{
  const specSrc = fs.readFileSync(abs('e2e/editors.spec.ts'), 'utf-8')
  const iRich = specSrc.indexOf("test.describe('상품설명 편집기(RichContentEditor)'")
  const iDoc = specSrc.indexOf("test.describe('계약서 문서 편집기(DocEditor)'")
  if (iRich > 0 && iDoc > iRich) {
    put('e2e/editors.doc.spec.ts', Buffer.from(`${specSrc.slice(0, iRich)}${specSrc.slice(iDoc)}`), { source: 'e2e/editors.spec.ts', layer: 'e2e(키트용 발췌)' })
  }
  put('e2e/mediaViewer.spec.ts', fs.readFileSync(abs('e2e/mediaViewer.spec.ts')), { source: 'e2e/mediaViewer.spec.ts', layer: 'e2e' })
  let page = fs.readFileSync(abs('src/routes/dev-e2e/editors/+page.svelte'), 'utf-8')
  page = rewriteLib(page)
    .replace(/^\s*import RichContentEditor[^\n]*\n/m, '')
    .replace(/^\s*import type \{ ContentBlock \}[^\n]*\n/m, '')
    .replace(/\n  let blocks = \$state<ContentBlock\[\]>\(\[[\s\S]*?\n  \]\)\n  let keywords = \$state<string\[\]>\(\[\]\)\n/, '\n')
    .replace(/\n  \{:else if which === 'rich'\}\n[^\n]*RichContentEditor[^\n]*\n/, '\n')
  put('e2e/dev-page/+page.svelte', Buffer.from(page), { source: 'src/routes/dev-e2e/editors/+page.svelte', layer: 'e2e(키트용 발췌)' })
  put('e2e/dev-page/+page.ts', fs.readFileSync(abs('src/routes/dev-e2e/editors/+page.ts')), { source: 'src/routes/dev-e2e/editors/+page.ts', layer: 'e2e' })
  const cfg = fs.readFileSync(abs('playwright.config.ts'), 'utf-8').replace(/5173/g, '5199').replace("testDir: 'e2e'", "testDir: 'e2e'")
  put('e2e/playwright.config.ts', Buffer.from(cfg), { source: 'playwright.config.ts', layer: 'e2e' })
}

// host/pdfjs-worker.d.ts — 서버 PDF 쪽별 지도(pdfFingerprint)가 쓰는 ambient 타입 선언(src/ 바로 아래에 둔다)
if (fs.existsSync(abs('src/pdfjs-worker.d.ts'))) put('host/pdfjs-worker.d.ts', fs.readFileSync(abs('src/pdfjs-worker.d.ts')), { source: 'src/pdfjs-worker.d.ts', layer: 'host' })

// deps.json
const pj = JSON.parse(fs.readFileSync(abs('package.json'), 'utf-8'))
const allDeps = { ...pj.dependencies, ...pj.devDependencies }
const ALWAYS_BUILTIN = new Set(['node:crypto', 'node:fs', 'node:path'])
const deps = {}
const unknownBare = []
for (const pkg of [...bareUses.keys()].sort()) {
  if (ALWAYS_BUILTIN.has(pkg) || pkg.startsWith('node:')) continue
  if (allDeps[pkg]) deps[pkg] = allDeps[pkg]
  else unknownBare.push(pkg)
}
// 문서 안 예시 문자열 등 가짜 패키지명 제거
const FAKE = new Set(['some-package', 'prosemirror-state', 'jsuites'])
for (const p of unknownBare.filter((x) => !FAKE.has(x))) deps[p] = '(원본 package.json 에 없음 — 확인 필요)'
// 간접 필요(jspreadsheet 가 jsuites 를 요구) — 원본 설치 버전 기록
if (!deps.jsuites && fs.existsSync(abs('node_modules/jsuites/package.json'))) deps.jsuites = JSON.parse(fs.readFileSync(abs('node_modules/jsuites/package.json'), 'utf-8')).version + ' (jspreadsheet-ce 가 함께 설치)'
const serverOnly = ['@sparticuz/chromium', 'puppeteer-core']
const optional = ['@supabase/supabase-js', 'svelte-sonner', ...serverOnly]
put('deps.json', Buffer.from(JSON.stringify({ requires: { svelte: pj.devDependencies?.svelte ?? pj.dependencies?.svelte, '@sveltejs/kit': pj.devDependencies?.['@sveltejs/kit'] ?? pj.dependencies?.['@sveltejs/kit'] }, dependencies: deps, optionalGroups: { 'Supabase 어댑터': ['@supabase/supabase-js'], '알림(toast 어댑터)': ['svelte-sonner'], '서버 PDF 보관(contractArchive)': serverOnly } }, null, 2) + '\n'), { layer: 'meta' })

// host/tokens.css — 키트 화면이 쓰는 CSS 변수와 원본 값
const cssText = fs.readFileSync(abs('src/app.css'), 'utf-8')
const used = new Set()
for (const m of manifest.files) {
  if (!/\.(svelte|css)$/.test(m.path) || !m.path.startsWith('lib/')) continue
  const txt = fs.readFileSync(path.join(OUT, m.path), 'utf-8')
  for (const v of txt.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) used.add(v[1])
}
const defs = new Map()
for (const m of cssText.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/gm)) if (!defs.has(m[1])) defs.set(m[1], m[2].trim())
const found = [...used].filter((v) => defs.has(v)).sort()
// --de-*(편집기)·--cde-*(내부 계산값)는 모듈이 호스트 연결용으로 따로 받는다 — adapters/crazyshot/host-tokens.css 가 기본 매핑 예시
const moduleOwned = (v) => v.startsWith('--de-') || v.startsWith('--cde-')
const undef = [...used].filter((v) => !defs.has(v) && !moduleOwned(v)).sort()
const hostTokensPath = 'src/lib/modules/doc-editor/adapters/crazyshot/host-tokens.css'
const hostTokens = fs.existsSync(abs(hostTokensPath)) ? fs.readFileSync(abs(hostTokensPath), 'utf-8') : ''
put('host/tokens.css', Buffer.from(`/* 전자계약 키트 화면이 참조하는 CSS 변수(원본 src/app.css 값). 호스트 전역 CSS 에 붙이거나 자기 디자인 값으로 바꾼다.\n   ${undef.length ? `정의를 못 찾은 변수(호스트가 직접 정의): ${undef.join(', ')}` : '누락 변수 없음'}\n   편집기 전용 --de-* 변수는 아래 2부(원본 host-tokens.css)처럼 호스트 토큰에 연결한다. */\n/* 1부 — 키트 화면(--cs-*, --cms-*, --radius-* ...) */\n:root {\n${found.map((v) => `  ${v}: ${defs.get(v)};`).join('\n')}\n}\n\n/* 2부 — doc-editor 호스트 연결(원본 adapters/crazyshot/host-tokens.css) */\n${hostTokens}\n`), { layer: 'host' })

// HOST_TODO — 호스트가 손대야 하는 곳 자동 탐지
const coupling = []
for (const m of manifest.files) {
  if (!m.path.startsWith('lib/') || !TEXT_EXT.test(m.path)) continue
  const txt = fs.readFileSync(path.join(OUT, m.path), 'utf-8')
  const tags = []
  if (/\$app\/|\$env\//.test(txt)) tags.push('SvelteKit($app/$env)')
  if (/crazyshot|크레이지샷/i.test(txt) && !/\.md$/.test(m.path)) tags.push('상호·도메인 문자열')
  if (/supabase/i.test(txt) && !m.path.includes('adapters/supabase') && !m.path.includes('doc-editor/sql')) tags.push('Supabase 직접 참조')
  if (/csToast|\$lib\/contract-kit\/utils\/toast/.test(txt)) tags.push('toast 헬퍼')
  if (/\/api\//.test(txt) && !m.path.includes('adapters/crazyshot') && /fetch\(/.test(txt)) tags.push('/api/ 호출')
  if (tags.length) coupling.push({ path: m.path, tags })
}

// 최근 변경 요약(이전 버전 대비 — 받는 쪽 AI 가 README 한 곳에서 파악) — 원본은 scripts/contract-kit-CHANGELOG.md
const changelogPath = path.join(REPO, 'scripts/contract-kit-CHANGELOG.md')
const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf-8').trim() : ''

const readme = `# crazyshot-contract-kit v${KIT_VERSION}

크레이지샷(SvelteKit 5 + Supabase)에서 만든 **전자계약 모듈**을 다른 프로젝트로 옮기기 위한 패키지입니다.
생성: ${new Date().toISOString().slice(0, 10)} · 생성기: \`scripts/package-contract-kit.mjs\`(원본 저장소에서 다시 만들 수 있음)

${changelog ? `${changelog}\n\n` : ''}## 한눈에 보기
| 층 | 위치 | 이식 난이도 |
|---|---|---|
| **A. 문서 & 양식 통합 편집기 (doc-editor)** | \`lib/modules/doc-editor/{core,ui,examples,adapters/supabase,sql}\` | ★ 쉬움 — 호스트 import 0건(자동 테스트 보증). 폴더째 복사 |
| **B. 계약 핵심 로직 (치환·타입·서명 증적·양식 모드)** | \`lib/utils\` \`lib/types\` \`lib/contract-signature\` | ★★ 보통 — 변수 카탈로그(고객·상품 등)만 자기 도메인으로 교체 |
| **C. 양식 편집 화면 (캔버스·스프레드시트·가져오기)** | \`lib/components/cms/contract-editor\` \`lib/components/common\` | ★★ 보통 — SvelteKit 필요, CSS 토큰(\`host/tokens.css\`)·toast 필요 |
| **D. 서버 PDF 보관·서명 봉인(Ed25519)·진위 확인** | \`lib/server/contractArchive\` | ★★★ 어려움 — Node 서버, headless Chromium, 환경변수, DB 3개 테이블 |
| **E. 원본 참고용(렌탈 도메인 결합)** | \`reference/\` | 그대로 쓰지 않음 — 자동발행·예약승인·서명 API·고객 서명 화면의 실제 구현 예시 |

\`lib/\`는 **\`src/lib/${NS}/\`** 에 그대로 넣으면 됩니다(내부 \`$lib/\` import 는 \`$lib/${NS}/\` 로 이미 바꿔 둠).

## 폴더
\`\`\`
lib/        본체(${kitFiles.length}개 파일) → src/lib/${NS}/
sql/        doc-editor(이식형·멱등) + crazyshot-original(계약 테이블 마이그레이션 ${SQL_PICK.length}건, 번호순)
host/       tokens.css(키트 화면이 쓰는 CSS 변수 ${found.length}개)
reference/  원본 그대로 ${refCount}개 파일(렌탈 도메인 결합 — 참고용)
tests/      이식 검증 테스트 ${testCount}개(자동 선별 ${autoTests.length}개 포함) → src/__tests__/${NS}/\ne2e/        실제 브라우저(Chrome·Safari) 자동 검증 — 공통 이미지 뷰어·이미지 편집 도구·계약서 편집기 이미지 조작
deps.json   필요한 npm 패키지와 버전
VERIFY.md   빈 SvelteKit 프로젝트에서의 단독 동작 검증 결과(\`scripts/verify-contract-kit.mjs\`)
REVIEW.md   최종 코드 리뷰(정책 정합·보안·이식 시 결합 지점)
HOST_TODO.md  호스트가 바꿔야 할 곳(자동 탐지)
INSTALL.md    설치 순서
MANIFEST.json 모든 파일의 출처·sha256
\`\`\`

## 저장 포맷(호환 보장)
문서형 양식 본문 = \`[{type:'tiptap-doc', doc}]\` (TipTap JSON). 변수는 \`{{변수명}}\` 칩. 캔버스형·스프레드시트형·HTML형은 각자 JSON/HTML 컬럼에 저장(contract-document.ts 타입).

## 이 패키지가 약속하는 것 / 약속하지 않는 것
- 약속: A층은 호스트 의존 없이 동작하고 자동 테스트로 지킨다. B~D층은 SvelteKit 호스트에서 \`INSTALL.md\` 순서대로 하면 빌드된다.
- 약속하지 않음: 렌탈 도메인(예약·결제·채팅·역할) 연동은 포함하지 않는다 — \`reference/\` 를 보고 자기 도메인에 맞게 새로 구현한다.
`

const install = `# INSTALL — 설치 순서

> 이미 이전 버전을 쓰는 프로젝트의 업그레이드라면 \`README.md\` 의 **"최근 변경"** 절과 그 안의 "호스트가 할 일"만 따르면 된다(아래는 처음 설치하는 순서).

## 0. 전제
- SvelteKit 2 + Svelte 5(runes). \`$lib\`·\`$app\`·\`$env\` 별칭이 있는 프로젝트.
- Node 20+. (D층 PDF 보관은 서버리스/Node 서버 + headless Chromium 필요)

## 1. 파일 복사
\`\`\`bash
# <KIT> = 이 폴더, <HOST> = 받는 프로젝트
cp -R <KIT>/lib/.            <HOST>/src/lib/${NS}/
cp -R <KIT>/tests/.          <HOST>/src/__tests__/${NS}/      # 선택(이식 검증)
cp <KIT>/host/pdfjs-worker.d.ts <HOST>/src/pdfjs-worker.d.ts      # D층(서버 PDF 보관)을 쓸 때만
\`\`\`

## 2. npm 패키지
\`deps.json\` 의 \`dependencies\` 를 설치한다(버전은 원본 검증 버전).
- 편집기(A·C층)만 쓸 때: \`@tiptap/*\` \`svelte-tiptap\` 필수. 문서 가져오기(docx/xlsx/hwp)는 \`mammoth\` \`xlsx\` \`jszip\` \`hwp-convert\` \`pdfjs-dist\`, 스프레드시트 편집은 \`jspreadsheet-ce\`.
- Supabase 어댑터를 쓸 때만 \`@supabase/supabase-js\`.
- D층(서버 PDF 보관)만 \`@sparticuz/chromium\` \`puppeteer-core\`.

## 3. CSS 토큰
\`host/tokens.css\` 를 전역 CSS 에 붙이거나, 같은 이름의 변수를 자기 디자인 값으로 정의한다. 폰트는 Noto Sans KR 을 권장.

## 4. DB(Supabase 사용 시)
1. **편집기만**: \`sql/doc-editor/001_doc_editor.sql\` 1회 실행(멱등). 되돌리기: \`001_doc_editor.rollback.sql\`.
2. **전체 계약 흐름**: \`sql/crazyshot-original/\` 를 번호순으로 적용하되, \`MANIFEST.json\` 의 \`hostCoupling\` 이 비어 있지 않은 파일은 렌탈 테이블(예: \`rental_reservations\`, \`user_profiles\`)을 참조하니 **자기 테이블 이름으로 바꿔서** 적용한다. RLS 정책·권한(서버 전용 함수 \`REVOKE ... GRANT service_role\`)은 그대로 유지한다.

## 5. 호스트가 구현할 연결부 — \`HOST_TODO.md\` 참고
핵심: ① 변수 카탈로그(고객·상품 → 치환 데이터) ② 저장소(Supabase 어댑터 주입 또는 자체) ③ toast ④ 서명 링크·발송 API(\`reference/routes\` 참고) ⑤ (D층) 환경변수 \`ARCHIVE_SEAL_KEY\` \`ARCHIVE_SEAL_PUBLIC_KEYS\` \`CRON_SECRET\` \`CONTRACT_ARCHIVE_ENABLED\`.

## 6. 동작 확인
\`\`\`bash
npx vitest run src/__tests__/${NS}              # 서버·유틸·모듈 테스트
npm run test:component -- src/__tests__/${NS}   # (원본 vitest.component.config 와 같은 jsdom 설정 필요)
\`\`\`
테스트 중 \`coreEquivalence\` · \`contractCatalog\` 는 원본 크레이지샷 구현과의 동일성을 확인하는 **원본 전용** 검사라 이식 후에는 실패하거나 제외해도 됩니다.

## 6-1. 실제 브라우저 검증(Chrome·Safari) — 공통 이미지 뷰어·이미지 편집 도구·계약서 편집기
\`\`\`bash
npm i -D @playwright/test && npx playwright install chromium webkit
mkdir -p src/routes/dev-e2e/editors e2e
cp <KIT>/e2e/dev-page/+page.svelte <KIT>/e2e/dev-page/+page.ts  <HOST>/src/routes/dev-e2e/editors/   # dev 서버에서만 열리는 검증 전용 화면
cp <KIT>/e2e/*.spec.ts <HOST>/e2e/ && cp <KIT>/e2e/playwright.config.ts <HOST>/playwright.config.ts   # 포트 5199
npx playwright test
\`\`\`
- 검증 범위: 공통 뷰어 도구줄(썸네일·축소·확대·맞춤·회전·편집·내려받기·삭제·읽기 전용·PDF/영상), 계약서 편집기 이미지 선택→모서리 점 끌기→점 표시 토글→더블클릭 뷰어 편집 저장.
- docx 가져오기 테스트(\`tests/kit-smoke\`)는 mammoth 브라우저 번들이 필요해 jsdom 컴포넌트 설정으로 실행한다(파일 안에 \`vi.mock('mammoth')\` 로 명시).

## 7. 최소 사용 예
\`lib/modules/doc-editor/examples/MinimalHost.svelte\` — 호스트 import 없이 편집기를 띄우는 가장 작은 예.
`

put('README.md', Buffer.from(readme), { layer: 'docs' })
put('INSTALL.md', Buffer.from(install), { layer: 'docs' })
put('HOST_TODO.md', Buffer.from(`# HOST_TODO — 호스트 앱이 채우거나 바꿔야 할 곳

> 자동 탐지 결과(키트 파일 중 호스트와 맞닿은 곳). 이 목록 밖의 파일은 그대로 두면 됩니다.

## 1. 반드시 확인할 외부 요소
${[
  '- **SvelteKit 모듈**: `$app/environment`, `$env/dynamic/public|private` 를 쓰는 파일(아래 표) — SvelteKit 이 아니면 얇은 대체 모듈이 필요',
  '- **toast 헬퍼**: `lib/utils/toast.ts` 는 크레이지샷 표준 토스트(svelte-sonner + CSS 토큰). 자기 토스트로 교체하거나 `<Toaster />` 를 등록',
  '- **Supabase**: `lib/env/supabasePublic.ts` 는 `PUBLIC_SUPABASE_URL/ANON_KEY`(또는 `VITE_` 대체) 환경변수를 읽음. 편집기 저장소는 `adapters/supabase` 에 클라이언트를 **주입**',
  '- **상호·도메인 문자열**: `lib/server/contractArchive/archiveNow.ts` 등에 크레이지샷 도메인/Vercel 환경변수가 하드코딩된 곳 — 자기 도메인으로 교체',
].join('\n')}

## 2. 자동 탐지 표
| 파일 | 맞닿은 곳 |
|---|---|
${coupling.map((c) => `| \`${c.path}\` | ${c.tags.join(', ')} |`).join('\n')}

## 3. 도메인 교체 지점(렌탈 → 자기 업무)
- \`lib/modules/doc-editor/adapters/crazyshot/contractCatalog.ts\` — 변수 칩 목록(고객·상품·결제·일정 …). 자기 데이터 필드로 교체
- \`lib/utils/contract-substitution.ts\` / \`lib/types/contract-module.ts\` — 변수 → 실제 값 치환 데이터 구조(\`ContractSubstitutionData\`)
- \`lib/utils/contractLineItems.ts\` — 상품 목록 표(렌탈 상품·옵션·결합상품 기준)
- \`lib/components/cms/contract-editor/templates/defaultRentalContractHtml.ts\` — 기본 HTML 계약서 서식(렌탈 약관)

## 4. 환경변수(D층)
- \`ARCHIVE_SEAL_KEY\`(Ed25519 비밀키), \`ARCHIVE_SEAL_PUBLIC_KEYS\`(이전 공개키 JSON 배열), \`CRON_SECRET\`, \`CONTRACT_ARCHIVE_ENABLED\`
- 키 생성: 원본 \`scripts/generate-seal-key.mjs\`(비밀키는 저장소·로그·문서에 기록 금지)

## 5. 누락 의존성
${missing.length ? missing.map(([f, s]) => `- \`${f}\` → \`${s}\``).join('\n') : '- 없음(모든 상대 import 가 패키지 안에서 해결됨)'}
${unknownBare.filter((x) => !FAKE.has(x)).length ? `\n원본 package.json 에 없는 외부 패키지: ${unknownBare.filter((x) => !FAKE.has(x)).join(', ')}` : ''}
`), { layer: 'docs' })

for (const [src, dest] of DOCS) if (fs.existsSync(abs(src))) put(dest, fs.readFileSync(abs(src)), { source: src, layer: 'docs' })
if (fs.existsSync(path.join(REPO, 'scripts/contract-kit-REVIEW.md'))) put('REVIEW.md', fs.readFileSync(path.join(REPO, 'scripts/contract-kit-REVIEW.md')), { source: 'scripts/contract-kit-REVIEW.md', layer: 'docs' })

manifest.sourceDirtyFiles = manifest.files.filter((f) => f.source && dirty.has(f.source)).map((f) => f.source).sort()
manifest.summary = { kitFiles: kitFiles.length, referenceFiles: refCount, tests: testCount, sql: SQL_PICK.length, cssTokens: found.length, undefinedCssTokens: undef, sveltekitUses: [...new Set(sveltekitUses.map(([f, s]) => `${f} ${s}`))].length }
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ out: OUT, ...manifest.summary, missingImports: missing.length, unknownBare }, null, 2))
