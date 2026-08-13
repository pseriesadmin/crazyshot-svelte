# contract-suite-integration.md
# 크레이지샷 전자계약 서식 작성 에디터 — 통합 기술문서
# Phase 0~9 (2026-08-12 완료) | Harness Flow v3.2

---

## 문서 목적

이 문서는 크레이지샷 전자계약 에디터 모듈(Phase 0~9)을 다른 SvelteKit 5 프로젝트에 이식하거나,
기존 구현을 유지보수할 때 필요한 모든 기술 정보를 담는다.

> **경로 주의**: 원 설계 플랜은 `src/lib/contract-editor/`를 가정했으나, Svelte 컴포넌트 관례에 따라
> 실제 구현 경로는 `src/lib/components/cms/contract-editor/`이다. 이 문서는 실제 구현 경로 기준이다.

---

## 1. 모듈 파일 구조

```
src/lib/
├── components/cms/contract-editor/     ← TipTap 흐름형 + Canvas 에디터 컴포넌트
│   ├── ContractDocumentEditor.svelte   # 흐름형(flow) 에디터 — TipTap 기반
│   ├── ContractCanvasEditor.svelte     # 캔버스(canvas) 에디터 — 고정배경+좌표필드
│   ├── ContractCanvasFieldPalette.svelte # 캔버스 필드 팔레트(우측 사이드바)
│   ├── ContractFieldPanel.svelte       # 변수 칩 삽입 + 특약 관리 패널
│   ├── ContractImportModal.svelte      # docx/xlsx/hwpx 임포트 모달
│   ├── extensions/                     # (현재 비어 있음 — 향후 TipTap 커스텀 확장 예정)
│   └── nodes/
│       └── MergeFieldNode.ts           # 변수 칩 인라인 atom 노드 (ProseMirror)
│
├── contract-signature/                 ← 서명·감사로그·해시 유틸
│   ├── SealAssetPicker.svelte          # 발행자 서명/직인 선택 UI
│   ├── auditLog.ts                     # contract_audit_log 기록 헬퍼
│   ├── contentHash.ts                  # SHA-256 콘텐츠 해시 (Web Crypto API)
│   └── issuerSignatureCheck.ts         # 발행자 서명 필수 여부 검증
│
├── utils/docImport/                    ← 외부 문서 임포트 파서
│   ├── docxImport.ts                   # .docx → HTML (mammoth)
│   ├── xlsxImport.ts                   # .xlsx → TipTap table JSON (SheetJS)
│   └── hwpxImport.ts                   # .hwpx → HTML (실험적, 사용자 동의 필요)
│
├── types/
│   └── contract-document.ts            # 계약 전용 타입 (TiptapDocBlock, CanvasDocument 등)
│
└── utils/
    ├── contract-apply-template.ts      # 계약서 템플릿 적용 헬퍼
    └── contract-substitution.ts        # {{변수명}} 치환 (레거시 ContentBlock용)

src/routes/
├── api/cms/
│   ├── contract-templates/+server.ts   # GET/POST/PATCH/DELETE — 양식 CRUD
│   ├── contracts/[id]/
│   │   ├── content/+server.ts          # GET/PATCH — 계약서 내용 편집
│   │   ├── send-chat/+server.ts        # POST — 서명 링크 채팅 발송
│   │   └── issuer-sign/+server.ts      # POST — 발행자 서명 등록
│   ├── reservations/[id]/
│   │   ├── init-contract/+server.ts    # POST — 예약에 계약서 생성(idempotent)
│   │   └── contract-data/+server.ts    # GET — 변수 치환 데이터 조회
│   └── signature-assets/+server.ts     # GET — 관리자 서명/직인 자산 목록
│
├── api/contracts/[token]/
│   └── sign/+server.ts                 # POST — 고객 서명 제출
│
├── cms/
│   ├── reservation/contracts/          # 계약서 양식 관리 CMS 화면
│   │   ├── +page.server.ts
│   │   └── +page.svelte
│   └── set/signature/                  # 발행자 서명/직인 자산 관리
│       ├── +page.server.ts
│       └── +page.svelte
│
└── contract/[token]/                   # 고객용 서명 페이지 (딥링크)
    ├── +page.server.ts
    └── +page.svelte
```

