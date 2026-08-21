# Privacy Mirror

Privacy Mirror는 브라우저에서 발생하는 개인정보 추적 신호를 **획득 → 출처 귀속 → 교차 계층 상관분석 → Risk/Confidence 분리 → 최소 개입 → 호환성 확인 → 설명** 순서로 처리하는 Chrome·Firefox 공통 실험형 확장 프로그램입니다.

단일 API를 무조건 차단하는 제품이 아닙니다. Canvas 읽기 자체보다 `hidden Canvas → digest → third-party request`, `decorated URL → storage write → redirect`처럼 서로 다른 계층의 근거가 짧은 시간 안에 연결되는지를 더 중요하게 봅니다.

> 상태: 연구·데모용 초기 구현입니다. 실제 추적 차단을 완전 보장하는 브라우저 엔진 수준 보호가 아닙니다.

## 왜 필요한가

쿠키 제한만으로는 stateless fingerprinting, stateful storage tracking, navigational tracking을 함께 다루기 어렵습니다. 기존 방어의 Canvas/WebGL 일반화, 알려진 링크 장식 제거, 네트워크 규칙은 각각 유효하지만, 한 신호만으로 추적 의도를 단정하면 오탐과 사이트 파손이 커집니다.

Privacy Mirror의 차별점은 개별 기법의 최초 발명이 아니라 다음 결합에 있습니다.

- 사용자 상호작용, hidden canvas, API sequence를 함께 보는 Signal Profiler
- 위험한 정보 노출 정도인 **Risk**와 실제 추적이라는 근거 강도인 **Confidence**의 분리
- session + top-level registrable domain별 HMAC seed material에서 파생한 동기 결정적 Canvas 변조
- Canvas/WebGL/environment, digest, storage, navigation, network를 연결하는 Cross-Layer Evidence Graph
- raw identifier 대신 세션 HMAC tag만 남기는 Token Lineage
- Compatibility Guard와 자동 observe rollback
- Counterfactual Analyzer와 Minimum Intervention Optimizer
- 모호한 사건에만 선택적으로 쓰는 Evidence-Aware Adaptive Reasoning

Brave farbling, Safari/WebKit의 navigational tracking 방어, Firefox의 추적 방지, 연구용 graph-based tracking detection과 문제의식은 겹칩니다. Privacy Mirror는 이를 대체한다고 주장하지 않으며, **설명 가능한 교차 계층 증거와 최소 개입 검증을 한 실험 파이프라인에 결합**하는 데 초점을 둡니다.

## Monorepo 구조

```text
packages/core/                 공통 profiler, graph, scoring, optimizer, guard
packages/browser-adapter/      Chrome / Firefox WebExtension 차이
packages/ai/                   sanitizer, router, NIM gateway, validator, consensus
apps/extension-shared/         MAIN hook, isolated bridge, background, panel UI
apps/chrome/                   Chrome MV3 manifest
apps/firefox/                  Firefox MV3 manifest
apps/dashboard/                로컬·정적 설명형 대시보드
apps/analysis-server/          선택형 HTTPS zero-retention 분석 서버
test-pages/                    정상·fingerprint·혼합·bounce 합성 fixture
tests/                         core, AI, ablation, 성능, 서버 검증
scripts/                       dependency-free build/lint/static server
```

Chrome은 공식 `sidePanel` API(Chrome 114+, MV3)를 사용합니다. Firefox는 Chrome API와 호환되지 않는 `sidebar_action`을 adapter/manifest 경계에서 분리했습니다. Chrome MV3의 `webRequestBlocking` 제한 때문에 네트워크는 `webRequest`로 관찰하고, 알려진 매개변수 정리는 정적 `declarativeNetRequest` 규칙으로 처리합니다. Firefox도 DNR을 지원하지만 UI sidebar는 별도입니다.

