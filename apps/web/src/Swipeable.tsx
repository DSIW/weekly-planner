import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

/** How far a card has to be dragged sideways before it counts as a decision. */
const THRESHOLD = 90;
/** Where a decided card flies to; far enough to leave the screen. */
const EXIT = 700;

interface Props {
  label: string;
  /** What a swipe to the right / left does; shown on the card while it is dragged. */
  right: string;
  left: string;
  onRight: () => void;
  onLeft: () => void;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}

/** A card that follows the finger and says what letting go would do: green "right" or red "left" once far enough. */
export function Swipeable({ label, right, left, onRight, onLeft, disabled, className = "", children }: Props) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startX = useRef<number | null>(null);

  // A decided card flies off and waits for the answer (`disabled` while the request runs, which includes reloading
  // the deck). If it is still here a moment after the request ended, the action failed or changed nothing: it comes
  // back instead of leaving an empty spot.
  useEffect(() => {
    if (!leaving || disabled) return;
    const back = setTimeout(() => {
      setLeaving(false);
      setDx(0);
    }, 400);
    return () => clearTimeout(back);
  }, [leaving, disabled]);

  const reset = () => {
    startX.current = null;
    setDx(0);
  };
  const down = (e: PointerEvent<HTMLElement>) => {
    if (leaving) return;
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (startX.current !== null && !leaving) setDx(e.clientX - startX.current);
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    if (startX.current === null || disabled) return reset();
    const moved = e.clientX - startX.current;
    if (moved > THRESHOLD || moved < -THRESHOLD) {
      startX.current = null;
      setLeaving(true);
      setDx(moved > 0 ? EXIT : -EXIT);
      (moved > 0 ? onRight : onLeft)();
    } else reset();
  };

  const side = dx > 0 ? "right" : dx < 0 ? "left" : null;
  const strength = Math.min(1, Math.abs(dx) / THRESHOLD);
  return (
    <article
      className={`swipeable ${className} ${side && strength === 1 ? `will-${side}` : ""}`}
      aria-label={label}
      style={{
        transform: `translateX(${dx}px) rotate(${dx / 25}deg)`,
        transition: leaving || dx === 0 ? "transform 0.25s" : "none",
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={reset}
    >
      {side && (
        <span className={`stamp stamp-${side}`} style={{ opacity: strength }} aria-hidden="true">
          {side === "right" ? right : left}
        </span>
      )}
      {children}
    </article>
  );
}
