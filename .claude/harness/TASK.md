# .claude/harness/TASK.md
생성일: 2026-06-17 09:45
아젠다: 크레이지샷 장바구니 UI Dev 라우트 구축

[CONTEXT BRIDGE]
plan_source: Figma 1244-5191 (Cart 5-Zone UI), FE아키텍처 v1.55 PRD.1.2.2.6
핵심제약: 
  - 완료조건: `/dev/cart` 라우트에서 더미 데이터 기반 5존(카드/옵션/가격/버튼/결제)을 UX 테스트 가능한 상태로 렌더링
  - 금지사항: 실제 Supabase RPC 호출, TossPayments 실결제, 실 인증 체크 (모두 모킹)
  - 모킹 범위: cartFixtures.ts (샘플 상품·예약) + mockRpc.ts (시뮬레이션 응답)
TDD도메인: 없음 (UI 퍼블리싱 = GSD 도메인)
절대금지: 
  - 실 Supabase 네트워크 호출 (dev 라우트는 스태틱 더미만)
  - 결제 정보 실제 저장
  - 실 사용자 로그인 요구
실패롤백: 
  - `/dev/cart` 페이지 삭제
  - 생성된 컴포넌트/픽스쳐 파일 삭제
  - 이전 커밋으로 복원 (develop 브랜치)

---

## NOW
- [x] Zone1 ProductCard 컴포넌트 | GSD | 완료기준: 카드에 상품명/이미지/렌탈료 표시 | 예상: 15분 | 완료: 8분
- [x] Zone2 RentalOptions 컴포넌트 | GSD | 완료기준: 시작/종료일, 렌탈기간 분류 표시 | 예상: 20분 | 완료: 12분
- [x] Zone3 Pricing 컴포넌트 | GSD | 완료기준: 기본료/할인/최종금액 브레이크다운 표시 | 예상: 20분 | 완료: 10분
- [x] Zone4 Buttons 컴포넌트 | GSD | 완료기준: 계속하기/다시선택 버튼 + 상태 관리 | 예상: 15분 | 완료: 8분
- [x] Zone5 Payment 컴포넌트 | GSD | 완료기준: 결제 옵션 선택 UI + 모의 결제 시뮬레이션 | 예상: 15분 | 완료: 12분
- [x] cartFixtures.ts 더미 데이터 | GSD | 완료기준: 샘플 상품(4개), 예약(2개) 시나리오 | 예상: 10분 | 완료: 6분
- [x] mockRpc.ts 응답 모킹 | GSD | 완료기준: calculate_cart_total 응답 시뮬레이션 | 예상: 10분 | 완료: 7분
- [x] +page.ts (dev/cart load) | GSD | 완료기준: 라우트 로드 함수가 더미 데이터 반환 | 예상: 10분 | 완료: 3분
- [x] +page.svelte (dev/cart) | GSD | 완료기준: 5 존을 세로 레이아웃으로 배치, UX 시나리오 제어판 | 예상: 25분 | 완료: 18분
- [x] PRD.1.2.2.6 페이지 헤더 | GSD | 완료기준: Back 버튼 + "장바구니" 타이틀, 44px 미니멈 | 예상: 10분 | 완료: 포함됨

## NEXT
- [ ] Supabase Realtime 웹소켓 SSR 이슈 해결 (BLOCKED 우선순위)
- [ ] S1-M3: Payment Integration (TDD)

## DONE
- S0: 환경 설정 + DB 스키마 + RPC 함수 9개
- S1-M1: Products 모듈 (리스트 + 상세)
- S1-M2: Reservation Flow (TDD RED/GREEN/REFACTOR)
- S1-M2.5: Cart Dev Route (장바구니 UI 개발) — 10개 컴포넌트/파일 구축

## BLOCKED
- Supabase Realtime WebSocket SSR 이슈 (dev 서버 정상화 필요)

## BACKLOG
- 실 Supabase 연동 (GSD 전환 후)
- 장바구니 서버 저장 RPC
- 실 결제 플로우 (M3 TDD)