---

## 2. DB 테이블 전체 DDL

> 아래는 여러 마이그레이션에 걸쳐 누적 적용된 최종 스키마다. 이식 시 이 순서대로 적용한다.

### 2-1. `contracts` 테이블 (Migration 21 + 149 + 217 + 225)

```sql
-- 기본 테이블 (Migration 21)
CREATE TABLE IF NOT EXISTS contracts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID        REFERENCES orders(id) ON DELETE RESTRICT,     -- v1 레거시 컬럼
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  contract_type       VARCHAR(20) NOT NULL CHECK(contract_type IN ('rental', 'subscription')),
  status              contract_status_enum NOT NULL DEFAULT 'active',
  document_url        TEXT        NOT NULL DEFAULT '',                           -- v1 레거시 컬럼
  signed_at           TIMESTAMPTZ,
  terms_accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- Migration 149: 에디터 콘텐츠 컬럼 추가
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS template_id    UUID REFERENCES contract_templates(id),
  ADD COLUMN IF NOT EXISTS title          TEXT,
  ADD COLUMN IF NOT EXISTS content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reservation_id BIGINT REFERENCES rental_reservations(id);

-- Migration 217: 서명 시점 콘텐츠 해시
-- (contract_signings.content_hash — 아래 contract_signings 참고)

-- Migration 225: canvas 모드 컬럼
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS authoring_mode contract_authoring_mode NOT NULL DEFAULT 'flow',
  ADD COLUMN IF NOT EXISTS canvas_document JSONB;

-- 인덱스
CREATE INDEX idx_contracts_user_id ON contracts(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_authoring_mode ON contracts(authoring_mode);

-- RLS
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts: 본인 조회" ON contracts
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY "contracts: 관리자 전체" ON contracts
  FOR ALL USING (is_cms_user());
```

### 2-2. `contract_templates` 테이블 (Migration 148 + 219 + 225)

```sql
-- 기본 테이블 (Migration 148)
CREATE TABLE IF NOT EXISTS contract_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  content_blocks  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  specifications  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'archived')),
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Migration 219: 발행자 서명 필수 플래그
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS requires_issuer_signature BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration 225: canvas 모드 컬럼
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS authoring_mode contract_authoring_mode NOT NULL DEFAULT 'flow',
  ADD COLUMN IF NOT EXISTS canvas_document JSONB;

-- ENUM 타입 (Migration 225)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_authoring_mode') THEN
    CREATE TYPE contract_authoring_mode AS ENUM ('flow', 'canvas');
  END IF;
END$$;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_contract_templates_status
  ON contract_templates(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_templates_authoring_mode
  ON contract_templates(authoring_mode);

-- RLS: service_role만 접근 (고객 직접 접근 불가)
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_only" ON contract_templates
  USING (auth.jwt() ->> 'role' = 'service_role');
```

### 2-3. `contract_signings` 테이블 (Migration 140 + 145 + 146 + 217)

