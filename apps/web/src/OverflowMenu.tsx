import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/** The three dots of an overflow button. */
function Dots() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/**
 * A "⋯" button with a popover menu under it. The menu closes on Escape, on a tap outside, on Tab and after an item was
 * chosen (a click inside the menu). `children` are the menu items: elements with role="menuitem".
 */
export function OverflowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    items()[0]?.focus();
    const outside = (ev: Event) => {
      if (!root.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (!open) return;
    if (ev.key === "Escape") {
      ev.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (ev.key === "Tab") {
      setOpen(false);
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = ev.key === "ArrowDown" ? at + 1 : at - 1;
      items[(next + items.length) % items.length]?.focus();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys of the menu are handled where its items are
    <div className="overflow" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={trigger}
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Dots />
      </button>
      {open && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: a click on an item closes the menu; keys act as clicks on items
        <div id={menuId} role="menu" className="overflow-menu" aria-label={label} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
