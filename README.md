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

로컬 AI 서버(개발 및 독립 검증용):

```powershell
Copy-Item .env.example .env.local
# .env.local에 본인의 NVIDIA_API_KEY_FAST를 입력합니다.
npm run server:local
```

공개 설치 패키지는 고정 HTTPS 분석 주소 `https://privacy-mirror-analysis-blazetiger10-5946s-projects.vercel.app`를 사용합니다. 로컬 실행은 개발·독립 검증용으로 127.0.0.1에만 바인딩됩니다.

`.env.local`은 Git에서 제외됩니다. API key는 확장, dashboard, manifest, 패키지, GitHub 파일에 포함되면 안 되며 Vercel Production 환경 변수에만 둡니다. 공개 클라이언트에 공용 키를 넣는 방식은 지원하지 않습니다.

## Zero-retention 서버

서버는 AI 설명에만 사용됩니다. 서버가 중단되거나 모델이 요청을 거절해도 브라우저 내 결정론적 탐지·보호·7일 통계는 독립적으로 작동합니다. 현재 공개 endpoint에는 사용자 계정 기반 인증이나 완전한 남용 방지 장치가 없으므로 운영자는 Vercel/NVIDIA 사용량과 비용 한도를 별도로 설정해야 합니다.

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

`http://127.0.0.1:4173`에서 대시보드 외형을 볼 수 있습니다. 실제 통계는 확장 패널의 **최근 추적 데이터 보기** 버튼으로 연 확장 내부 페이지에서만 브라우저 기록과 연결됩니다. `test-pages/normal-canvas.html`과 `fingerprint-canvas.html`을 비교하면 사용자 입력·hidden Canvas·digest sequence 차이를 확인할 수 있습니다. `combined-fingerprint.html`의 외부 요청은 의도적으로 실패하는 `.invalid` 도메인을 사용합니다.

### 최근 추적 데이터

확장은 사이트의 registrable domain(eTLD+1)과 1시간 단위 집계만 `storage.local`에 최대 7일 보관합니다. 전체 URL, query string, 쿠키·storage 원문, Canvas 픽셀과 raw token은 이 기록에 포함하지 않습니다. 7일보다 오래된 시간 버킷은 새 이벤트가 기록될 때 자동 삭제됩니다.

확장 패널의 **최근 추적 데이터 보기**를 누르면 확장 내부 웹 대시보드가 열립니다. 여기서 다음을 확인할 수 있습니다.

- 모든 사이트 또는 특정 사이트의 최근 24시간·7일 통계
- 로컬 시간 기준 사이트 × 1시간 상세 기록
- 감지 신호, 방어 합계, Canvas/WebGL 바꿔치기, 추적 링크 정리, 실제 차단, 호환성 롤백
- 시간대별 막대 그래프와 사이트별 순위

현재 구현에는 임의의 third-party 요청을 차단하는 동적 차단기가 없으므로 **차단** 수치는 실제 차단이 구현·실행된 경우에만 증가하며, 그렇지 않으면 0으로 표시됩니다. `방어`는 바꿔치기·링크 정리·차단의 합계입니다.

### 누구나 설치할 수 있는 배포본 만들기

```powershell
npm run package:verify
```

이 명령은 Chrome/Firefox 산출물의 manifest 참조 파일과 비밀값 혼입을 검사합니다. 일반 사용자에게 한 번 클릭 설치를 제공하려면 플랫폼 서명이 추가로 필요합니다.

- Chrome(Windows/macOS): `dist/chrome`을 ZIP으로 묶어 Chrome Web Store 심사·게시가 필요합니다. GitHub ZIP을 일반 사용자가 바로 설치하는 방식은 지원되지 않습니다.
- Firefox: `dist/firefox`를 AMO에 제출하여 서명된 XPI를 받아야 합니다. 자체 배포도 Mozilla 서명이 필요합니다.
- 심사 전 개인정보처리방침에는 `<all_urls>`, website activity/technical data 관찰 목적, 로컬 처리 범위, 선택형 NVIDIA 전송과 zero-retention 한계를 정확히 기재해야 합니다.
- Firefox 142 이상을 지원합니다. Chrome은 114 이상을 지원합니다.

개발자 모드 설치는 위 절차대로 즉시 가능하지만, 이것을 스토어 서명 배포와 동일하다고 표현하지 않습니다.

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
- manifest/UI 참조 파일 존재와 전체 배포 디렉터리 비밀값 검사
- Firefox `web-ext lint` 공식 패키지 검사

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

## 2026-09 UI / AI integration