```sql
-- 기본 테이블 (Migration 140)
CREATE TABLE IF NOT EXISTS contract_signings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  token       VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  sent_at     TIMESTAMPTZ,
  viewed_at   TIMESTAMPTZ,
  signed_at   TIMESTAMPTZ,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration 145: 전자서명 데이터
ALTER TABLE contract_signings
  ADD COLUMN IF NOT EXISTS signature_data TEXT,    -- base64 PNG (SignatureCanvas 캔버스 데이터)
  ADD COLUMN IF NOT EXISTS stroke_count   INTEGER;

-- Migration 146: 서명 링크 만료일
ALTER TABLE contract_signings
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days');

-- Migration 217: 서명 시점 콘텐츠 해시
ALTER TABLE contract_signings
  ADD COLUMN IF NOT EXISTS content_hash TEXT;
  -- SHA-256 hex(64자). NULL이면 Phase 8-A 이전 서명.

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_contract_signings_contract_id ON contract_signings(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signings_token       ON contract_signings(token);
CREATE INDEX IF NOT EXISTS idx_contract_signings_user_id     ON contract_signings(user_id);
CREATE INDEX IF NOT EXISTS idx_contract_signings_expires_at
  ON contract_signings(expires_at) WHERE signed_at IS NULL;

-- RLS
ALTER TABLE contract_signings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract_signings: 관리자 전체" ON contract_signings
  FOR ALL USING (is_cms_admin());
CREATE POLICY "contract_signings: 본인 조회" ON contract_signings
  FOR SELECT USING (auth.uid() = user_id);
```

### 2-4. `contract_issuer_signatures` 테이블 (Migration 219)

```sql
-- 개별 계약에 날인된 발행자(관리자) 서명 기록 (append-only)
CREATE TABLE IF NOT EXISTS contract_issuer_signatures (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  admin_id            UUID        NOT NULL REFERENCES auth.users(id),
  signature_type      TEXT        NOT NULL
                        CHECK (signature_type IN ('personal_signature', 'company_seal')),
  signature_image_url TEXT,       -- 저장된 이미지 URL (자산 선택 시)
  signature_data      TEXT,       -- base64 PNG (직접 서명 시). 자산 선택 시 NULL
  asset_id            UUID        REFERENCES cms_signature_assets(id),
  content_hash        TEXT,       -- 날인 시점 계약서 콘텐츠 SHA-256
  signed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address          TEXT
);

CREATE INDEX IF NOT EXISTS idx_contract_issuer_signatures_contract
  ON contract_issuer_signatures(contract_id, signed_at DESC);

ALTER TABLE contract_issuer_signatures ENABLE ROW LEVEL SECURITY;
-- service_role만 접근 (정책 없음 = 모두 차단, 서버사이드만 허용)
```

### 2-5. `cms_signature_assets` 테이블 (Migration 219)

```sql
-- 관리자가 사전 등록해두는 서명/직인 이미지 자산
CREATE TABLE IF NOT EXISTS cms_signature_assets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_type  TEXT        NOT NULL CHECK (asset_type IN ('signature', 'seal')),
  image_url   TEXT        NOT NULL,   -- Supabase Storage URL
  label       TEXT,                   -- 관리자 구분용 이름 (예: "대표이사 서명")
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ             -- 소프트삭제 (기존 계약 참조 보존)
);

CREATE INDEX IF NOT EXISTS idx_cms_signature_assets_admin
  ON cms_signature_assets(admin_id, asset_type, deleted_at);

ALTER TABLE cms_signature_assets ENABLE ROW LEVEL SECURITY;
-- service_role만 접근 (정책 없음 = 모두 차단)
```

### 2-6. `contract_audit_log` 테이블 (Migration 218)

```sql
-- append-only 전자계약 감사로그 (UPDATE/DELETE 금지)
CREATE TABLE IF NOT EXISTS contract_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL
                CHECK (event_type IN ('viewed', 'signed', 'sent', 'issuer_signed')),
  actor_type  TEXT        NOT NULL
                CHECK (actor_type IN ('customer', 'admin', 'system')),
  actor_id    TEXT,       -- user_id 또는 admin_id. system 이벤트는 NULL
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_audit_log_contract_id
  ON contract_audit_log(contract_id, created_at DESC);

ALTER TABLE contract_audit_log ENABLE ROW LEVEL SECURITY;
-- service_role만 접근 (분쟁 증빙 자료 — 고객·파트너 직접 조회 금지)
```

---

## 3. API 계약 (요청/응답 shape)

> 모든 CMS API는 `service_role` 키(서버사이드)로 Supabase에 접근. 
> CMS 엔드포인트는 manager 이상(`hasSettingsAccess`) 권한 게이트.
> 고객 서명 엔드포인트는 세션 불필요(token 기반).

