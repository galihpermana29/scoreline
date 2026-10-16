import { LayoutGroup, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { TOP_CATEGORIES, extraCategories, type Category } from "../domain/categories";
import { SPORT_ICON, type Match } from "../domain/match";
import { browsePath, navigate, type Route } from "../lib/router";
import { Icon, type IconName } from "./icons";
import { ScorelineBadge } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const CATEGORY_ICON: Record<string, IconName> = {
  live: "live",
  football: "football",
  badminton: "badminton",
  basketball: "basketball",
  f1: "flag",
};

const categoryPath = (category: Category): string =>
  category.slug === "live" ? browsePath({ kind: "live" }) : browsePath({ kind: "sport", slug: category.slug });

const isCategoryActive = (route: Route, category: Category): boolean =>
  category.slug === "live" ? route.kind === "live" : route.kind === "sport" && route.slug === category.slug;

const NAV_SPRING = { type: "spring", bounce: 0, duration: 0.4 } as const;

const NavItem = ({
  label,
  active,
  path,
  icon,
  badge,
  layoutId,
}: {
  label: string;
  active: boolean;
  path: string;
  icon: React.ReactNode;
  badge?: number;
  layoutId: string;
}) => (
  <button
    className={`nav-item${active ? " is-active" : ""}${badge !== undefined && badge > 0 ? " has-badge" : ""}`}
    aria-current={active ? "page" : undefined}
    title={badge !== undefined && badge > 0 ? `${label} (${badge})` : label}
    onClick={() => navigate(path)}
  >
    {active ? <motion.span layoutId={layoutId} className="nav-active" transition={NAV_SPRING} /> : null}
    <span className="nav-icon">{icon}</span>
    <span className="nav-label">{label}</span>
    {badge !== undefined && badge > 0 ? <span className="nav-badge">{badge}</span> : null}
  </button>
);

const SportGlyph = ({ sport }: { sport: string }) => (
  <span className="nav-emoji" aria-hidden>
    {SPORT_ICON[sport] ?? "🏆"}
  </span>
);

/**
 * The sidebar's search field is the search surface on desktop: typing
 * navigates to the search screen live, so results appear under the field
 * as you type. The first keystroke pushes a history entry, the rest replace
 * it, so Back returns to where the search started, not through every letter.
 */
const SearchField = ({ route, rail }: { route: Route; rail: boolean }) => {
  const query = route.kind === "search" ? route.query : "";
  const [value, setValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (route.kind !== "search") setValue("");
    else setValue(route.query);
  }, [route]);

  const onChange = (next: string) => {
    setValue(next);
    navigate(browsePath({ kind: "search", query: next }), { replace: route.kind === "search", keepScroll: true });
  };

  // In the rail the field is just its icon: one row, same geometry, so the
  // collapse never swaps elements. Clicking it opens the search screen.
  return (
    <label
      className={`nav-item sidebar-search${route.kind === "search" ? " is-active" : ""}`}
      title="Search"
      onClick={rail ? () => navigate(browsePath({ kind: "search", query: "" })) : undefined}
    >
      <span className="nav-icon">
        <Icon name="search" size={rail ? 20 : 16} />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder="Search"
        aria-label="Search matches and leagues"
        aria-hidden={rail || undefined}
        tabIndex={rail ? -1 : 0}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (route.kind !== "search") navigate(browsePath({ kind: "search", query: value }), { keepScroll: true });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
            inputRef.current?.blur();
          }
        }}
      />
      {value && !rail ? (
        <button className="sidebar-search-clear" aria-label="Clear search" onClick={() => onChange("")}>
          <Icon name="clear" size={14} />
        </button>
      ) : null}
    </label>
  );
};

/**
 * Desktop sidebar / tablet rail. `rail` is the collapsed, icon-only form;
 * `onToggle` is absent when the width is forced (tablet), so the control
 * only appears where the user can actually change it.
 */
