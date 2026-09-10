'use client';
import { useEffect } from 'react';

// Progressive enhancement: content is visible even before JS, or without motion support.
export default function ScrollMotion() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations = new Map<Element, Animation>();
    const seen = new WeakSet<Element>();
    const targets = document.querySelectorAll<HTMLElement>([
      '[data-reveal]', '.talent-card', '.roster-note', '.news-card',
      '.footer-directory > *', '.contest-hero-copy', '.contest-hero-poster',
      '.contest-house-grid > *', '.contest-vote-heading', '.contestant-card',
      '.ticket-title-row', '.ticket-intro', '.status-toolbar', '.order-card',
      '.empty-state', '.ticket-panel', '.scan-step',
    ].join(','));
    const footer = document.querySelector<HTMLElement>('.footer-stage');
    const hero = document.querySelector<HTMLElement>('.hero');
    let frame = 0;
    function updateScrollEffects() {
      frame = 0;
      if (preference.matches) return;
      if (footer) {
        const bounds = footer.getBoundingClientRect();
        if (bounds.top < window.innerHeight && bounds.bottom > 0) {
          const progress = Math.max(0, Math.min(1, (window.innerHeight - bounds.top) / (window.innerHeight + bounds.height)));
          footer.style.setProperty('--orbit-angle', `${-16 + progress * 32}deg`);
        }
      }
      if (hero) {
        const bounds = hero.getBoundingClientRect();
        if (bounds.bottom > 0 && bounds.top < window.innerHeight) {
          const progress = Math.max(0, Math.min(1, -bounds.top / Math.max(1, bounds.height)));
          hero.style.setProperty('--hero-bg-shift', `${progress * 20}px`);
          hero.style.setProperty('--hero-logo-shift', `${progress * -14}px`);
        }
      }
    }
    function onScroll() {
      if (!frame && !preference.matches) frame = requestAnimationFrame(updateScrollEffects);
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting || seen.has(entry.target)) return;
        seen.add(entry.target);
        observer.unobserve(entry.target);
        if (preference.matches || entry.target.contains(document.activeElement)) return;
        const element = entry.target as HTMLElement;
        const siblings = [...(element.parentElement?.children ?? [])];
        const isCard = element.matches('.talent-card, .news-card, .contestant-card, .order-card');
        const fallbackDelay = isCard ? (siblings.indexOf(element) % (window.innerWidth < 600 ? 1 : 3)) * 75 : 0;
        const requestedDelay = Number.parseInt(element.dataset.revealDelay ?? '', 10);
        const delay = Number.isFinite(requestedDelay) ? requestedDelay : fallbackDelay;
        const direction = element.dataset.reveal ?? 'up';
        const startTransform = direction === 'left' ? 'translateX(-38px)' : direction === 'right' ? 'translateX(38px)' : direction === 'hero' ? 'translateY(18px) scale(.985)' : direction === 'wordmark' ? 'translateY(42px) scale(.985)' : 'translateY(36px)';
        const animation = element.animate([
          { opacity: 0, transform: startTransform },
          { opacity: 1, transform: 'translate(0) scale(1)' },
        ], { duration: direction === 'hero' ? 1050 : 800, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
        animations.set(element, animation);
        animation.onfinish = () => animations.delete(element);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(target => observer.observe(target));
    onScroll();
    function cancelMotion() {
      if (preference.matches) {
        animations.forEach(animation => animation.cancel());
        animations.clear();
        if (footer) footer.style.removeProperty('--orbit-angle');
        if (hero) {
          hero.style.removeProperty('--hero-bg-shift');
          hero.style.removeProperty('--hero-logo-shift');
        }
      }
    }
    function onFocus(event: FocusEvent) {
      animations.forEach((animation, element) => {
        if (event.target instanceof Node && element.contains(event.target)) {
          animation.cancel();
          animations.delete(element);
        }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    document.addEventListener('focusin', onFocus);
    preference.addEventListener('change', cancelMotion);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      animations.forEach(animation => animation.cancel());
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('focusin', onFocus);
      preference.removeEventListener('change', cancelMotion);
    };
  }, []);
  return null;
}
