import { useRef, useState, type PointerEvent, type ReactNode } from "react";

/** How far a card has to be dragged sideways before it counts as a decision. */
export const THRESHOLD = 90;

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
  const startX = useRef<number | null>(null);

  const reset = () => {
    startX.current = null;
    setDx(0);
  };
  const down = (e: PointerEvent<HTMLElement>) => {
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (startX.current !== null) setDx(e.clientX - startX.current);
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    if (startX.current === null || disabled) return reset();
    const moved = e.clientX - startX.current;
    reset();
    if (moved > THRESHOLD) onRight();
    else if (moved < -THRESHOLD) onLeft();
  };

  const side = dx > 0 ? "right" : dx < 0 ? "left" : null;
  const strength = Math.min(1, Math.abs(dx) / THRESHOLD);
  return (
    <article
      className={`swipeable ${className} ${side && strength === 1 ? `will-${side}` : ""}`}
      aria-label={label}
      style={{
        transform: `translateX(${dx}px) rotate(${dx / 25}deg)`,
        transition: dx === 0 ? "transform 0.2s" : "none",
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
