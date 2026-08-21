# Architecture

```text
Web page MAIN world
  ├─ Canvas / WebGL / digest / storage metadata hooks
  └─ synchronous perturbation only after pre-derived seed arrives
          ↓ bounded CustomEvent batch
Isolated content bridge
          ↓ runtime message
Browser adapter (Chrome / Firefox)
          ↓
SessionAnalyzer
  ├─ FingerprintSignalProfiler
  ├─ RiskEngine / Confidence evidence
  ├─ EvidenceGraph / TokenLineage
  ├─ CompatibilityGuard
  └─ Counterfactual + Minimum Intervention
          ↓ optional, asynchronous, ambiguous cases only
Evidence Sanitizer → HTTPS server → NVIDIA NIM
          ↓ validated structured response
Consensus Engine → local optimizer (final authority)
```

브라우저 hook은 AI나 HMAC 완료를 기다리지 않습니다. HMAC은 background에서 seed·token lineage 생성에만 사용되고, 동기 Canvas 경로는 미리 전달된 seed material로 계산합니다.