- Local live connection: `http://127.0.0.1:4173/dashboard/index.html` and `http://localhost:4173/dashboard/index.html` now have an isolated extension bridge. Install/reload the latest extension, refresh the dashboard, then click **확장 연결**. The connected page reads this browser's local seven-day history and uses the most recently accessed ordinary web tab for its current report. Other ports, paths and embedded frames are rejected. This is a direct browser-to-extension connection; no history database or local API server is introduced.
- Navigation follows the visible section on scroll, click and hash navigation. The left LineSidebar, top PillNav and current-section label share the same state. Original easing and spring mathematics are retained.
- Latest validation: synthetic-history rendering shows 4 defended events out of 10 as 40% in both the metric and tables; desktop/mobile rendering and scroll synchronization pass. `scripts/check-dashboard-ui.mjs` uses clearly synthetic data injected only in the test browser. `scripts/check-browser-integration.mjs` is the full real-extension test, but its execution is currently blocked on this PC by the Chrome for Testing side-by-side error; system Chrome does not expose the unpacked-extension test method. Do not interpret fixture UI validation as a completed real-extension end-to-end test.

- The dashboard is organized as a protection analysis workspace: weighted access risk, defense rate, observed/defended volume, access outcomes, AI review, activity pulse, signal mix, site intelligence, time forensics, cross-layer evidence, and minimum intervention.
- Site intelligence is ordered by weighted risk and includes severity, weighted risk index, defense rate, observation volume, dangerous access count, dominant signal, last activity, and recent-half versus previous-half trend. Time forensics includes severity, dominant signal, observed/defended counts, average event risk, average event confidence, and applied treatment.
- The left LineSidebar moves only the single nearest item. When the pointer leaves, only the current selection remains emphasized. The page heading is “추적 위험 분석”.

- The extension displays the current five-minute risk score, AI confidence, the three largest observed risk contributions, and a short AI explanation. Factor contributions are not percentages and are not added to the final score again.
- “최근 추적 데이터 보기” opens `https://privacy-mirror-analysis-blazetiger10-5946s-projects.vercel.app/dashboard/index.html`. The extension authorizes this specific tab to access local history through an isolated content bridge. Opening the website independently does not authorize history access. Refresh the extension after installing the updated ZIP.
- The dashboard offers Lightning and Ultra Research evaluation of the selected site and 24-hour/7-day range. Only anonymous aggregate counts go to the analysis endpoint. Actual site names and hour labels appear in the authorized dashboard's browser memory; they are not included in the AI request. Closing the dashboard removes the rendered view; the extension retains its seven-day local aggregates.
- Historical risk index = `(dangerous + suspicious × 0.5) / total × 100`. This is an access ratio, not a probability or a five-minute session risk score. Historical aggregates contain no API sequence and cannot establish causal data flow. Empty history does not trigger AI. Filter changes mark the previous evaluation as stale.
- Existing Vercel Production NVIDIA keys remain server-only. The app does not log or persist analysis bodies. Vercel and NVIDIA may retain operational metadata under their own policies; absolute infrastructure-wide zero retention is not guaranteed. The authorized remote dashboard can read displayed history, so its origin and scripts are part of the threat model.
- GhostFibers (OGL) and MagicRings (Three.js) preserve the supplied vertex/fragment shaders. CountUp uses the supplied Motion spring (`20 + 40 * (1 / duration)`, `100 * (1 / duration)`). LineSidebar, PillNav, CardSwap and Dock retain the supplied falloff, geometry, easing and spring equations. Lifecycle cleanup, keyboard support, zero-size guards and a viewport-coordinate correction for Dock are integration changes, not mathematical simplifications.
- Effects are bundled locally, without CDN JavaScript. Offscreen/hidden-page graphics stop rendering; CardSwap pauses offscreen/on hover/on focus. Decorative rings are disabled for reduced motion. UI animation is never used as a source of protection state. The dashboard itself is excluded from instrumentation.
- Build using `npm ci` followed by `npm run check`; `npm run dashboard` serves the built dashboard at `http://127.0.0.1:4173/dashboard/index.html` and the lab at `/test-pages/tracking-stress-lab.html`. Local dashboard preview has no extension bridge; use the remote dashboard opened by the extension for real statistics.
- The synthetic lab offers normal rendering, hidden fingerprint signals, and a bounded 30-second cross-layer sequence. It uses only synthetic storage values and a `.invalid` network destination. It never reads personal cookies or files. Repetition damping and five-minute retention mean large swings are not guaranteed, and stopping the lab does not instantly reset risk.


MIT