export const Sidebar = ({
  route,
  matches,
  rail,
  onToggle,
}: {
  route: Route;
  matches: readonly Match[];
  rail: boolean;
  onToggle?: () => void;
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const extras = extraCategories(matches);
  const liveCount = matches.filter((match) => match.status.kind === "live").length;

  return (
    <aside className={`sidebar${rail ? " is-rail" : ""}`} aria-label="Sections">
      <div className="sidebar-top">
        {onToggle ? (
          <button
            className="nav-item sidebar-toggle"
            aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!rail}
            title={rail ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggle}
          >
            <span className="nav-icon">
              <Icon name="sidebar" size={20} />
            </span>
          </button>
        ) : null}
        <SearchField route={route} rail={rail} />
      </div>

      <LayoutGroup id="sidebar">
        <nav className="sidebar-nav">
          <NavItem
            label="Home"
            path={browsePath({ kind: "home" })}
            active={route.kind === "home"}
            icon={<Icon name="home" />}
            layoutId="sidebar-active"
          />
          {TOP_CATEGORIES.map((category) => (
            <NavItem
              key={category.slug}
              label={category.label}
              path={categoryPath(category)}
              active={isCategoryActive(route, category)}
              icon={<Icon name={CATEGORY_ICON[category.slug] ?? "sport"} />}
              badge={category.slug === "live" ? liveCount : undefined}
              layoutId="sidebar-active"
            />
          ))}

          <div className="sidebar-heading">Browse</div>
          <NavItem
            label="Leagues"
            path={browsePath({ kind: "leagues", leagueId: null })}
            active={route.kind === "leagues"}
            icon={<Icon name="trophy" />}
            layoutId="sidebar-active"
          />
          <NavItem
            label="Tables"
            path={browsePath({ kind: "tables", code: null })}
            active={route.kind === "tables"}
            icon={<Icon name="table" />}
            layoutId="sidebar-active"
          />

          {extras.length > 0 ? (
            <>
              <button
                className={`sidebar-heading sidebar-heading-toggle${moreOpen ? " is-open" : ""}`}
                aria-expanded={moreOpen}
                title="More sports"
                onClick={() => setMoreOpen((open) => !open)}
              >
                <span className="nav-icon">
                  <Icon name="chevron-down" size={14} />
                </span>
                <span className="nav-label">More sports</span>
              </button>
              <div className={`sidebar-more${moreOpen ? " is-open" : ""}`}>
                <div className="sidebar-more-inner">
                  {extras.map((category) => (
                    <NavItem
                      key={category.slug}
                      label={category.label}
                      path={categoryPath(category)}
                      active={isCategoryActive(route, category)}
                      icon={<SportGlyph sport={category.label} />}
                      layoutId="sidebar-active"
                    />
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </nav>
      </LayoutGroup>

      <div className="sidebar-bottom">
        <button
          className="nav-item"
          aria-label="Refresh"
          title="Reload the app (feed, host lookups and the stream all start clean)"
          onClick={() => window.location.reload()}
        >
          <span className="nav-icon">
            <Icon name="refresh" size={20} />
          </span>
          <span className="nav-label">Refresh</span>
        </button>
        <ThemeToggle variant="row" />
      </div>
      <div className="sidebar-footer">
        <span className="brand-mark" aria-hidden>
          <ScorelineBadge />
        </span>
        <span className="brand-name">scoreline</span>
      </div>
    </aside>
  );
};

/** iOS-style bottom tab bar for phones: five destinations, the rest lives in-screen. */
export const TabBar = ({ route }: { route: Route }) => {
  const tabs: { key: string; label: string; icon: IconName; path: string; active: boolean }[] = [
    { key: "home", label: "Home", icon: "home", path: browsePath({ kind: "home" }), active: route.kind === "home" || route.kind === "sport" },
    { key: "live", label: "Live", icon: "live", path: browsePath({ kind: "live" }), active: route.kind === "live" },
    { key: "leagues", label: "Leagues", icon: "trophy", path: browsePath({ kind: "leagues", leagueId: null }), active: route.kind === "leagues" },
    { key: "tables", label: "Tables", icon: "table", path: browsePath({ kind: "tables", code: null }), active: route.kind === "tables" },
    { key: "search", label: "Search", icon: "search", path: browsePath({ kind: "search", query: "" }), active: route.kind === "search" },
  ];
  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`tab${tab.active ? " is-active" : ""}`}
          aria-current={tab.active ? "page" : undefined}
          onClick={() => navigate(tab.path)}
        >
          <Icon name={tab.icon} size={24} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
};
