/**
 * defaultRentalContractHtml.ts — 크레이지샷 임대차계약서 고정 HTML 템플릿
 *
 * 원본 출처: 크레이지샷 계약서양식20260904.xls (Excel → HTML 변환)
 * 변수 치환: substituteHtmlDocument(html, data) 에서 {{변수명}} 패턴으로 처리
 * 반복 영역: <!--REPEAT:상품목록-->...<!--/REPEAT--> 마커 사이 행을
 *            ContractSubstitutionData.상품목록 배열 항목 수만큼 확장
 *
 * ⚠️ 이 파일은 계약서 양식을 직접 수정하는 유일한 지점이다.
 *    변수명({{...}})은 contract-module.ts ContractSubstitutionData 키와 정확히 일치해야 한다.
 *    변수명을 추가·변경하면 반드시 contractHtmlSubstitution.test.ts도 함께 갱신할 것.
 *
 * ⚠️ 2026-09-05 발견·수정(1차) — 이 문자열은 CMS 미리보기(.html-preview-doc)·고객 서명 페이지
 *    (/contract/[token])·마이페이지(/account/rental/[id]/contract) 3곳 모두 {@html}로
 *    "그 페이지의 기존 DOM 안에 그대로 삽입"된다 — 즉 항상 HTML 프래그먼트로 쓰인다.
 *    원래 <!DOCTYPE html><html><head>...</head><body>...</body></html> 전체 문서 형태였고
 *    내부 <style>도 body/table/td,th 등 스코프 없는 전역 셀렉터를 썼는데, 이 상태로
 *    innerHTML에 주입하면 브라우저가 <html>/<head>/<body> 래퍼는 무시하되 안의 <style>은
 *    그대로 살아남아 호스트 페이지 전체(CMS 관리자 화면의 다른 table, 고객 페이지 전체
 *    body 폰트 등)에 스타일이 새어나가는 결함이 있었다(실브라우저로 직접 재현·확인).
 *    전체 문서 래퍼(doctype/html/head/meta/body)를 제거하고, <style>의 모든 셀렉터를
 *    `.contract-wrap` 하위로 스코프해 순수 프래그먼트로 교정했다.
 *
 * ⚠️ 2026-09-05 발견·수정(2차, 내용 재구현) — 1차 수정 당시 이 템플릿의 실제 콘텐츠(레이아웃과
 *    약관 조항 본문)가 원본 엑셀을 옮겨 적은 것이 아니라 손으로 다시 창작되어 있었음이
 *    Stephen 육안 대조로 드러났다(제1조~제5조 표준 조항은 원본에 존재하지 않는 문구,
 *    "구성품" 섹션은 원본에 없는데 임의 추가, 정산내역의 "특이사항"·"구분(대여지점·픽업방법·
 *    반납방법)" 항목이 통째로 누락, 할인금액(등급할인)·할인차감(쿠폰할인) 2종 필드가 있는데
 *    한 필드만 사용). 원본 엑셀(계약서양식01 시트, 53행×15열, 병합 112개)을 xlrd/SheetJS로
 *    직접 파싱해 셀 텍스트·병합 구조를 대조한 뒤 아래와 같이 재구현했다:
 *      - 제42-49행(계약 및 인수 확인)·제51-52행(개인정보동의) 약관 원문을 한 글자도 다르지
 *        않게(쉼표 뒤 공백 유무 포함) 그대로 이식.
 *      - 정산내역에 원본에 있던 "할인 적용"(할인금액)·"할인적용 금액"(할인차감)을 별도 행으로
 *        분리 복원 + "특이사항"(비고, 데이터 미연동—빈 칸) + "구분"(대여지점/픽업방법/반납방법,
 *        픽업방법·반납방법은 기존 {{수령형태}}/{{반납형태}}에 매핑) 추가.
 *      - 원본에 없던 "구성품" 섹션 삭제.
 *      - 섹션 제목바(▣대여 및 반납시간·▣대여 장비내역·▣정산내역·▣계약 및 인수 확인·
 *        ▣개인정보동의)를 추가해 6개로 분절된 표 사이 시각적 연속성 보완.
 *    서명 처리: 대표이사 도장은 원본 엑셀 자체도 "한광익(인)" 텍스트 표기일 뿐 이미지가
 *    삽입되어 있지 않아(레거시 .xls BIFF 포맷 직접 확인) 원문 그대로 텍스트 유지 —
 *    이미지 오버레이(cs-image://) 신규 배선은 불필요. 고객(예약자) 실시간 서명은 이 HTML
 *    블록과 무관하게 /contract/[token]/+page.svelte 등이 이 블록 아래에 별도로 렌더링하는
 *    기존 SignatureCanvas 컴포넌트가 이미 담당한다(스프레드시트형과 동일 정책, 신규 코드 불필요).
 *
 * ⚠️ 2026-09-05 발견·수정(3차, 기본정보 셀 매핑 대조) — Stephen이 CMS에서 실제 렌더링된 화면을
 *    Claude Browser로 직접 선택해 대조 요청. 이미 검증 완료된 스프레드시트형 양식("[수정2] 엑셀
 *    계약 문서양식", 2026-08-30 — 원본 엑셀을 실제 xlsx 임포트 파이프라인으로 가져온 셀 데이터를
 *    그대로 보유)의 jspreadsheet 셀 원문을 DOM에서 직접 읽어(accessibility 트리가 아니라
 *    td.textContent 원본 대조 — 접근성 트리는 "-,"·말줄임 등 표시 아티팩트가 섞여 신뢰 불가)
 *    기본정보 섹션 3곳을 일치시켰다:
 *      - 사업장 소재지: "서울특별시 강서구 양천로 418, 2층 202호"(공백 삽입)
 *        → "서울특별시강서구양천로418,2층202호"(원본 그대로 공백 없음).
 *        ⚠️ 그 스프레드시트형 셀 원문은 "2충202호"(오타)였으나, 이 세션에서 원본 .xls를
 *        SheetJS로 직접 재확인한 결과 원본은 "2층202호"(정자)이다 — 참조 템플릿 쪽의 오타이므로
 *        따라가지 않고 원본 기준(층)을 채택했다. 그 스프레드시트형 템플릿 자체의 오타 수정은
 *        이번 요청 범위(defaultRentalContractHtml.ts) 밖이라 별도로 손대지 않았다.
 *      - 예약자 서명란: "{{고객이름}} (인)" → "(인){{고객이름}}"(공백 없이 도장표시가 먼저,
 *        이름 변수가 뒤에 오는 순서) — 참조 스프레드시트 셀 원문과 정확히 일치시킴.
 *      - 대여/반납/TOTAL 표 헤더 3번째 칸 "요금 유형"(의역) → "TOTAL"(원본·참조 스프레드시트
 *        공통 원문), 대여장비내역 표 헤더 "품목/수량/금액/비고"(의역) → "Item Detail/Qty/
 *        Amount/Notes"(원본 엑셀·참조 스프레드시트 공통 영문 원문) — 둘 다 원본이 영문
 *        헤더였음을 원본 파싱과 참조 템플릿 양쪽에서 재확인해 그대로 채택.
 *    정산내역(특이사항·구분·할인적용 금액 등, 2차 수정에서 원본 원문 기준으로 복원한 영역)은
 *    참조 스프레드시트("[수정2]")에 없지만, 그 템플릿은 원본 그리드를 단순화한 개정판이고
 *    Stephen이 2차 수정에서 이미 "통째로 누락됐던 항목"이라고 명시적으로 지적한 영역이라
 *    이번 대조로 되돌리지 않았다(원본 .xls 원문이 최종 기준).
 *
 * ⚠️ 2026-09-06 발견·수정(4차, "대여 및 반납시간" 표 행 구조) — 실제 발행·발송까지 CMS에서
 *    직접 테스트해본 뒤 Stephen이 원본 엑셀과 재대조 요청. 원본은 대여/반납 칸이 "날짜 행
 *    (YYYY.MM.DD)"과 "시간 행(HH:MM)" 2행으로 나뉘고 TOTAL 칸("Total Usage Time")이 그 2행에
 *    걸쳐 병합돼 있는데(rows13-14), 3차까지의 구현은 이를 1행으로 단순화해 {{수령일시}}/
 *    {{반납일시}}만 표시하고 있었다. 실데이터로 검증하는 과정에서 {{수령일시}}/{{반납일시}}가
 *    이름과 달리 실제로는 rental_reservations.pickup_time/return_time(TEXT, 시간만 — DB 컬럼
 *    타입 직접 확인)이 소스라 날짜 정보가 아예 없다는 것도 함께 드러났다 — 날짜는 별도 컬럼
 *    (start_date/end_date, DATE 타입)에 있는데 ContractSubstitutionData에 이를 노출하는 변수가
 *    지금까지 없었다. {{수령일자}}/{{반납일자}}(contract-module.ts, contract-data/+server.ts
 *    formatDateDot()) 신규 추가 + 표를 날짜행/시간행 2행 구조로 복원하고, TOTAL 칸의
 *    {{요금유형}}을 rowspan=2로 두 행에 걸쳐 표시(원본의 "Total Usage Time" 병합과 동일 위치).
 *
 * ⚠️ 2026-09-07 발견·수정(5차, 발행자 서명·직인 이미지 삽입/제거 기능 신설) — 이전(4차까지)엔
 *    "대표이사" 도장을 원본처럼 텍스트로만 유지하고, flow/spreadsheet 모드처럼 셀 단위로
 *    이미지를 삽입할 편집 캔버스가 html형엔 없다는 이유로 이미지 삽입 자체를 보류했었다.
 *    Stephen 재지시: "스프레드시트/워드 문서 편집에서의 서명(직인) 삽입 기능을 HTML형에도
 *    동일하게 넣어라." 재검토 결과 이 도장은 계약서마다 달라지지 않는 회사 고정 이미지라
 *    "매번 셀을 골라 삽입"할 필요가 없고, **템플릿 단위로 1개 이미지 URL만 저장**하면
 *    충분함을 확인 — 이 접근이 오히려 flow/spreadsheet보다 단순하다.
 *    구현: `<!--ISSUER_SIGNATURE-->` HTML 주석 마커를 "대표이사" 셀에 추가(REPEAT 마커와
 *    동일한 "주석으로 위치만 표시" 방식). `contract_templates.html_issuer_signature_url`
 *    (Migration #450)에 관리자가 CMS "서명/직인 삽입" 팝오버(flow/spreadsheet 모드의
 *    GET /api/cms/signature-assets 재사용 — 완전히 동일한 자산 목록·완전히 동일한 엔드포인트)
 *    로 고른 이미지 URL을 저장하면, `applyIssuerSignatureMarker()`(contract-substitution.ts)
 *    가 발행 시점에 마커를 실제 `<img>`로 치환한다. 미지정 시 마커는 빈 문자열로 제거되고
 *    "한광익 (인)" 텍스트만 그대로 남아(4차까지의 동작과 완전히 하위호환).
 *
 * ⚠️ 2026-09-07 발견·수정(6차, 서명·직인 이미지 크기조절 기능 추가) — Stephen이 스프레드시트형
 *    편집기(ContractSpreadsheetEditor.svelte)의 이미지 크기조절 툴바(소(100)/중(200)/대(400)
 *    프리셋 + 커스텀 px 입력 + 삭제)를 HTML형에도 동일하게 반영하라고 재지시. 위치 이동
 *    (offsetX/offsetY)은 HTML형에 적용 대상이 없음(셀 좌표가 아니라 고정 텍스트 흐름 안의
 *    인라인 요소) — 너비 조절만 이식. `contract_templates.html_issuer_signature_width`
 *    (Migration #451, INTEGER, 20~1200 클램프·미지정 시 기본 90px)를 추가해
 *    `applyIssuerSignatureMarker(html, url, width)`가 `<img style="width:{width}px">`로
 *    생성하도록 확장. `.issuer-sig-overlay`의 고정 max-height/max-width는 제거(스프레드시트
 *    쪽 `img.style.maxWidth='none'`과 동일 원칙 — 인라인 width가 유일한 크기 결정자).
 *
 * ⚠️ 2026-09-07 발견·수정(7차, 서명·직인 이미지를 표 맨 위 레이어로 오버레이) — 6차까지는
 *    이미지가 "한광익 (인)" 텍스트 뒤에 인라인으로 이어붙어(display:inline-block) 셀 폭을
 *    밀어내는 방식이었다. Stephen 지시: 실제 도장처럼 표 서식 위에 겹쳐 보이는 최상위
 *    레이어로 노출할 것. `.issuer-sig-overlay`를 `position:absolute`로 전환하고 그 부모
 *    셀에 `.sig-host-cell`(position:relative) 클래스를 추가해 셀 중앙에 겹쳐 뜨도록
 *    구성(z-index:5, pointer-events:none — 클릭·선택이 아래 텍스트를 그대로 통과).
 *
 * ⚠️ 2026-09-07 발견·수정(8차, 계약서발행일·지점옵션 배선 + 특이사항 재사용) —
 *    "html 계약양식 전역 변수 정보 동기 재검증" 요청으로 발견된 배선 공백 2건 반영:
 *    ① 최상단 "(계약서 발행일시: {{수령일시}})"를 `{{계약서발행일}}`(contracts.created_at
 *    기준)로 교체 — 레이블-변수 불일치 해소. ② "구분 → 대여지점" 값 셀의 하드코딩
 *    `&nbsp;` → `{{지점옵션}}`(수령/반납 지점명)으로 교체. 두 변수 모두 CS2654 C2
 *    (같은 날 별도 세션)가 contract-data/+server.ts·ContractSubstitutionData에 이미
 *    추가해뒀던 것을 이 템플릿에 마저 연결한 것.
 *    ③ 정산내역 "특이사항" 값 셀의 하드코딩 `&nbsp;` → `<!--SPECIAL_NOTES-->` 마커로
 *    교체(Stephen 확정: "기존 특약 조항 패널 재사용"). ContractFieldPanel.svelte "특약"
 *    탭에 이미 있는 항목명/내용 입력을 새 필드 신설 없이 그대로 재사용 —
 *    applySpecialNotesMarker()(contract-substitution.ts)가 "key: value" 쌍을 <br/>로
 *    이어붙여 채운다. 이 데이터는 /contract/[token] 서명 화면 맨 아래 "특약 조항"
 *    섹션(모드 무관 공용 렌더링, 기존 그대로 유지)에도 별도로 계속 표시된다 — 이 마커
 *    추가는 그 표시를 대체하는 게 아니라 정산내역 표 안에도 같은 데이터를 인라인으로
 *    보여주는 것을 추가한 것.
 *
 * ⚠️ 2026-09-07 발견·수정(9차, 계약 발행 보기 화면에서 특약 클릭 편집 지원) — "특이사항" 값
 *    셀에 `class="cs-special-notes-cell"`을 추가했다. 이 클래스는 어떤 변수 치환에도 관여하지
 *    않는 순수 앵커(anchor)로, `ContractTemplatePreviewModal.svelte`가 "계약 발행 보기"에서
 *    이 셀을 클릭하면 특약 입력 모달을 띄우고, 저장 시 `contract-substitution.ts`의
 *    `updateSpecialNotesInHtml()`이 이 클래스로 셀 위치를 찾아 내용만 교체한다(발행 시점에
 *    이미 `<!--SPECIAL_NOTES-->` 마커가 텍스트로 치환된 뒤라 마커 재치환이 불가능하므로 별도
 *    함수로 분리 — `applySpecialNotesMarker()` 자체와 그 테스트 계약은 전혀 건드리지 않음).
 *    이 클래스는 신규로 발행되는 계약서부터만 적용되며, 이 변경 이전에 이미 발행된 계약서의
 *    저장된 html_document에는 없어 그 화면에서는 클릭 편집이 노출되지 않는다(레거시 계약은
 *    조용히 미노출 — 회귀 아님, 기존에도 없던 기능).
 *
 * ⚠️ 2026-09-08 발견·수정(10차, 고객(예약자) 서명 이미지를 다시보기에 반영) — 2차 수정 당시엔
 *    "고객 실시간 서명은 SignatureCanvas가 이미 담당하니 이 HTML 블록과 무관"이라 판단해
 *    "(인){{고객이름}}"을 순수 텍스트로 유지했다. 그런데 그 SignatureCanvas가 캡처한 서명
 *    이미지(contract_signings.signature_data)는 서명 제출 즉시 DB에는 저장되지만 어디에도
 *    다시 그려지지 않는 write-only 데이터였다 — 서명 완료 후 계약서를 다시 열어봐도(관리자
 *    "보기"든 고객 본인 재조회든) 고객 서명은 흔적도 없이 "(인)이기성" 텍스트만 그대로
 *    보였다(Stephen 실사용 중 발견). 발행자 서명·직인(7차)과 동일하게 표 서식 위에 겹쳐
 *    보이는 오버레이로 노출하되, 발행 시점엔 아직 서명이 존재하지 않으므로 마커
 *    (`<!--CUSTOMER_SIGNATURE-->`)는 "예약자" 값 셀에 심어두기만 하고, 고객이 실제로
 *    서명을 제출하는 시점(POST /api/contracts/[token]/sign)에 1회 `applyCustomerSignatureMarker()`
 *    (contract-substitution.ts)로 되구워 contracts.html_document에 저장한다 — 그 이후의
 *    모든 재조회(관리자 미리보기·고객 재조회)는 이미 이미지가 구워진 html_document를 그대로
 *    보여주므로 별도 런타임 합성 로직이 필요 없다. 발행자 셀과 같은 `.sig-host-cell`
 *    (position:relative)을 재사용하고, `.customer-sig-overlay`는 `.issuer-sig-overlay`와
 *    동일한 배치(중앙 겹침·z-index:5·pointer-events:none)를 별도 클래스명으로 독립 정의해
 *    두 오버레이가 서로 영향을 주지 않게 했다. 이 마커는 신규로 발행되는 계약서부터만
 *    적용되며, 이 변경 이전에 이미 발행·서명 완료된 계약서는 마커 자체가 없어 조용히
 *    미노출된다(9차와 동일 원칙 — 레거시 계약 회귀 아님).
 *
 * ⛔ 2026-09-08 발견·수정(11차, 발행자 직인 위치 이동/드래그 지원 — 6차 결정 전면 반전) —
 *    6차 주석은 "위치 이동(offsetX/offsetY)은 HTML형에 적용 대상이 없음(셀 좌표가 아니라
 *    고정 텍스트 흐름 안의 인라인 요소)"이라고 명시했었으나, 실사용 중 "직인이 표 셀
 *    중앙에 고정돼 원하는 위치로 옮길 수 없다"는 Stephen 피드백에 따라 이 결정을 뒤집었다.
 *    `.issuer-sig-overlay`가 7차에서 이미 `position:absolute`(부모 `.sig-host-cell`
 *    기준)로 전환돼 있었고 문서 내 어떤 조상에도 overflow:hidden이 없다는 점을 활용해,
 *    DOM 구조(마커의 셀 안 위치)는 그대로 두고 `transform: translate(calc(-50% +
 *    {offsetX}px), calc(-50% + {offsetY}px))`로 기본 중앙 위치 대비 델타만 추가하는
 *    방식으로 구현 — 셀 밖으로도 자유롭게 이동한 것처럼 보이게 하는 데 별도 레이어
 *    분리가 필요 없었다. `contract_templates.html_issuer_signature_offset_x/y`
 *    (Migration #463, INTEGER, 기본 NULL=0=중앙)를 추가해 `applyIssuerSignatureMarker
 *    (html, url, width, offsetX, offsetY)`로 확장. 드래그 UI는
 *    `ContractTemplatePanel.svelte`(pointerdown/move/up, 드래그 중엔 DOM에 직접
 *    transform만 적용해 60fps 유지 + 손을 뗀 시점에만 $state 커밋)에 구현.
 *
 * ⚠️ 2026-09-08 발견·수정(12차, 발행자·예약자 서명 셀 텍스트 중앙정렬) — `.sig-host-cell`은
 *    도장 이미지(`.issuer-sig-overlay`/`.customer-sig-overlay`)만 `position:absolute`로
 *    셀 중앙에 겹쳐 뜨도록 돼 있었고, 그 밑에 깔린 텍스트("한광익 (인)"/"{{고객이름}} (인)")는
 *    `text-align` 지정이 없어 기본값(좌측 정렬)으로 남아 있었다 — 이미지는 중앙, 텍스트는
 *    좌측이라 서로 어긋나 보인다는 Stephen 실사용 피드백에 따라 `.sig-host-cell`에
 *    `text-align: center`를 추가해 텍스트도 이미지와 같은 중앙 기준으로 맞췄다. 이미지
 *    쪽은 `position:absolute`라 `text-align`의 영향을 받지 않으므로(11차 드래그 오프셋
 *    로직과 무관하게 그대로 유지), 텍스트 정렬만 독립적으로 바뀐다.
 *
 * ⚠️ 2026-09-08 발견·수정(13차, 문서 전체 셀 기본 정렬을 중앙으로 통일) — 12차가
 *    `.sig-host-cell` 1곳만 중앙정렬했는데, Stephen이 문서 전체(임대인/임차인 정보·
 *    정산내역·구분/대여지점/픽업방법/반납방법 등)의 라벨 셀·일반 값 셀 수십 곳을 한 번에
 *    선택해 "셀 중앙에 정렬"을 재지시 — 개별 셀마다 클래스를 추가하는 대신 기본 셀
 *    규칙(`.contract-wrap td, .contract-wrap th`) 자체에 `text-align: center`를
 *    추가해 전 셀 기본값을 통일했다. 금액류 셀({{기본대여요금}} 등)은 이미 인라인
 *    `style="text-align:right"`가 개별로 박혀 있어 인라인 스타일이 항상 클래스 기본값보다
 *    우선 적용되므로 이번 변경과 무관하게 그대로 우측정렬 유지(회귀 없음).
 *
 * ⛔ 2026-09-08 발견·수정(14차, "계약 및 인수 확인"·"개인정보동의" 문단 관리자 편집 지원) —
 *    이 두 섹션은 지금까지 코드에 하드코딩된 `<p>` 문단 나열이라 관리자가 CMS에서 전혀
 *    수정할 수 없었다(특약과 달리). Stephen 요청으로 각 섹션의 `<p>` 나열을
 *    `<!--CONTRACT_TERMS-->`/`<!--PRIVACY_TERMS-->` 마커로 교체 —
 *    `applyContractTermsMarker()`/`applyPrivacyTermsMarker()`(contract-substitution.ts)가
 *    `contract_templates.contract_terms_text`/`privacy_terms_text`(Migration #464, 빈 줄로
 *    문단 구분하는 일반 텍스트, 문단 맨 앞 "[라벨]"은 자동 굵게)를 실제 `<p>` 태그로 되구워
 *    치환한다. 값이 NULL(미커스터마이즈)이면 지금까지의 기본 문구를 그대로 사용해 하위호환.
 *    편집 UI는 `ContractFieldPanel.svelte`에 '계약조항'·'개인정보동의' 탭 신설(기존 '특약'
 *    탭과 동일하게 htmlMode 전용). `contracts` 테이블에는 별도 컬럼을 두지 않음 — 발행
 *    시점에 이미 html_document 문자열에 완전히 구워지므로 감사용 스냅샷이 불필요(특약처럼
 *    사후 클릭편집 기능을 만드는 것은 이번 요청 범위 밖).
 *
 * ⚠️ 2026-09-08 발견·수정(15차, 문서 진위확인 QR 삽입) — Stephen 지시: 인쇄된 계약서를
 *    스캔해 원본 여부를 즉시 판별할 수 있도록, 최상단 "임대차 계약서" 제목 아래 발행일시
 *    문구 우측에 QR코드 이미지를 배치. products.md §2-4의 "QR=순수 텍스트, 링크 아님"
 *    정책과 달리 이 QR은 의도적으로 **링크형**(고객 서명/확인 페이지 `/contract/[token]`)
 *    으로 확정했다 — 스캔 즉시 그 계약서의 실제 온라인 사본을 열어 판별을 끝내는 것이
 *    목적이라, 문자열만 담는 방식은 "결국 관리자가 그 값으로 다시 조회해야 함"이라
 *    목적에 부합하지 않는다는 판단(AskUserQuestion으로 Stephen 확정).
 *    발행 시점(applySelectedTemplate)엔 아직 서명 토큰이 존재하지 않아(contract_signings
 *    행 자체가 send-chat 시점에 생성됨) 다른 발행자 서명 마커들과 달리 이 마커
 *    (`<!--DOCUMENT_QR-->`)는 issuance 시점엔 보존되고, "채팅으로 발송" 실행 시점
 *    (POST /api/cms/contracts/[id]/send-chat)에 토큰이 확정된 직후 서버가
 *    `QRCode.toDataURL()`로 QR 이미지를 직접 생성해 `applyDocumentQrMarker()`
 *    (contract-substitution.ts)로 되구워 넣는다 — 고객 서명 마커(10차)와 동일한
 *    "발행 시점엔 마커만 남겨두고, 값이 실제로 확정되는 시점에 되굽는다" 패턴.
 *    재발송(기존 토큰 재사용) 시에도 동일 로직이 재실행되지만 토큰이 그대로라 QR 내용도
 *    동일 — 멱등. 이 마커는 신규로 발행되는 계약서부터만 적용되며, 이전에 이미
 *    발행·발송된 계약서는 마커 자체가 없어 조용히 미노출된다(10차~14차와 동일 원칙).
 *
 * ⚠️ 2026-09-08 발견·수정(16차, "특이사항" 셀 좌측정렬) — 13차에서 전 셀 기본 정렬을
 *    `text-align: center`로 통일하면서, 여러 줄 자유 서술 텍스트가 들어가는 "특이사항"
 *    (`cs-special-notes-cell`, 특약 조항 값) 셀도 함께 가운데 정렬돼 읽기 불편해졌다.
 *    이 셀만 `.cs-special-notes-cell { text-align: left; }`로 개별 재정렬(다른 셀의
 *    가운데 정렬 기본값은 그대로 유지).
 *
 * ⚠️ 2026-09-08 발견·수정(17차, "구분" 섹션 재구성 + TOTAL 칸 실 대여일수 반영) —
 *    Stephen이 실제 발행된 계약서를 검토하며 지적한 12개 항목 중 템플릿 구조 변경분:
 *    ① "대여 및 반납시간" 표 TOTAL 칸(rowspan=2)을 `{{요금유형}}`(대여기간 구분 라벨,
 *    예: "24시간(1일)")에서 `{{대여일수}}`(실제 계산된 대여일수, 예: "1일"·"1일 12시간")로
 *    교체 — RentalDetailPanel.svelte가 이미 쓰는 산식(cartRentalFee.ts calcRentalMinutes/
 *    calcRentalPeriodParts)을 contract-data/+server.ts가 그대로 재사용해 새 변수로 계산
 *    (Stephen 지시: "RentalDetailPanel 대여일수 값 재사용"). `요금유형` 필드 자체는
 *    제거하지 않고 그대로 유지(다른 참조처 하위호환).
 *    ② "정산내역" 표 "구분" 블록 재구성: "대여지점"(`{{지점옵션}}`) 행을 완전히 제거하고,
 *    그 정보를 "수령방법"/"반납방법" 값 자체에 흡수 — `{{수령형태}}`/`{{반납형태}}`
 *    (방식명 단독) 대신 `{{수령방법지점}}`/`{{반납방법지점}}`(방식명 + 지점이 있을 때만
 *    " (지점명)" 병기, contract-data/+server.ts 신규 계산)으로 값 셀 교체. "구분" rowspan을
 *    3→2로 줄여 "수령방법"/"반납방법" 2행만 span하도록 이동. "배송비" 행의 남는 3칸
 *    처리는 두 차례 시행착오를 거쳤다: 1차 시도(colspan="4"를 "배송비" 값 셀 자체에 부여)는
 *    값이 표 오른쪽 끝까지 넓게 퍼져 바로 위 특약사항(rowspan=4) 블록과 시각적으로 이어져
 *    보이는 결함이 있었고, 2차 시도(값 셀은 좁게 두고 별도의 빈 채움 셀 `<td colspan="3">`
 *    로만 나머지를 채움)는 그 빈 셀 자체가 "특약사항"·"구분" 사이에 목적 없는 흰 공백으로
 *    남아 여전히 어색해 보였다(둘 다 Stephen 실사용 화면 캡처로 발견). 최종 확정: 별도
 *    채움 셀을 아예 없애고, 그 자리를 특약사항 블록의 rowspan을 4→5로 한 칸 더 늘려
 *    "배송비" 행까지 자연스럽게 흡수하도록 함(`.label-cell`·`.cs-special-notes-cell`
 *    양쪽 다 rowspan="5"로 동시 확장) — 특약사항은 원래도 자유 서술 여러 줄 텍스트가
 *    들어가는 영역이라 한 행 더 길어져도 위화감이 없고, 별도의 빈 셀이 완전히 사라져
 *    표 전체가 5열 그리드로 빈틈없이 채워진다. "픽업방법"
 *    라벨도 "수령방법"으로 개명. `{{지점옵션}}`·`수령형태`·`반납형태` 필드 자체는 여전히
 *    타입에 남아있으나(하위호환, "필드 절대 제거 금지" 원칙) 이 템플릿에서는 더 이상
 *    참조하지 않음.
 *    ③ (템플릿 구조 변경은 아니지만 같은 세션 작업) "대여 장비내역" `{{비고}}`에
 *    상품 구성품(products.components) 정보를 채우고, 동일 상품 중복 예약을 한 줄로
 *    통합하는 기능(2026-08-28)·수령/반납 방식 한글 라벨(rental_method_options.name 직접
 *    사용으로 전환)·배송 시 시간정보 미노출은 전부 기존 동작이 이미 올바르거나(코드 조사로
 *    확인) 데이터 계산만 손댄 부분이라 이 템플릿 파일 자체의 마커·구조는 변경 없음.
 *
 * 2026-09-09 "정산내역" 표 컬럼폭 조정 — 특약사항 입력 공간 확보(Stephen 지시: "정상대여가
 *    총액~최종 결제 금액 변수값 영역 가로 공간을 좁혀 특약공간 변수값 영역 가로폭을 그만큼
 *    넓힐 것"). `.contract-wrap`의 실제 콘텐츠 폭(max-width:794px - padding 30px*2 =
 *    734px)을 기준으로, 금액 값 칸(정상 대여가 총액~최종 결제 금액, 6개 셀) 각각에
 *    `width:150px`를 명시해 좁히고, 특약사항 값 셀(`cs-special-notes-cell`, colspan="2")에
 *    `width:384px`를 명시해 그만큼 넓혔다(라벨 칸 2개 × 100px + 150px + 384px = 734px,
 *    합이 정확히 일치하도록 역산). 컬럼 수·rowspan/colspan 구조 자체는 무변경 — 폭
 *    수치만 조정. "구분" 블록의 수령방법/반납방법 값 칸(col5)은 별도 width 지정 없이
 *    특약사항 값 칸(col4+col5 합산 384px) 안에서 자동 배분되도록 유지(수령방법 라벨
 *    칸이 여전히 100px로 col4를 고정하므로 col5 ≈ 284px로 자연 계산됨).
 */

