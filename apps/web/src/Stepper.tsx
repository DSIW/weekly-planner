const STEPS = ["Tage", "Gerichte", "Einkaufsliste"] as const;

/** Where the household is in planning: days, then dishes, then the shopping list. `current` counts from 1. */
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="steps" aria-label="Schritte der Planung">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={i + 1 < current ? "done" : i + 1 === current ? "now" : ""}
          aria-current={i + 1 === current ? "step" : undefined}
        >
          <span className="step-mark" aria-hidden="true">
            {i + 1 < current ? "✓" : i + 1}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
