interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** The recipe search: a magnifier and a placeholder say what it is; the label is for screen readers. */
export function SearchField({ value, onChange }: Props) {
  return (
    <label className="search">
      <span className="sr-only">Rezept suchen</span>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M16 16l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        placeholder="Rezept suchen …"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        enterKeyHint="search"
      />
    </label>
  );
}