export const DEFAULT_RENTAL_CONTRACT_HTML = `
<style>
  .contract-wrap, .contract-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .contract-wrap { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12px; color: #000; background: #fff; max-width: 794px; margin: 0 auto; padding: 40px 30px; }
  .contract-wrap h1.contract-title { text-align: center; font-size: 22px; font-weight: bold; letter-spacing: 6px; margin-bottom: 24px; }
  .contract-wrap .issue-date { text-align: center; font-size: 11px; color: #444; margin-bottom: 28px; }
  .contract-wrap table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .contract-wrap td, .contract-wrap th { border: 1px solid #333; padding: 6px 8px; vertical-align: middle; text-align: center; font-size: 11.5px; }
  .contract-wrap th { background: #f0f0f0; font-weight: bold; text-align: center; }
  .contract-wrap .label-cell { background: #f5f5f5; font-weight: bold; white-space: nowrap; width: 100px; }
  .contract-wrap .section-header { margin: 18px 0 6px; }
  .contract-wrap .section-header td { background: #dce6f1; font-weight: bold; text-align: left; font-size: 12.5px; padding: 5px 8px; }
  .contract-wrap .no-border { border: none !important; }
  .contract-wrap .total-row td { font-weight: bold; }
  .contract-wrap .final-row td { font-weight: bold; background: #fff2cc; }
  .contract-wrap .terms { margin-top: 8px; font-size: 11px; line-height: 1.8; }
  .contract-wrap .terms p { margin-bottom: 10px; }
  .contract-wrap .sign-area { margin-top: 30px; }
  .contract-wrap .sign-row { display: flex; gap: 40px; justify-content: space-between; }
  .contract-wrap .sign-block { flex: 1; border: 1px solid #333; padding: 16px 12px; min-height: 100px; }
  .contract-wrap .sign-block .label { font-weight: bold; margin-bottom: 8px; }
  .contract-wrap .sign-block .value { color: #333; }
  .contract-wrap .sig-host-cell { position: relative; text-align: center; }
  .contract-wrap .issuer-sig-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: none; z-index: 5; pointer-events: none; }
  .contract-wrap .customer-sig-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: none; z-index: 5; pointer-events: none; max-height: 60px; }
  .contract-wrap .cs-special-notes-cell { text-align: left; }
  .contract-wrap .issue-date-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 28px; }
  .contract-wrap .issue-date-row .issue-date { margin-bottom: 0; }
  .contract-wrap .doc-verify-qr { display: block; width: 50px; height: 50px; }
  @media print {
    .contract-wrap { font-size: 11px; padding: 20px 15px; }
  }
</style>
<div class="contract-wrap">

  <h1 class="contract-title">임 대 차 계 약 서</h1>
  <div class="issue-date-row">
    <p class="issue-date">(계약서 발행일시: {{계약서발행일}})</p><!--DOCUMENT_QR-->
  </div>

  <!-- 임대인 정보 (고정) -->
  <table>
    <tbody>
      <tr>
        <td class="label-cell">임대인</td>
        <td class="label-cell">사업자등록번호</td>
        <td>372-81-03554</td>
        <td class="label-cell">대표이사</td>
        <td class="sig-host-cell">한광익 (인)<!--ISSUER_SIGNATURE--></td>
      </tr>
      <tr>
        <td class="label-cell">상호명</td>
        <td colspan="4">주식회사 크레이지샷</td>
      </tr>
      <tr>
        <td class="label-cell">사업장 소재지</td>
        <td colspan="4">서울특별시강서구양천로418,2층202호</td>
      </tr>
    </tbody>
  </table>

  <!-- 임차인 정보 (변수 치환) -->
  <table>
    <tbody>
      <tr>
        <td class="label-cell">임차인</td>
        <td class="label-cell">연락처</td>
        <td>{{연락처}}</td>
        <td class="label-cell">예약자</td>
        <td class="sig-host-cell">{{고객이름}} (인)<!--CUSTOMER_SIGNATURE--></td>
      </tr>
      <tr>
        <td class="label-cell">주소</td>
        <td colspan="4">{{주소}}</td>
      </tr>
      <tr>
        <td class="label-cell">E-mail</td>
        <td colspan="4">{{이메일}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 대여 및 반납시간 -->
  <table class="section-header"><tbody><tr><td>▣대여 및 반납시간</td></tr></tbody></table>
  <table>
    <thead>
      <tr>
        <th style="width:33%">대여</th>
        <th style="width:33%">반납</th>
        <th style="width:34%">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align:center">{{수령일자}}</td>
        <td style="text-align:center">{{반납일자}}</td>
        <td style="text-align:center" rowspan="2">{{대여일수}}</td>
      </tr>
      <tr>
        <td style="text-align:center">{{수령일시}}</td>
        <td style="text-align:center">{{반납일시}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 대여 장비내역 -->
  <table class="section-header"><tbody><tr><td>▣대여 장비내역</td></tr></tbody></table>
  <table>
    <thead>
      <tr>
        <th style="width:7%">NO.</th>
        <th style="width:40%">Item Detail</th>
        <th style="width:8%">Qty</th>
        <th style="width:15%">Amount</th>
        <th style="width:30%">Notes</th>
      </tr>
    </thead>
    <tbody>
<!--REPEAT:상품목록-->
      <tr>
        <td style="text-align:center">{{NO.}}</td>
        <td>{{상품명}} {{상품코드}}</td>
        <td style="text-align:center">{{수량}}</td>
        <td style="text-align:right">{{금액}}</td>
        <td>{{비고}}</td>
      </tr>
<!--/REPEAT-->
    </tbody>
  </table>

  <!-- 정산내역 -->
  <table class="section-header"><tbody><tr><td>▣정산내역</td></tr></tbody></table>
  <table>
    <tbody>
      <tr>
        <td class="label-cell">정상 대여요금</td>
        <td style="text-align:right; width:150px">{{기본대여요금}}</td>
        <td class="label-cell" rowspan="5">특약사항</td>
        <td class="cs-special-notes-cell" colspan="2" rowspan="5" style="width:384px"><!--SPECIAL_NOTES--></td>
      </tr>
      <!-- 2026-09-08 수정 — "△"(차감 표시) 접두사를 이 정적 템플릿 텍스트에서 제거하고
           formatDeltaAmount()(contract-data/+server.ts)가 실제 값이 0보다 클 때만 값
           자체에 붙이도록 이관했다. 정적으로 박아두면 할인·포인트가 전혀 없는(0원/-)
           예약에서도 "△ 0원"/"△ -"처럼 실제로 차감된 게 없는데 차감 기호가 붙어
           보이는 문제가 있었다(Stephen 실사용 중 발견). -->
      <!-- 2026-09-09 수정(Stephen 지시) — "할인 적용" 행은 등급할인(할인금액)이 아니라
           쿠폰 할인(할인차감)을 표시하도록 값을 이동 + 라벨을 "할인쿠폰 적용"으로 변경.
           "할인적용 금액" 행(라벨 유지)은 부가세(포함가 역산, contract-data/+server.ts
           formatVatAmount)로 교체 — 안내용 표시일 뿐 최종합계 산식에는 가산하지 않음. -->
      <tr>
        <td class="label-cell">할인쿠폰 적용</td>
        <td style="text-align:right; width:150px">{{할인차감}}</td>
      </tr>
      <tr>
        <td class="label-cell">포인트 사용</td>
        <td style="text-align:right; width:150px">{{차감포인트}}</td>
      </tr>
      <tr>
        <td class="label-cell">부가세</td>
        <td style="text-align:right; width:150px">{{부가세}}</td>
      </tr>
      <tr>
        <td class="label-cell">배송비</td>
        <td style="text-align:right; width:150px">{{배송비}}</td>
      </tr>
      <tr class="final-row">
        <td class="label-cell" rowspan="2">최종 결제요금</td>
        <td style="text-align:right; font-size: 13px; width:150px" rowspan="2">{{최종합계}} (▣VAT포함)</td>
        <td class="label-cell" rowspan="2">구분</td>
        <td class="label-cell">수령방법</td>
        <td>{{수령방법지점}}</td>
      </tr>
      <tr>
        <td class="label-cell">반납방법</td>
        <td>{{반납방법지점}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 계약 및 인수 확인 -->
  <table class="section-header"><tbody><tr><td>▣계약 및 인수 확인</td></tr></tbody></table>
  <div class="terms"><!--CONTRACT_TERMS--></div>

  <!-- 개인정보동의 -->
  <table class="section-header"><tbody><tr><td>▣개인정보동의</td></tr></tbody></table>
  <div class="terms"><!--PRIVACY_TERMS--></div>

</div>
`.trim()
