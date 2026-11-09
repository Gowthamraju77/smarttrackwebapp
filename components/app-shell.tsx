"use client";

import Link from "next/link";
import { useSectionNavigation } from "./section-transitions";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react";
import {
  Activity, ArrowDownLeft, ArrowUpRight, Bell, ChevronDown, ChevronRight,
  CircleHelp, Compass, Cpu, FileClock, History, LayoutDashboard, Map, Menu,
  Monitor, Radar, Search, Settings, ShieldCheck, Shield, SlidersHorizontal,
  Users, X,
} from "lucide-react";
import { DashboardView } from "@/components/dashboard-view";
import { SectionView } from "@/components/section-view";
import { LiveConnectionBadge, LiveConnectionPanel } from "@/components/live/live-connection-panel";
import { ContactBadge } from "@/components/contacts/notification-settings";
import styles from "./shell.module.css";

export type ViewKey =
  | "dashboard" | "map" | "journeys" | "insights" | "analytics"
  | "alerts" | "devices" | "settings" | "navigation" | "display"
  | "team" | "security" | "activity" | "help";

type NavItem = {
  label: string;
  href: string;
  view: ViewKey;
  icon: typeof LayoutDashboard;
  description: string;
  keywords?: string;
};
type NavGroup = { label: string; items: NavItem[]; collapsible?: boolean };

export const navGroups: NavGroup[] = [
  {
    label: "Explore",
    items: [
      { label: "Dashboard", href: "/", view: "dashboard", icon: LayoutDashboard, description: "Your device signals, at a glance", keywords: "overview home" },
      { label: "Live map", href: "/map", view: "map", icon: Map, description: "Explore captured positions on the map", keywords: "gps location position tracking" },
      { label: "Journey", href: "/journeys", view: "journeys", icon: FileClock, description: "Find places and compare road routes", keywords: "route trip plan start destination" },
      { label: "Navigation", href: "/navigation", view: "navigation", icon: Compass, description: "Follow your selected route and journey timer", keywords: "route directions gps timer" },
    ],
  },
  {
    label: "Signals",
    items: [
      { label: "Trust & safety", href: "/insights", view: "insights", icon: ShieldCheck, description: "Understand the evidence behind your score", keywords: "quality reliability trust score insights" },
      { label: "Alerts", href: "/alerts", view: "alerts", icon: Bell, description: "Review device signal conditions", keywords: "warnings notifications" },
      { label: "Activity log", href: "/activity", view: "activity", icon: History, description: "Review the latest device observations", keywords: "events stream history" },
      { label: "Analytics", href: "/analytics", view: "analytics", icon: Activity, description: "A closer look at captured signal data", keywords: "metrics statistics measurements" },
    ],
  },
  {
    label: "Workspace",
    collapsible: true,
    items: [
      { label: "Devices", href: "/devices", view: "devices", icon: Cpu, description: "Inspect your connected device", keywords: "esp32 sensors hardware" },
      { label: "Device display", href: "/display", view: "display", icon: Monitor, description: "Display information and diagnostics", keywords: "screen panel tft" },
      { label: "Team", href: "/team", view: "team", icon: Users, description: "Workspace membership information", keywords: "people members access" },
      { label: "Security", href: "/security", view: "security", icon: Shield, description: "Review workspace access and protection", keywords: "privacy permissions authentication" },
    ],
  },
];

const utilityItems: NavItem[] = [
  { label: "Settings", href: "/settings", view: "settings", icon: Settings, description: "Connection and workspace preferences", keywords: "configure usb setup" },
  { label: "Help center", href: "/help", view: "help", icon: CircleHelp, description: "Find your way around SmartTrack", keywords: "support guide documentation" },
];
const allNavItems = [...navGroups.flatMap((group) => group.items), ...utilityItems];

function getNavItem(view: string) {
  return allNavItems.find((item) => item.view === view) ?? allNavItems[0];
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Radar size={22} strokeWidth={1.9} /></span>;
}

