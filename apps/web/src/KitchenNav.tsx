import { useLinks } from "./Links";

const PATHS = {
  list: "M18 6h-2c0-2.2-1.8-4-4-4S8 3.8 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2h2V8h4v2h2V8h2v12z",
  recipes:
    "M19.5 3.5 18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2v14H3v3c0 1.7 1.3 3 3 3h12c1.7 0 3-1.3 3-3V2l-1.5 1.5zM19 19c0 .6-.4 1-1 1s-1-.4-1-1v-3H8V5h11v14z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  plan: "M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z",
};

/** KitchenOwl's navigation bar, rebuilt: the planner sits in the place of its meal planner, the rest are links back. */
export function KitchenNav() {
  const links = useLinks();
  if (!links) return null;
  const entries = [
    { label: "Liste", href: links.list, path: PATHS.list },
    { label: "Rezepte", href: links.recipes, path: PATHS.recipes },
    { label: "Wochenplan", href: null, path: PATHS.plan },
    { label: "Mehr", href: links.home, path: PATHS.home },
  ];
  return (
    <nav className="kitchen-nav" aria-label="KitchenOwl">
      {entries.map((e) => (
        <a
          key={e.label}
          href={e.href ?? "#"}
          aria-current={e.href === null ? "page" : undefined}
          onClick={e.href === null ? (ev) => ev.preventDefault() : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={e.path} />
          </svg>
          {e.label}
        </a>
      ))}
    </nav>
  );
}