### 3-1. `GET /api/cms/reservations/[id]/contract-data`

예약 기반 변수 치환 데이터를 반환한다. `ContractDocumentEditor`에서 변수 칩 미리보기 또는
계약서 발행 시 서버사이드 치환에 사용.

```
Request: 없음 (param: 예약 ID)
Response: ContractSubstitutionData
  {
    "고객이름": "홍길동",
    "연락처": "010-1234-5678",
    "이메일": "user@example.com",
    "주소": "서울시 ...",
    "예약코드": "CSR-2608001",
    "상품코드": "CSLENCOM260800001",
    "상품명": "소니 FX3 풀프레임 시네마라인",
    "수량": "1",
    "수령형태": "크레이지샷 배송",
    "수령일시": "2026-08-15 10:00",
    "반납형태": "크레이지샷 배송",
    "반납일시": "2026-08-17 18:00",
    "기본대여요금": "150,000원",
    "할인금액": "0원",
    "부가세": "15,000원",
    "최종합계": "165,000원"
  }
Error: { "error": "string" } / 403 | 404 | 500
```

### 3-2. `POST /api/cms/reservations/[id]/init-contract`

예약에 연결된 계약서를 생성한다(idempotent — 이미 존재하면 기존 ID 반환).

```
Request: 없음 (param: 예약 ID)
Response: { "contractId": "uuid" }
Error: { "error": "string" } / 403 | 404 | 500
```

### 3-3. `GET /api/cms/contracts/[id]/content`

계약서 본문(title, content_blocks, specifications)을 반환.

```
Request: 없음 (param: contract ID)
Response:
  {
    "title": "string | null",
    "content_blocks": [...],   -- TiptapDocBlock[] 또는 레거시 ContentBlock[]
    "specifications": [{ "key": "string", "value": "string" }]
  }
Error: { "error": "string" } / 403 | 404 | 500
```

### 3-4. `PATCH /api/cms/contracts/[id]/content`

계약서 본문을 저장. `ContractDocumentEditor.onSave` 콜백이 이 엔드포인트를 호출한다.

```
Request body:
  {
    "title"?:          "string",
    "content_blocks"?: TiptapDocBlock[],  -- authoring_mode='flow' 시
    "canvas_document"?: CanvasDocument,   -- authoring_mode='canvas' 시 (별도 처리)
    "specifications"?: [{ "key": "string", "value": "string" }],
    "template_id"?:    "uuid | null"
  }
Response: { "ok": true }
Error: { "error": "string" } / 400 | 403 | 500
```

### 3-5. `POST /api/cms/contracts/[id]/send-chat`

계약서 서명 링크를 고객 채팅 세션으로 발송.

```
Request: 없음 (param: contract ID)
Response: { "token": "hex64string", "signingUrl": "https://..." }
Error: { "error": "string" } / 403 | 404 | 422(발행자 서명 미등록) | 500

422 body: { "error": "이 계약서 양식은 발행자 서명이 필수입니다. ..." }
```

### 3-6. `POST /api/cms/contracts/[id]/issuer-sign`

발행자(관리자) 서명/직인을 계약에 등록.

```
Request body:
  {
    "signature_type": "personal_signature" | "company_seal",
    "asset_id"?:       "uuid",         -- cms_signature_assets.id (자산 선택 시)
    "signature_data"?: "base64string"  -- 직접 서명 PNG (직접 서명 시)
  }
  -- asset_id 또는 signature_data 중 하나는 필수
Response: { "ok": true }
Error: { "error": "string" } / 400 | 403 | 500
```

### 3-7. `GET /api/cms/signature-assets`

현재 관리자의 서명/직인 자산 목록 (인증 세션 기반).

```
Request: 없음
Response: SignatureAsset[]
  [{ "id": "uuid", "asset_type": "signature"|"seal", "image_url": "...", 
     "label": "string|null", "is_default": boolean }]
Error: [] (401 시 빈 배열)
```

