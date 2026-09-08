import React, { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { createRoot } from 'react-dom/client';
import GhostFibers from './GhostFibers.jsx';
import MagicRings from './MagicRings.jsx';
import LineSidebar from './LineSidebar.jsx';
import CountUp from './CountUp.jsx';
import PillNav from './PillNav.jsx';
import CardSwap, { Card } from './CardSwap.jsx';
import Dock from './Dock.jsx';
import './effects.css';
import { SidebarNavigation, CategoryNavigation, observeSections } from './Navigation.jsx';

const roots = new Map();
const targets = new WeakMap();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function rootFor(element) { if (!roots.has(element)) roots.set(element, createRoot(element)); return roots.get(element); }
function OptionalMotion({ children }) {
  const [enabled, setEnabled] = useState(!reduced.matches);
  useEffect(() => { const change = () => setEnabled(!reduced.matches); reduced.addEventListener('change', change); return () => reduced.removeEventListener('change', change); }, []);
  return enabled ? children : null;
}
window.PMEffects = {
  reviewCards(analysis, summary) {
    const host = document.getElementById('review-cards');
    if (!host) return;
    if (!analysis) { rootFor(host).render(null); return; }
    rootFor(host).render(<OptionalMotion><CardSwap width={400} height={220} cardDistance={35} verticalDistance={40} pauseOnHover>
      <Card><h3>주요 발견</h3><p>{(analysis.explanation || [])[0]?.slice(0, 160) || '판단 근거가 부족합니다.'}</p></Card>
      <Card><h3>방어 결과</h3><p>관찰 {summary.totals.total}건 중 방어 {summary.totals.defended}건. 바꿔치기 {summary.totals.perturbed}건 · 링크 정리 {summary.totals.cleaned}건.</p></Card>
      <Card><h3>판단 한계</h3><p>{(analysis.uncertaintyReasons || [])[0]?.slice(0, 160) || '집계만으로 데이터 유출을 확정할 수 없습니다.'}</p></Card>
    </CardSwap></OptionalMotion>);
  },
  number(element, value) {
    if (!element) return;
    if (!Number.isFinite(value)) { targets.delete(element); rootFor(element).render(<span>–</span>); element.setAttribute('aria-label', '분석 데이터 없음'); return; }
    if (targets.get(element) === value) return;
    const from = targets.get(element) || 0; targets.set(element, value);
    element.setAttribute('aria-label', String(value));
    rootFor(element).render(reduced.matches || document.hidden ? <span>{value.toLocaleString()}</span> : <CountUp key={`${from}:${value}`} from={from} to={value} duration={2} separator="," />);
  },
  protection(active) {
    const host = document.getElementById('protection-animation');
    if (!host || targets.get(host) === active) return;
    targets.set(host, active); host.hidden = !active;
    rootFor(host).render(active ? <OptionalMotion><MagicRings /></OptionalMotion> : null);
  }
};
const dock = document.getElementById('action-dock');
if (dock) rootFor(dock).render(<MotionConfig reducedMotion="user"><Dock items={[
  { icon: '↻', label: '새로고침', onClick: () => document.getElementById('refresh')?.click() },
  { icon: '✦', label: 'AI 종합 평가', onClick: () => { document.getElementById('ai-review')?.scrollIntoView(); document.getElementById('run-history-ai')?.focus(); } },
  { icon: '⚗', label: '추적 신호 실험실', onClick: () => window.open(location.protocol.endsWith('extension:') ? 'http://127.0.0.1:4173/test-pages/tracking-stress-lab.html' : '../test-pages/tracking-stress-lab.html', '_blank', 'noopener') }
]} /></MotionConfig>);
document.querySelectorAll('[data-effect="rings"]').forEach((element, index) => {
  const fullScreen = element.classList.contains('ambient-layer');
  rootFor(element).render(<OptionalMotion><MagicRings color={index % 2 ? '#7c4dff' : '#fc42ff'} colorTwo={index % 2 ? '#42fcff' : '#635bff'} speed={fullScreen ? 0.22 : 0.6} ringCount={fullScreen ? 7 : 6} attenuation={fullScreen ? 7 : 10} lineThickness={fullScreen ? 1.2 : 2} baseRadius={fullScreen ? 0.2 : 0.35} radiusStep={fullScreen ? 0.14 : 0.1} scaleRate={fullScreen ? 0.22 : 0.1} opacity={fullScreen ? 0.45 : 0.8} noiseAmount={fullScreen ? 0.035 : 0.08} rotation={index * 18} ringGap={fullScreen ? 1.22 : 1.5} /></OptionalMotion>);
});
document.querySelectorAll('[data-effect="fibers"]').forEach((element, index) => {
  const fullScreen = element.classList.contains('ambient-layer');
  rootFor(element).render(<OptionalMotion><GhostFibers lineColor={index ? '#2b175c' : '#140E35'} glowColor={index ? '#4f52c5' : '#3437A0'} speed={fullScreen ? 0.08 : 0.18} scale={fullScreen ? 1.25 : 1.8} rotation={index * 12} rotationSpeed={fullScreen ? 0.08 : 0.2} layers={fullScreen ? 6 : 4} waveAmplitude={fullScreen ? 0.012 : 0.015} waveFrequency={3} waveSpeed={0.15} layerSpeed={0.08} twist={0.1} twistFrequency={5} twistSpeed={1.2} lineFrequency={5} lineSpacing={2} lineSharpness={16} glowFalloff={10} glowIntensity={fullScreen ? 1.25 : 1.6} brightness={fullScreen ? 1.5 : 2} blueBoost={1.25} vignette={fullScreen ? 0.45 : 0.8} grain={fullScreen ? 0.025 : 0.05} dpr={fullScreen ? 0.75 : 1} fps={fullScreen ? 30 : 45} /></OptionalMotion>);
});
const sidebar = document.getElementById('line-sidebar');
const categories = document.getElementById('category-nav');
if (categories) {
  rootFor(categories).render(<CategoryNavigation />);
}
if (sidebar) {
  rootFor(sidebar).render(<SidebarNavigation />);
  const stopObserving = observeSections();
  window.addEventListener('pagehide', stopObserving, { once: true });
}
window.addEventListener('pagehide', () => { for (const root of roots.values()) root.unmount(); roots.clear(); }, { once: true });
