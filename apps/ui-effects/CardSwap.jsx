import React, { Children, cloneElement, forwardRef, isValidElement, useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import './CardSwap.css';
export const Card = forwardRef(({ customClass, ...rest }, ref) => <div ref={ref} {...rest} className={`card ${customClass ?? ''} ${rest.className ?? ''}`.trim()} />);
Card.displayName = 'Card';
const makeSlot = (i, distX, distY, total) => ({ x: i * distX, y: -i * distY, z: -i * distX * 1.5, zIndex: total - i });
const placeNow = (el, slot, skew) => gsap.set(el, { x: slot.x, y: slot.y, z: slot.z, xPercent: -50, yPercent: -50, skewY: skew, transformOrigin: 'center center', zIndex: slot.zIndex, force3D: true });
export default function CardSwap({ width = 500, height = 400, cardDistance = 60, verticalDistance = 70, delay = 5000, pauseOnHover = false, onCardClick, skewAmount = 6, easing = 'elastic', children }) {
  const config = easing === 'elastic' ? { ease: 'elastic.out(0.6,0.9)', durDrop: 2, durMove: 2, durReturn: 2, promoteOverlap: 0.9, returnDelay: 0.05 } : { ease: 'power1.inOut', durDrop: 0.8, durMove: 0.8, durReturn: 0.8, promoteOverlap: 0.45, returnDelay: 0.2 };
  const childArr = useMemo(() => Children.toArray(children), [children]);
  const refs = useMemo(() => childArr.map(() => React.createRef()), [childArr.length]);
  const order = useRef([]), tlRef = useRef(null), intervalRef = useRef(), container = useRef(null);
  useEffect(() => {
    const total = refs.length;
    order.current = Array.from({ length: total }, (_, i) => i);
    refs.forEach((r, i) => placeNow(r.current, makeSlot(i, cardDistance, verticalDistance, total), skewAmount));
    const swap = () => {
      if (order.current.length < 2 || tlRef.current?.isActive()) return;
      const [front, ...rest] = order.current, elFront = refs[front].current;
      const tl = gsap.timeline(); tlRef.current = tl;
      tl.to(elFront, { y: '+=500', duration: config.durDrop, ease: config.ease });
      tl.addLabel('promote', `-=${config.durDrop * config.promoteOverlap}`);
      rest.forEach((idx, i) => {
        const el = refs[idx].current, slot = makeSlot(i, cardDistance, verticalDistance, refs.length);
        tl.set(el, { zIndex: slot.zIndex }, 'promote');
        tl.to(el, { x: slot.x, y: slot.y, z: slot.z, duration: config.durMove, ease: config.ease }, `promote+=${i * 0.15}`);
      });
      const backSlot = makeSlot(refs.length - 1, cardDistance, verticalDistance, refs.length);
      tl.addLabel('return', `promote+=${config.durMove * config.returnDelay}`);
      tl.call(() => gsap.set(elFront, { zIndex: backSlot.zIndex }), undefined, 'return');
      tl.to(elFront, { x: backSlot.x, y: backSlot.y, z: backSlot.z, duration: config.durReturn, ease: config.ease }, 'return');
      tl.call(() => { order.current = [...rest, front]; });
    };
    const node = container.current;
    let visible = false, hovering = false;
    const pause = () => { tlRef.current?.pause(); clearInterval(intervalRef.current); };
    const sync = () => {
      pause();
      if (!visible || document.hidden || hovering) return;
      if (tlRef.current) tlRef.current.play(); else swap();
      intervalRef.current = setInterval(swap, delay);
    };
    const enter = () => { hovering = true; sync(); }, leave = () => { hovering = false; sync(); };
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }); io.observe(node);
    document.addEventListener('visibilitychange', sync);
    if (pauseOnHover) { node.addEventListener('mouseenter', enter); node.addEventListener('mouseleave', leave); node.addEventListener('focusin', enter); node.addEventListener('focusout', leave); }
    return () => { pause(); tlRef.current?.kill(); tlRef.current = null; io.disconnect(); document.removeEventListener('visibilitychange', sync); node.removeEventListener('mouseenter', enter); node.removeEventListener('mouseleave', leave); node.removeEventListener('focusin', enter); node.removeEventListener('focusout', leave); };
  }, [refs, cardDistance, verticalDistance, delay, pauseOnHover, skewAmount, easing]);
  const rendered = childArr.map((child, i) => isValidElement(child) ? cloneElement(child, { key: i, ref: refs[i], style: { width, height, ...(child.props.style ?? {}) }, onClick: e => { child.props.onClick?.(e); onCardClick?.(i); } }) : child);
  return <div ref={container} className="card-swap-container" style={{ width, height }}>{rendered}</div>;
}