### 3-8. `POST /api/contracts/[token]/sign`

고객이 서명 페이지에서 서명을 제출. 세션 불필요(token 기반).

```
Request body:
  {
    "signature_data"?: "base64 PNG string",
    "stroke_count"?:   number
  }
Response: { "ok": true }
Error: { "error": "string" }
  - 404: 유효하지 않은 토큰
  - 409: 이미 서명된 계약서
  - 410: 서명 링크 만료 (expires_at 초과)
  - 400: stroke_count < 1 (서명 없음)
```

### 3-9. `GET|POST|PATCH|DELETE /api/cms/contract-templates`

양식(템플릿) CRUD. manager 이상 게이트.

```
GET: 활성 양식 목록 반환
POST body: { "title": "string", "content_blocks"?: [...], "authoring_mode"?: "flow"|"canvas", 
             "canvas_document"?: CanvasDocument, "specifications"?: [...] }
PATCH body: GET 응답 필드 일부
DELETE: soft-delete (deleted_at 설정)
```

---

## 4. 컴포넌트 Props / 콜백 인터페이스

### 4-1. `ContractDocumentEditor.svelte` (흐름형 에디터)

```typescript
interface Props {
  /** 초기 문서 콘텐츠 (TiptapDocBlock — content_blocks[0]) */
  initialContent?: TiptapDocBlock | null
  /** 레거시 HTML 폴백 (initialContent가 null일 때) */
  initialHtml?: string
  /** 계약서 제목 */
  title?: string
  /** 특약 조항 */
  specifications?: { key: string; value: string }[]
  /** 적용된 템플릿 ID */
  templateId?: string | null
  /**
   * 저장 콜백 — Supabase 직접 호출 없이 호출부(route/page)에서 구현.
   * payload를 받아 PATCH /api/cms/contracts/[id]/content 등을 호출한다.
   */
  onSave?: (payload: ContractDocumentPayload) => Promise<void>
  /** 편집 비활성화 (서명 완료 후 열람 전용 모드) */
  readonly?: boolean
}
```

공개 메서드 (bind:this로 접근):
```typescript
insertMergeField(attrs: MergeFieldAttrs): void  // 변수 칩 삽입
setEditorContent(content: string | JSONContent): void  // 전체 문서 교체 (docx 임포트)
insertEditorContent(content: JSONContent): void  // 커서 위치에 삽입 (xlsx 테이블)
getEditorJSON(): JSONContent | null  // 현재 에디터 JSON 반환
```

### 4-2. `ContractCanvasEditor.svelte` (캔버스 에디터)

```typescript
interface Props {
  /** 초기 캔버스 문서 */
  initialDoc?: CanvasDocument | null
  title?: string
  specifications?: { key: string; value: string }[]
  /**
   * 배경 이미지 업로드 콜백.
   * Blob을 받아 영구 URL을 반환 (Supabase Storage 또는 Cloudinary).
   * 미제공 시 Data URL 폴백 사용 (개발 환경용).
   */
  onUploadPage?: (blob: Blob, fileName: string) => Promise<string>
  /** 저장 콜백 */
  onSave?: (payload: ContractCanvasPayload) => Promise<void>
  readonly?: boolean
}
```

### 4-3. `ContractFieldPanel.svelte` (변수 칩 + 특약 패널)

```typescript
interface Props {
  /** ContractDocumentEditor.insertMergeField 연결 */
  onInsertField: (attrs: MergeFieldAttrs) => void
  specifications: { key: string; value: string }[]
  onSpecsChange: (specs: { key: string; value: string }[]) => void
}
```

### 4-4. `ContractImportModal.svelte` (문서 임포트)

```typescript
interface Props {
  onclose: () => void
  onImport: (result:
    | { type: 'html'; html: string }      // docx/hwpx → HTML
    | { type: 'json'; content: JSONContent }  // xlsx → TipTap 테이블
  ) => void
}
```

