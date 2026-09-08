import React, { useEffect, useState } from 'react';
import LineSidebar from './LineSidebar.jsx';
import PillNav from './PillNav.jsx';

const sections = ['overview', 'ai-review', 'history', 'sites', 'graph', 'events'];
const labels = ['전체 요약', 'AI 종합 평가', '시간대별 통계', '사이트별 통계', '근거 그래프', '최근 신호'];
let current = 0;
const listeners = new Set();
function select(index) {
  if (index === current) return;
  current = index;
  const caption = document.getElementById('current-section');
  if (caption) caption.textContent = labels[index];
  listeners.forEach(notify => notify(index));
}
function useSection() {
  const [index, setIndex] = useState(current);
  useEffect(() => { listeners.add(setIndex); return () => listeners.delete(setIndex); }, []);
  return index;
}
export function SidebarNavigation() {
  const index = useSection();
  return <LineSidebar items={labels} activeIndex={index} markerLength={28} maxShift={16} onItemClick={next => {
    select(next);
    history.replaceState(null, '', '#' + sections[next]);
    document.getElementById(sections[next])?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }} />;
}
const tabs = [{ label: '전체 요약', href: '#overview' }, { label: 'AI 평가', href: '#ai-review' }, { label: '사이트·시간', href: '#history' }, { label: '상세 근거', href: '#graph' }];
export function CategoryNavigation() {
  const index = useSection();
  const activeHref = index === 3 ? '#history' : index === 5 ? '#graph' : '#' + sections[index];
  return <PillNav items={tabs} activeHref={activeHref} baseColor="#b8a2ff" pillColor="#121620" pillTextColor="#e5eafa" hoveredPillTextColor="#10131a" initialLoadAnimation={false} />;
}
export function observeSections() {
  let frame = 0;
  function update() {
    frame = 0;
    const threshold = Math.min(210, innerHeight * 0.3);
    let next = 0;
    sections.forEach((id, index) => { if (document.getElementById(id)?.getBoundingClientRect().top <= threshold) next = index; });
    select(next);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  schedule();
  return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); window.removeEventListener('hashchange', schedule); };
}
