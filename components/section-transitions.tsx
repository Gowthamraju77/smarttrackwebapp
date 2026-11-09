"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

type Transition = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void };
type TransitionDocument = Document & { startViewTransition?: (update: () => Promise<void>) => Transition };
const Context = createContext<(href: string) => void>(() => {});

/** Survives sibling Next routes, so every section change gets a real transition. */
export function SectionTransitions({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const previous = useRef(pathname);
  const active = useRef<Transition | null>(null);
  const complete = useRef<(() => void) | null>(null);
  const destination = useRef<string | null>(null);
  const generation = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback((href: string) => {
    if (new URL(href, location.href).pathname === location.pathname) { router.push(href); return; }
    active.current?.skipTransition(); complete.current?.();
    complete.current = null; destination.current = null;
    const request = ++generation.current;
    if (timeout.current) clearTimeout(timeout.current);
    const doc = document as TransitionDocument;
    if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) { active.current = null; router.push(href); return; }
    const transition = doc.startViewTransition(() => new Promise<void>(resolve => {
      if (request !== generation.current) { resolve(); return; }
      complete.current = resolve;
      destination.current = new URL(href, location.href).pathname;
      router.push(href);
      timeout.current = setTimeout(() => { resolve(); transition.skipTransition(); if (request === generation.current) { complete.current = null; destination.current = null; } }, 3500);
    }));
    active.current = transition;
    void transition.ready.catch(() => {});
    void transition.updateCallbackDone.catch(() => {});
    void transition.finished.catch(() => {}).finally(() => { if (active.current === transition) active.current = null; });
  }, [router]);

  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const requested = destination.current === pathname;
    if (requested) { complete.current?.(); complete.current = null; destination.current = null; if (timeout.current) clearTimeout(timeout.current); }
    if (destination.current) return;
    // Also covers browser Back/Forward and navigation initiated outside links.
    const stage = document.querySelector<HTMLElement>("[data-workspace-view]");
    if (!stage || requested || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    active.current?.skipTransition(); active.current = null;
    const motion = getComputedStyle(stage);
    const durationToken = motion.getPropertyValue("--motion-slow").trim() || "420ms";
    const duration = parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
    const animation = stage.animate(
      [{ opacity: 0, transform: "translateY(12px) scale(.995)" }, { opacity: 1, transform: "none" }],
      { duration: Number.isFinite(duration) ? Math.max(0, duration) : 420, easing: motion.getPropertyValue("--motion-ease").trim() || "cubic-bezier(.22,1,.36,1)" },
    );
    return () => animation.cancel();
  }, [pathname]);

  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self" || anchor.getAttribute("aria-disabled") === "true") return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      event.preventDefault(); navigate(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", click, true);
    const pop = () => { generation.current++; active.current?.skipTransition(); active.current = null; complete.current?.(); complete.current = null; destination.current = null; if (timeout.current) clearTimeout(timeout.current); };
    window.addEventListener("popstate", pop);
    return () => { document.removeEventListener("click", click, true); window.removeEventListener("popstate", pop); pop(); };
  }, [navigate]);
  return <Context.Provider value={navigate}>{children}</Context.Provider>;
}
export function useSectionNavigation() { return useContext(Context); }