### 4-5. `SealAssetPicker.svelte` (발행자 서명/직인 선택)

```typescript
interface Props {
  contractId: string
  signatureType: 'personal_signature' | 'company_seal'
  oncancel: () => void
  oncomplete: (result: { asset_id?: string; signature_data?: string }) => void
}
// 내부에서 GET /api/cms/signature-assets 를 fetch로 직접 호출
```

### 4-6. `auditLog.ts`

```typescript
// service_role 클라이언트를 인자로 받아 직접 DB 기록
async function recordAuditLog(
  admin: MinimalAdminClient,  // SupabaseClient 호환 인터페이스
  params: AuditLogParams
): Promise<void>

interface AuditLogParams {
  contractId: string
  eventType: 'viewed' | 'signed' | 'sent' | 'issuer_signed'
  actorType: 'customer' | 'admin' | 'system'
  actorId: string | null
  ipAddress: string | null
}
// 내부 DB 오류는 silent fail (주 흐름을 막지 않음)
```

### 4-7. `contentHash.ts`

```typescript
// Web Crypto API — Node.js 18+ 및 브라우저 양쪽 동작
async function computeContentHash(content: unknown): Promise<string>
// content_blocks 또는 canvas_document를 JSON 직렬화 후 SHA-256 hex(64자) 반환
```

### 4-8. `issuerSignatureCheck.ts`

```typescript
async function checkIssuerSignatureRequired(
  admin: CheckAdminClient,  // service_role 클라이언트 호환 인터페이스
  contractId: string
): Promise<{ blocked: boolean; reason?: string }>
// requires_issuer_signature=true이고 발행자 서명 없으면 blocked:true 반환
```

---

## 5. 핵심 타입 정의 (`src/lib/types/contract-document.ts`)

```typescript
// DB 저장 포맷 — content_blocks JSONB 원소
interface TiptapDocBlock {
  type: 'tiptap-doc'
  doc: JSONContent  // ProseMirror 문서 트리
}

// 변수 칩 (MergeFieldNode) 속성
interface MergeFieldAttrs {
  variable: string   // 치환 키 (ContractSubstitutionData 키)
  label: string      // 화면 표시용 레이블
}

// ContractDocumentEditor.onSave 콜백 페이로드
interface ContractDocumentPayload {
  title: string
  contentBlocks: TiptapDocBlock[]
  specifications?: { key: string; value: string }[]
  templateId?: string | null
}

// ContractCanvasEditor.onSave 콜백 페이로드
interface ContractCanvasPayload {
  title: string
  canvasDocument: CanvasDocument
  specifications?: { key: string; value: string }[]
  templateId?: string | null
}

// 캔버스 에디터 문서 구조
interface CanvasDocument {
  pages: CanvasPage[]
  fields: CanvasField[]
}

interface CanvasPage {
  id: string; imageUrl: string; width: number; height: number
}

type CanvasFieldType = 'signature' | 'text' | 'label'

interface CanvasField {
  id: string; pageId: string; type: CanvasFieldType
  x: number; y: number; width: number; height: number
  required: boolean; label: string
  boundVariable?: keyof ContractSubstitutionData  // type='text' 전용
}

// 타입 가드
function isTiptapDocBlock(block: unknown): block is TiptapDocBlock
function isCanvasDocument(value: unknown): value is CanvasDocument
function hasSignatureField(doc: CanvasDocument): boolean  // EC-3 검증
function validateFieldBounds(field: CanvasField, page: CanvasPage): boolean  // EC-2 검증
```

---

## 6. 환경변수 요구사항

```bash
# 서버 전용 ($env/static/private) — 절대 클라이언트 노출 금지
SUPABASE_SERVICE_ROLE_KEY=...   # contracts/signings/audit_log 서버사이드 접근

# 클라이언트 공개 ($env/static/public)
PUBLIC_SUPABASE_URL=...         # Supabase 프로젝트 URL
PUBLIC_SUPABASE_ANON_KEY=...    # anon/authenticated 세션용
```

