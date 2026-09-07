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
 */

export const DEFAULT_RENTAL_CONTRACT_HTML = `
<style>
  .contract-wrap, .contract-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .contract-wrap { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12px; color: #000; background: #fff; max-width: 794px; margin: 0 auto; padding: 40px 30px; }
  .contract-wrap h1.contract-title { text-align: center; font-size: 22px; font-weight: bold; letter-spacing: 6px; margin-bottom: 24px; }
  .contract-wrap .issue-date { text-align: center; font-size: 11px; color: #444; margin-bottom: 28px; }
  .contract-wrap table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .contract-wrap td, .contract-wrap th { border: 1px solid #333; padding: 6px 8px; vertical-align: middle; font-size: 11.5px; }
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
  .contract-wrap .sig-host-cell { position: relative; }
  .contract-wrap .issuer-sig-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: none; z-index: 5; pointer-events: none; }
  @media print {
    .contract-wrap { font-size: 11px; padding: 20px 15px; }
  }
</style>
<div class="contract-wrap">

  <h1 class="contract-title">임 대 차 계 약 서</h1>
  <p class="issue-date">(계약서 발행일시: {{계약서발행일}})</p>

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
        <td>(인){{고객이름}}</td>
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
        <td style="text-align:center" rowspan="2">{{요금유형}}</td>
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
        <td class="label-cell">정상 대여가 총액</td>
        <td style="text-align:right">{{기본대여요금}}</td>
        <td class="label-cell" rowspan="4">특이사항</td>
        <td colspan="2" rowspan="4"><!--SPECIAL_NOTES--></td>
      </tr>
      <tr>
        <td class="label-cell">할인 적용</td>
        <td style="text-align:right">△ {{할인금액}}</td>
      </tr>
      <tr>
        <td class="label-cell">포인트 사용</td>
        <td style="text-align:right">△ {{차감포인트}}</td>
      </tr>
      <tr>
        <td class="label-cell">할인적용 금액</td>
        <td style="text-align:right">△ {{할인차감}}</td>
      </tr>
      <tr>
        <td class="label-cell">배송비</td>
        <td style="text-align:right">{{배송비}}</td>
        <td class="label-cell" rowspan="3">구분</td>
        <td class="label-cell">대여지점</td>
        <td>{{지점옵션}}</td>
      </tr>
      <tr class="final-row">
        <td class="label-cell" rowspan="2">최종 결제 금액</td>
        <td style="text-align:right; font-size: 13px;" rowspan="2">{{최종합계}} (▣VAT포함)</td>
        <td class="label-cell">픽업방법</td>
        <td>{{수령형태}}</td>
      </tr>
      <tr>
        <td class="label-cell">반납방법</td>
        <td>{{반납형태}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 계약 및 인수 확인 -->
  <table class="section-header"><tbody><tr><td>▣계약 및 인수 확인</td></tr></tbody></table>
  <div class="terms">
    <p>제반사고 및 사용상의 취급 부주의로 인한 장비손상에 대하여 배상의 책임을 집니다.</p>
    <p>상품정보를 이상 없이 인수받았기에 아래와 같이 서명 날인합니다</p>
    <p>※촬영(대여)전 크레이지샷 매장 내에서 구성품 확인,작동 이상유무 확인,테스트 촬영을 꼭 하시기 바랍니다.</p>
    <p>※구성품 확인,작동 이상유무 확인,테스트 촬영을 하지 않았을 경우 본 촬영에 들어가 발생되는 모든 상황에 대해 크레이지샷은 책임을 지지 않습니다.</p>
    <p><strong>[비대면 인도 및 검수]</strong>회사는 장비의 정상 작동 여부를 확인한 후 택배 또는 퀵서비스로 발송하며,고객은 장비 수령 즉시 구성품 및 상태를 확인해야 합니다.</p>
    <p><strong>[하자 통보 의무]</strong>장비에 결함이 있거나 구성품이 누락된 경우,고객은 수령 후[3시간]이내에 사진 또는 영상과 함께 회사에 통보해야 합니다.</p>
    <p><strong>[인도 완료 의제]</strong>위 기한 내에 별도의 이의제기가 없는 경우,고객이 장비를 이상 없는 상태로 인도받은 것으로 간주하며 이후 발생하는 모든 파손 및 기능 불능에 대한 책임은 고객에게 귀속됩니다.</p>
    <p><strong>[배송 중 사고]</strong>배송 과정에서 발생한 파손은 운송업체의 책임 규정에 따르되,고객이 수령 후 즉시 신고하지 않아 운송업체에 책임을 물을 수 없게 된 경우 그 손해는 고객이 배상합니다.</p>
    <p>기타 계약조건은 당사 홈페이지(www.crazyshot.kr)의 이용약관을 참조하여 주십시오.</p>
  </div>

  <!-- 개인정보동의 -->
  <table class="section-header"><tbody><tr><td>▣개인정보동의</td></tr></tbody></table>
  <div class="terms">
    <p><strong>[신원 검증]</strong>고가 장비 대여 시 본인 확인을 위해 신분증 및3개월 이내 등본 사본을 제출하며,위조 시 즉시 형사 고발됩니다.</p>
    <p><strong>[보안 관리]</strong>제출 서류는 암호화된 독립 저장소에 보관하며,정상 반납12개월 후 파기하되 분쟁 시에는 해결 시까지 보관합니다.</p>
    <p><strong>[법적 대응]</strong>장비 미반납·연락 두절 시 수집된 정보를 바탕으로 횡령 및 사기죄 고소를 진행하며,관련 정보를 수사기관에 제공합니다.</p>
  </div>

</div>
`.trim()