/** A decorative spatial mark, independent of device positions or signal state. */
function TrackingGlyph({ className = "" }: { className?: string }) {
  return <svg className={`${styles.trackingGlyph} ${className}`} viewBox="0 0 88 86" fill="none" aria-hidden="true" focusable="false">
    <g className={styles.planeBack}><path d="M8 58 44 38 80 58 44 78Z" /><path d="m26 48 36 20m-54-10 36 20 36-20" /></g>
    <g className={styles.planeMiddle}><path d="M8 48 44 28 80 48 44 68Z" /><path d="m8 48 36 20 36-20" /></g>
    <g className={styles.planeFront}><path d="M8 38 44 18 80 38 44 58Z" /><ellipse cx="44" cy="38" rx="20" ry="11" /><path d="M17 38h54M44 23v30" /></g>
    <path className={styles.glyphBeam} d="M44 38V8" />
    <circle className={styles.glyphNode} cx="44" cy="8" r="3" />
    <circle className={styles.glyphOrigin} cx="44" cy="38" r="2" />
  </svg>;
}

function NavLink({ item, activeView, onNavigate }: { item: NavItem; activeView: ViewKey; onNavigate?: () => void }) {
  const Icon = item.icon;
  const isActive = activeView === item.view;
  return (
    <Link className={`nav-item${isActive ? " nav-item-active" : ""}`} href={item.href}
      onClick={onNavigate} aria-current={isActive ? "page" : undefined}>
      <span className={styles.navIcon}><Icon size={17} strokeWidth={isActive ? 2 : 1.7} aria-hidden="true" /></span>
      <span>{item.label}</span>
      {isActive && <span className={styles.activeIndicator} aria-hidden="true" />}
    </Link>
  );
}

type SidebarProps = {
  activeView: ViewKey;
  onNavigate?: () => void;
  onClose?: () => void;
  closeButtonRef?: Ref<HTMLButtonElement>;
};