추가 의존성 없음. SHA-256 해시는 Web Crypto API(Node.js 18+ 전역 `crypto.subtle`) 사용.

---

## 7. 설치 순서

이식 대상 SvelteKit 5 프로젝트에 적용하는 순서:

### Step 1. npm 패키지 설치

```bash
npm install svelte-tiptap @tiptap/core @tiptap/starter-kit \
  @tiptap/extension-table @tiptap/extension-table-row \
  @tiptap/extension-table-header @tiptap/extension-table-cell \
  @tiptap/extension-image @tiptap/extension-underline \
  @tiptap/extension-text-align @tiptap/extension-text-style \
  @tiptap/extension-color @tiptap/extension-font-family \
  @tiptap/extension-link \
  mammoth                # docx 임포트
# xlsx(SheetJS)는 동적 import로 사용 — 사전 설치 불필요
# hwpxImport는 실험적 — 별도 파서 의존성 있음
```

### Step 2. 마이그레이션 적용 (순서 엄수)

```
1. 21_contracts.sql          (contracts 기본 테이블)
2. 140_rental_cms_additions.sql  (contract_signings 테이블)
3. 148_contract_templates.sql    (contract_templates 테이블)
4. 149_contracts_content_fields.sql
5. 145_contract_signings_signature.sql
6. 146_contract_signings_expiry.sql
7. 217_contract_signings_content_hash.sql
8. 218_contract_audit_log.sql
9. 219_contract_issuer_signatures_and_assets.sql
10. 225_canvas_authoring_mode.sql
```

### Step 3. 파일 복사

```
src/lib/components/cms/contract-editor/  → 대상 프로젝트 동일 경로
src/lib/contract-signature/              → 그대로
src/lib/utils/docImport/                 → 그대로
src/lib/types/contract-document.ts       → 그대로
src/lib/utils/contract-substitution.ts  → 그대로
```

### Step 4. 어댑터(Adapter) 연결

에디터 컴포넌트는 Supabase를 직접 import하지 않는다. 각 라우트에서 `onSave` 콜백을 주입:

```svelte
<!-- 예: CMS 계약서 편집 페이지 -->
<script lang="ts">
  import ContractDocumentEditor from '$lib/components/cms/contract-editor/ContractDocumentEditor.svelte'

  // onSave 어댑터 — 실제 Supabase 연동은 여기서 담당
  async function handleSave(payload) {
    const res = await fetch(`/api/cms/contracts/${contractId}/content`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:          payload.title,
        content_blocks: payload.contentBlocks,
        specifications: payload.specifications,
        template_id:    payload.templateId,
      }),
    })
    if (!res.ok) throw new Error(await res.text())
  }
</script>

<ContractDocumentEditor
  {initialContent}
  {title}
  onSave={handleSave}
/>
```

캔버스 모드에서 배경 이미지 업로드 어댑터:

```svelte
async function handleUploadPage(blob, fileName) {
  // 이식 대상 프로젝트의 스토리지(Supabase Storage/Cloudinary/S3)에 업로드
  const url = await uploadToStorage(blob, fileName)
  return url
}

<ContractCanvasEditor onUploadPage={handleUploadPage} onSave={handleSaveCanvas} />
```

### Step 5. 라우트 배선

```
src/routes/api/cms/contracts/[id]/content/+server.ts
src/routes/api/cms/contracts/[id]/send-chat/+server.ts
src/routes/api/cms/contracts/[id]/issuer-sign/+server.ts
src/routes/api/cms/reservations/[id]/init-contract/+server.ts
src/routes/api/cms/reservations/[id]/contract-data/+server.ts
src/routes/api/cms/signature-assets/+server.ts
src/routes/api/contracts/[token]/sign/+server.ts
src/routes/contract/[token]/+page.server.ts  +page.svelte
```

---

## 8. 크레이지샷 특화 요소 — 이식 시 교체 필요 지점