- [Chrome Side Panel 공식 문서](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome webRequest MV3 제한](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
- [Firefox sidebar_action](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action)
- [Firefox declarativeNetRequest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest)

## 동기 Canvas 경로와 seed

Canvas `getImageData()`·`toDataURL()` 반환 경로에서는 네트워크나 비동기 HMAC을 기다리지 않습니다.

1. background가 browser-session master key를 메모리성 `storage.session`에 생성합니다.
2. `HMAC(master, top-level site)`로 seed material을 미리 파생합니다.
3. isolated content bridge가 seed material과 policy를 MAIN world hook에 전달합니다.
4. hook은 이미 받은 seed material로만 동기 PRNG를 실행합니다.

seed가 도착하기 전에는 **관찰만 하고 변조하지 않습니다**. 따라서 매우 이른 page script 호출은 변조되지 않을 수 있습니다. 이 선택은 동기 API를 비동기 호출로 깨뜨리지 않기 위한 명시적 호환성 절충입니다.

## Evidence-Aware Adaptive Reasoning

AI는 보호 hot path에 있지 않으며 기본값은 `OFF`입니다.

```text
Local Evidence Graph
  → Privacy Sanitizer
  → (모호한 사건만) NVIDIA Lightning
  → 큰 판단 충돌 시 Deep model
  → Response Validator
  → Consensus / OBSERVE_MORE
  → 기존 Local Optimizer
```

Ultra model은 `RESEARCH` 요청에서만 선택됩니다. AI 응답 단독으로 domain 차단, 임의 storage 삭제, unknown parameter 삭제, JavaScript 비활성화를 하지 않습니다. 응답이 timeout, 429, 5xx, invalid JSON이거나 존재하지 않는 evidence ID를 인용하면 AI 결과를 버리고 로컬 엔진이 계속 작동합니다.

서버 전용 환경 변수:

```powershell
Copy-Item .env.example .env
# 실제 배포 환경의 secret manager에서 다음 값을 설정합니다.
# NVIDIA_API_KEY_FAST
# NVIDIA_API_KEY_RESEARCH
```

`.env`는 Git에 커밋하지 마십시오. API key는 확장, dashboard, manifest, GitHub 파일에 포함되면 안 됩니다.

## Zero-retention 서버

서버는 선택 사항입니다. AI를 사용하지 않으면 확장과 로컬 분석은 독립적으로 작동합니다.

애플리케이션 서버의 원칙:

- HTTPS만 시작하며 인증서와 키가 없으면 실행을 거부
- POST JSON body만 수용; query string에 분석 데이터 금지
- raw URL, cookie/storage value, token, Canvas data, request/response body 필드 거부
- 요청당 64 KiB 제한
- DB, 파일, Redis, queue, analytics, APM/Sentry 연동 없음
- request body·URL·query를 출력하는 application log 없음
- `Cache-Control: no-store`
- 처리 중 메모리 참조만 사용하고 응답 뒤 참조 해제

실행 예시:

```powershell
$env:PM_TLS_CERT_PATH = "C:\certs\localhost.crt"
$env:PM_TLS_KEY_PATH = "C:\certs\localhost.key"
$env:NVIDIA_API_KEY_FAST = "<server secret>"
npm run server
```

정확한 한계: JavaScript에서 참조를 해제해도 메모리의 물리적 즉시 덮어쓰기를 보장할 수 없습니다. 또한 reverse proxy, TLS 종단, CDN, WAF, hosting provider가 IP·시간·전송량 같은 운영 메타데이터를 자체 정책에 따라 기록할 수 있습니다. 따라서 “인프라 전체에서 로그가 절대 0”이라고 주장하지 않습니다. NVIDIA 처리에는 NVIDIA의 적용 약관과 개인정보 정책도 별도로 적용됩니다. 운영 전 [zero-retention 체크리스트](docs/zero-retention-checklist.md)를 검토하십시오.

## 설치와 데모

요구 사항: Node.js 20 이상.

```powershell
npm run check
```

빌드 결과:

- `dist/chrome`
- `dist/firefox`
- `dist/dashboard`

Chrome:

1. `chrome://extensions`를 엽니다.
2. 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**에서 `dist/chrome`을 선택합니다.
4. 확장 아이콘을 눌러 Side Panel을 엽니다.

Firefox:

1. `about:debugging#/runtime/this-firefox`를 엽니다.
2. **임시 부가 기능 로드**를 선택합니다.
3. `dist/firefox/manifest.json`을 선택합니다.
4. 브라우저 Sidebar 메뉴 또는 `Alt+Shift+P`로 엽니다.

Dashboard:

```powershell
npm run dashboard
```

`http://127.0.0.1:4173`에서 synthetic evidence graph 데모를 볼 수 있습니다. `test-pages/normal-canvas.html`과 `fingerprint-canvas.html`을 비교하면 사용자 입력·hidden Canvas·digest sequence 차이를 확인할 수 있습니다. `combined-fingerprint.html`의 외부 요청은 의도적으로 실패하는 `.invalid` 도메인을 사용합니다.

## 테스트

```powershell
npm run lint
npm test
npm run build
```

현재 자동 검증 범위:

- Risk/Confidence 분리와 temporal graph edge
- 동일 seed 안정성·다른 seed 분리
- HMAC-shaped Token Lineage에 raw token 미잔류
- known tracking parameter만 제거하고 functional parameter 유지
- Compatibility Guard rollback
- Minimum Intervention에서 strict blocking 회피
- sanitizer의 raw URL/domain/token 제거
- hallucinated evidence ID·과도한 확정 표현 거부
- Lightning→Deep escalation과 명확한 사건 no-call
- provider failure의 fail-local
- ablation, synthetic precision/recall/F1, core P95 성능
- server의 raw field 거부와 persistence/telemetry 의존성 부재
- dist secret-like marker 검사

합성 fixture 성능은 실제 브라우저·사이트 성능을 대신하지 않습니다. Chrome/Firefox의 extension loading, DNR 규칙 유효성, Canvas 결과 안정성은 실제 브라우저에서 별도 검증해야 합니다.

## 위협 모델

대상:

- Canvas/WebGL/environment 신호를 결합하는 능동 fingerprinting
- digest 직후 third-party request가 이어지는 시간 상관
- cookie/localStorage/sessionStorage/IndexedDB 접근 메타데이터
- URL decoration, 짧은 bounce, storage 재기록
- 여러 계층에서 같은 세션 HMAC tag가 나타나는 token lineage

비대상 또는 불완전 대응:

- 브라우저 엔진·GPU process 내부 수집
- 모든 Worker, sandboxed/restricted frame, privileged page
- 서버가 이미 가진 계정 ID·로그인 상태 기반 추적
- TLS 외부의 서버측 결합, CNAME cloaking의 완전 판별
- 악성 확장 프로그램, 로컬 malware, endpoint compromise
- fingerprinting과 정상 fraud prevention의 완전한 의도 구분

Risk와 Confidence는 확률적 진실값이나 법적 판정이 아니라 설명 가능한 휴리스틱 점수입니다.

## 알려진 구현 한계

- registrable domain 계산은 외부 PSL dependency 없이 제한된 다중 suffix 목록을 사용합니다. 실제 배포 전 완전한 Public Suffix List 구현으로 교체해야 합니다.
- MAIN world hook은 페이지에 의해 탐지·변경될 수 있으며 네이티브 함수로 완벽 위장하지 않습니다.
- `toBlob()`은 비동기 bitmap snapshot의 브라우저 차이 때문에 현재 관찰만 하고 변조하지 않습니다.
- WebGL은 식별성이 큰 vendor/renderer 반환만 일반화하며 전체 extension list·shader·timing 지문을 제거하지 않습니다.
- storage instrumentation은 페이지 JavaScript 경로의 메타데이터만 관찰하며 HTTP-only cookie나 브라우저 내부 접근을 볼 수 없습니다.
- network observation은 host permissions와 브라우저가 노출하는 `webRequest` 범위에 한정됩니다. 요청·응답 body와 WebSocket message는 수집하지 않습니다.
- Compatibility Guard는 window error/resource failure를 근사 지표로 사용하므로 시각적 손상이나 의미적 오류를 모두 검출하지 못합니다.
- Chrome/Firefox sidebar 동작과 권한 경고는 플랫폼별로 다릅니다.

## 데이터 처리 원칙

Privacy Mirror는 Canvas 픽셀, 원문 fingerprint, form/password/email, request/response body, raw cookie/storage value, full URL history를 영구 저장하거나 AI로 보내도록 설계하지 않았습니다. 세션 분석에는 제한된 이벤트 메타데이터와 HMAC tag만 사용합니다. AI mode와 서버 URL 설정은 로컬 저장소에 둘 수 있지만 API key는 서버에만 둡니다.

## License

MIT