function Sidebar({ activeView, onNavigate, onClose, closeButtonRef }: SidebarProps) {
  return (
    <aside className={`sidebar ${styles.sidebar}`} aria-label="SmartTrack workspace">
      <div className="sidebar-header">
        <Link className="brand" href="/" onClick={onNavigate} aria-label="SmartTrack home">
          <BrandMark />
          <span>SmartTrack<span className={styles.brandCaption}>Field intelligence.</span></span>
        </Link>
        {onClose && (
          <button className={styles.drawerClose} ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close navigation" autoFocus>
            <X size={19} aria-hidden="true" />
          </button>
        )}
      </div>

      <Link className="workspace-switcher" href="/map" onClick={onNavigate} aria-label="Open ESP32 map">
        <span className={styles.workspaceGlyph}><TrackingGlyph /></span>
        <span className="workspace-copy"><span className="workspace-label">FIELD WORKSPACE</span><strong>ESP32-S3</strong></span>
        <ChevronRight size={15} aria-hidden="true" />
      </Link>

      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navGroups.map((group) => {
          const items = <div className="nav-items">{group.items.map((item) => <NavLink key={item.view} item={item} activeView={activeView} onNavigate={onNavigate} />)}</div>;
          return group.collapsible ? (
            <details className={`nav-group ${styles.navDisclosure}`} key={`${group.label}-${activeView}`} open={group.items.some((item) => item.view === activeView)}>
              <summary className={styles.disclosureSummary}><span>{group.label}</span><ChevronDown size={14} aria-hidden="true" /></summary>
              {items}
            </details>
          ) : (
            <div className="nav-group" key={group.label}><p className="nav-group-label">{group.label}</p>{items}</div>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <nav className={styles.utilityNav} aria-label="Workspace support">
          {utilityItems.map((item) => <NavLink key={item.view} item={item} activeView={activeView} onNavigate={onNavigate} />)}
        </nav>
        <div className={styles.sidebarSignature}>
          <span className={styles.signatureMark} aria-hidden="true"><span /><span /><span /></span>
          <span>Made for a clearer view.</span>
          <ArrowUpRight size={13} aria-hidden="true" />
        </div>
      </div>
    </aside>
  );
}

export function AppShell({ activeView: rawActiveView = "dashboard", children }: { activeView?: string; children?: ReactNode }) {
  const activeView = getNavItem(rawActiveView).view;
  const activeItem = getNavItem(activeView);
  const ActiveIcon = activeItem.icon;
  const navigate = useSectionNavigation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [shortcut, setShortcut] = useState("Ctrl K");
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDialogElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchReturnRef = useRef<HTMLElement | null>(null);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingItems = allNavItems.filter((item) => terms.every((term) => `${item.label} ${item.description} ${item.keywords ?? ""}`.toLowerCase().includes(term)));
  const searchResults = terms.length ? matchingItems : allNavItems.slice(0, 6);

  function closeDrawer() {
    drawerRef.current?.close();
    setSidebarOpen(false);
  }

  function openDrawer() {
    const drawer = drawerRef.current;
    if (!drawer || drawer.open || !window.matchMedia("(max-width: 860px)").matches) return;
    menuButtonRef.current?.focus({ preventScroll: true });
    drawer.showModal();
    closeButtonRef.current?.focus();
    setSidebarOpen(true);
  }

  function openSearch() {
    const dialog = searchRef.current;
    if (!dialog || dialog.open) return;
    if (drawerRef.current?.open) closeDrawer();
    // Pointer activation does not focus buttons consistently across browsers.
    // This entry point always comes from the visible search trigger.
    searchButtonRef.current?.focus({ preventScroll: true });
    searchReturnRef.current = searchButtonRef.current;
    setQuery("");
    dialog.showModal();
    searchInputRef.current?.focus();
    setSearchOpen(true);
  }

  function closeSearch() {
    searchRef.current?.close();
    setSearchOpen(false);
  }

  function searchKeys(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      // Search inputs can consume Escape to clear text before a native dialog
      // receives its cancel action. Dismiss consistently, including in Edge.
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.key === "Enter" && event.target === searchInputRef.current && searchResults[0]) {
      event.preventDefault();
      closeSearch();
      navigate(searchResults[0].href);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("[data-search-result]"));
    if (!links.length) return;
    event.preventDefault();
    const current = links.findIndex((link) => link === document.activeElement);
    const next = current === -1 ? (event.key === "ArrowDown" ? 0 : links.length - 1)
      : (current + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
    links[next]?.focus();
  }

  useEffect(() => {
    setShortcut(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K");
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || event.altKey) return;
      event.preventDefault();
      if (searchRef.current?.open) searchRef.current.close();
      else {
        drawerRef.current?.close();
        setSidebarOpen(false);
        searchReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : searchButtonRef.current;
        setQuery("");
        searchRef.current?.showModal();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!sidebarOpen && !searchOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [sidebarOpen, searchOpen]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 860px)");
    const closeOnDesktop = () => {
      if (!mobileViewport.matches) {
        drawerRef.current?.close();
        setSidebarOpen(false);
      }
    };
    mobileViewport.addEventListener("change", closeOnDesktop);
    return () => mobileViewport.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    drawerRef.current?.close();
    searchRef.current?.close();
    setSidebarOpen(false);
    setSearchOpen(false);
  }, [rawActiveView]);

  return (
    <div className={`app-shell ${styles.shell}`}>
      <div className={`sidebar-drawer ${styles.desktopSidebar}`}><Sidebar activeView={activeView} /></div>

      <dialog className={styles.mobileDrawer} id="mobile-navigation" ref={drawerRef}
        aria-label="Workspace navigation" aria-modal="true" onClose={() => setSidebarOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDrawer();
        }}>
        <Sidebar activeView={activeView} onNavigate={closeDrawer} onClose={closeDrawer} closeButtonRef={closeButtonRef} />
      </dialog>

      <dialog className={styles.searchDialog} id="workspace-search" ref={searchRef}
        aria-labelledby="workspace-search-title" aria-describedby="workspace-search-description" aria-modal="true"
        onKeyDown={searchKeys}
        onClose={() => { setSearchOpen(false); searchReturnRef.current?.focus({ preventScroll: true }); }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeSearch();
        }}>
        <div className={styles.searchHeading}>
          <div className={styles.searchHeadingCopy}><span className={styles.searchEyebrow}>A SHORTER WAY THERE</span><h2 id="workspace-search-title">Find your next view.</h2></div>
          <TrackingGlyph className={styles.searchGlyph} />
          <button className={styles.searchClose} type="button" onClick={closeSearch} aria-label="Close search"><X size={19} aria-hidden="true" /></button>
        </div>
        <p id="workspace-search-description" className={styles.srOnly}>Search workspace sections. Use the arrow keys to browse results and Enter to open a section.</p>
        <div className={styles.searchInputWrap}>
          <Search size={21} strokeWidth={1.8} aria-hidden="true" />
          <input ref={searchInputRef} type="search" aria-label="Search workspace sections" placeholder="Map, trust score, settings…"
            autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} />
          <kbd>esc</kbd>
        </div>
        <div className={styles.searchResultsHeading}><span>{terms.length ? "MATCHING SECTIONS" : "QUICK NAVIGATION"}</span><span role="status" aria-live="polite">{searchResults.length} {searchResults.length === 1 ? "result" : "results"}</span></div>
        {searchResults.length ? (
          <ul className={styles.searchResults} aria-label="Workspace sections">
            {searchResults.map((item) => {
              const Icon = item.icon;
              return <li key={item.view}><Link href={item.href} className={styles.searchResult} data-search-result onClick={closeSearch}>
                <span className={styles.resultIcon}><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                <span className={styles.resultCopy}><strong>{item.label}</strong><span>{item.description}</span></span>
                <ArrowUpRight className={styles.resultArrow} size={17} aria-hidden="true" />
              </Link></li>;
            })}
          </ul>
        ) : (
          <div className={styles.searchEmpty}><Search size={26} aria-hidden="true" /><strong>No matching sections</strong><p>Try “map”, “trust”, or “settings”.</p><button type="button" onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}>Clear search</button></div>
        )}
        <div className={styles.searchFooter}><span><kbd>↑</kbd><kbd>↓</kbd> to move <kbd><ArrowDownLeft size={11} aria-hidden="true" /></kbd> to open</span><span>{allNavItems.length} workspace sections</span></div>
      </dialog>

      <div className={`main-shell ${styles.mainShell}`}>
        <header className={`topbar ${styles.topbar}`}>
          <div className="topbar-left">
            <button className="mobile-menu" ref={menuButtonRef} type="button" onClick={openDrawer}
              aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls="mobile-navigation" aria-haspopup="dialog">
              <Menu size={21} aria-hidden="true" />
            </button>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <span className={styles.routeIcon} aria-hidden="true"><ActiveIcon size={14} strokeWidth={1.7} /></span>
              <Link href="/" className={styles.workspaceCrumb}>Workspace</Link>
              <ChevronRight size={13} className={styles.workspaceCrumb} aria-hidden="true" />
              <strong aria-current="page" title={activeItem.label}>{activeItem.label}</strong>
            </nav>
          </div>
          <div className="topbar-actions">
            <button className={styles.searchTrigger} ref={searchButtonRef} type="button" onClick={openSearch}
              aria-label="Search workspace sections" aria-keyshortcuts="Control+k Meta+k" aria-controls="workspace-search" aria-haspopup="dialog" aria-expanded={searchOpen}>
              <Search size={17} strokeWidth={1.8} aria-hidden="true" /><span>Search workspace</span><kbd>{shortcut}</kbd>
            </button>
            <div className={`system-status ${styles.systemStatus}`}><LiveConnectionBadge /></div>
            <Link className={`icon-button ${styles.alertButton}`} href="/alerts" aria-label="View device signal alerts"><Bell size={18} strokeWidth={1.8} aria-hidden="true" /></Link>
            <Link className={`topbar-profile ${styles.profile}`} href="/settings" aria-label="Open device workspace settings">
              <ContactBadge /><SlidersHorizontal size={15} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <main className={`main-content ${styles.mainContent}`} id="main-content" tabIndex={-1}>
          {activeView !== "map" && activeView !== "journeys" && activeView !== "navigation" && <LiveConnectionPanel />}
          <div className={styles.routeStage} key={activeView} data-workspace-view={activeView}>
            {children ?? (activeView === "dashboard" ? <DashboardView /> : <SectionView activeView={activeView} />)}
          </div>
          <footer className={styles.workspaceFooter}><span><Radar size={13} aria-hidden="true" />SmartTrack workspace</span><Link href="/help">A little guidance <ArrowUpRight size={12} aria-hidden="true" /></Link></footer>
        </main>
      </div>
    </div>
  );
}