다음 항목은 크레이지샷 특정 구조나 관례에 의존한다. 다른 프로젝트로 이식 시 반드시 검토·교체가 필요하다.

### 8-1. CMS 역할 권한 게이트

```typescript
// src/lib/utils/cmsPermissions.ts
// src/lib/server/getCmsRoleForAction.ts
// manager 이상만 계약서 CRUD 허용 (partner는 열람 불가)
```

이식 대상 프로젝트의 권한 체계에 맞게 교체해야 한다.

### 8-2. 채팅 알림 연동 (`send-chat`)

`POST /api/cms/contracts/[id]/send-chat`은 크레이지샷의 `chat_sessions`/`chat_messages`
테이블과 `send_rental_chat_notification` RPC에 의존한다. 이식 시 SMS, 이메일, 다른 채팅
시스템으로 대체하거나 채팅 연동 코드를 제거해야 한다.

### 8-3. CMS 디자인 토큰

컴포넌트 스타일이 `var(--cs-purple)`, `var(--cs-lilac)`, `var(--cs-surface-gray)` 등
크레이지샷 CSS 변수를 사용한다. 이식 대상 프로젝트의 토큰으로 전역 치환하거나 `src/app.css`에
동일 변수를 추가한다.

### 8-4. 변수 치환 데이터 구조 (`ContractSubstitutionData`)

`src/lib/types/contract-module.ts`의 `ContractSubstitutionData` (16개 키)는 크레이지샷의
대여 예약 데이터 모델(rental_reservations, user_profiles, order_items 등)에 의존한다.
이식 시 대상 프로젝트의 데이터 구조에 맞게 키와 `GET /api/cms/reservations/[id]/contract-data`
서버 로직을 재작성해야 한다.

### 8-5. `rental_reservations` 참조

`contracts.reservation_id` 컬럼과 `init-contract` API가 크레이지샷의 `rental_reservations`
테이블을 참조한다. 다른 예약/주문 모델을 가진 프로젝트는 해당 외래키와 API 로직을 교체해야 한다.

### 8-6. `is_cms_user()` / `is_cms_admin()` RLS 함수

RLS 정책에서 크레이지샷 전용 PostgreSQL 함수를 사용한다. 이식 대상 프로젝트에 동일한 함수가
없으면 `(auth.jwt() ->> 'role' = 'service_role')` 또는 사용자 정의 함수로 대체해야 한다.

### 8-7. Supabase Storage — 발행자 서명 이미지

`cms_signature_assets.image_url`과 `ContractCanvasEditor.onUploadPage`는 Supabase Storage
또는 Cloudinary를 가정한다. 이식 대상 스토리지 서비스에 맞게 업로드 어댑터를 교체한다.

---

## 9. 알려진 한계 / v2 개선 예정 사항

- **SMS/OTP 재인증 없음**: `content_hash`는 서명 시점 문서 상태를 해시하는 용도이며, 신원 재확인 수단이 아님. v1 범위 밖.
- **캔버스 모드 서명 필드 렌더링**: 고객 서명 페이지(`/contract/[token]`)에서 canvas 모드 signature 필드에 실제 SignatureCanvas를 인라인으로 배치하는 렌더링은 Phase 6 v1에서 기본 구조만 구현됨. 완전한 인라인 서명 UX는 v2 예정.
- **자산 관리 CMS UI**: `/cms/set/signature` 페이지는 Phase 8-B-2로 분류된 미구현 항목. 현재 API는 준비됐으나 전용 UI 화면이 없음.
- **`hwpxImport.ts`**: 실험적 파싱으로 사용자 동의 필수. 한글(HWP) 완전 지원은 공식 파서 없이 한계 있음.
- **계약서 PDF 다운로드**: `/api/contracts/[token]/pdf` 생성 API 미구현. v2 예정.

---

*contract-suite-integration.md | Phase 0~9 완료 (2026-08-12) | Harness Flow v3.2*
