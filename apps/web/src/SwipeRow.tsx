import { useRef, useState, type PointerEvent, type ReactNode } from "react";

/** How far a row has to be dragged sideways before letting go counts as a decision. */
const THRESHOLD = 90;
/** A drag is sideways only once it moved this far, and clearly more across than down; until then the page scrolls. */
const SLOP = 10;

/**
 * A list row that follows the finger sideways and shows, behind it, what letting go would do. Left is the main action;
 * right is optional. A mostly vertical drag is a scroll and never starts a swipe, and a tap on a button inside the row
 * stays a tap. Every swipe has a button elsewhere in the row for those who cannot swipe.
 */
export function SwipeRow({
  left,
  right,
  onLeft,
  onRight,
  disabled,
  children,
}: {
  /** What a swipe to the left does. */
  left: string;
  onLeft: () => void;
  /** What a swipe to the right does; without it the row only moves to the left. */
  right?: string;
  onRight?: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const swallowClick = useRef(false);
  const canRight = right !== undefined && onRight !== undefined;

  const clamp = (value: number) => (value > 0 && !canRight ? 0 : value);
  const reset = () => {
    start.current = null;
    dragging.current = false;
    setDx(0);
  };
  const down = (e: PointerEvent<HTMLElement>) => {
    swallowClick.current = false;
    if (disabled) return;
    start.current = { x: e.clientX, y: e.clientY };
    dragging.current = false;
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const from = start.current;
    if (!from) return;
    const moveX = e.clientX - from.x;
    const moveY = (e.clientY ?? from.y) - from.y;
    if (!dragging.current) {
      if (Math.abs(moveY) > SLOP && Math.abs(moveY) > Math.abs(moveX)) {
        start.current = null; // a scroll
        return;
      }
      if (Math.abs(moveX) <= SLOP || Math.abs(moveX) < Math.abs(moveY) * 1.5) return;
      dragging.current = true;
      // From here the row owns the pointer; before, a tap on a button inside it still reaches that button.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setDx(clamp(moveX));
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    const from = start.current;
    const wasDragging = dragging.current;
    if (wasDragging) swallowClick.current = true;
    if (!from || !wasDragging) return reset();
    const moved = clamp(e.clientX - from.x);
    reset();
    if (moved < -THRESHOLD) onLeft();
    else if (moved > THRESHOLD) onRight?.();
  };

  const side = dx < 0 ? "left" : dx > 0 ? "right" : null;
  const strength = Math.min(1, Math.abs(dx) / THRESHOLD);
  return (
    <div className="swipe-row">
      {side && (
        <div
          className={`swipe-bg swipe-bg-${side}${strength === 1 ? " ready" : ""}`}
          style={{ opacity: 0.35 + 0.65 * strength }}
          aria-hidden="true"
        >
          {side === "left" ? left : right}
        </div>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a gesture on top of the buttons inside; they stay the accessible way */}
      <div
        className="swipe-front"
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 0.2s" : "none" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={reset}
        onClickCapture={(e) => {
          // The click that ends a drag is not a tap on whatever lay under the finger.
          if (swallowClick.current) {
            swallowClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
