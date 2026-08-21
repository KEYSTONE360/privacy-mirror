# Zero-retention deployment checklist

애플리케이션 코드의 무저장 설계와 실제 인프라 전체의 무로그 상태는 같은 주장이 아닙니다. 배포마다 아래 항목을 증거와 함께 확인합니다.

## Application

- [ ] AI endpoint는 POST body만 받고 query string을 거부한다.
- [ ] request/response body logging이 없다.
- [ ] error handler가 payload, URL, header를 출력하지 않는다.
- [ ] DB, filesystem write, persistent Redis, durable queue, object storage가 없다.
- [ ] analytics, APM breadcrumb, crash reporter가 없다.
- [ ] payload schema가 raw URL/cookie/storage/token/Canvas/body 필드를 거부한다.
- [ ] 64 KiB body limit과 request timeout이 적용된다.
- [ ] 모든 응답에 `Cache-Control: no-store`가 있다.
- [ ] core dump와 swap 정책을 운영 환경에서 검토했다.

## TLS / proxy / hosting

- [ ] client→server와 server→NVIDIA가 HTTPS다.
- [ ] reverse proxy access log를 끄거나 최소화했다.
- [ ] proxy error log에 request body·query가 없다.
- [ ] CDN/WAF request sampling, bot analytics, payload inspection 정책을 확인했다.
- [ ] provider retention 기간과 삭제 정책을 문서화했다.
- [ ] secret은 provider secret manager에 있고 build log에 출력되지 않는다.
- [ ] NVIDIA의 적용 약관·retention·privacy practice를 사용자에게 링크했다.

## Automated evidence

- `npm test`: forbidden raw fields, server persistence dependency, AI failure, hallucination 검사
- `npm run build`: extension/dashboard artifact에서 secret-like marker 검사
- 배포 전 별도 테스트 payload를 보내고 application·proxy·provider log 화면에서 payload가 검색되지 않는지 확인

IP 주소, TLS handshake, timestamp, byte count 등 인프라 운영 메타데이터까지 0이라고 보장하지 않습니다.
