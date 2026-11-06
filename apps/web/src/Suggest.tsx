import { useEffect, useId, useRef, useState } from "react";
import { suggestNames } from "./api";
import { ItemIcon } from "./ItemIcon";

export interface Suggestion {
  name: string;
  icon?: string;
  /** The text as typed, offered when the household has nothing of that name. */
  typed?: boolean;
}

interface Props {
  kind: "item" | "tag";
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Words for the last option, which takes the typed text as it is ("… als neue Zutat verwenden"). */
  typedLabel: (text: string) => string;
  onPick: (picked: Suggestion) => void;
}

const WAIT_MS = 150;

/**
 * A text field that offers the household's own items or tags as the letters are typed. Arrow keys and Enter work, a tap
 * works, and the typed text itself is always the last choice, so a name the household does not have can be used too.
 */
export function Suggest({ kind, label, placeholder, autoFocus, typedLabel, onPick }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const latest = useRef(0);

  useEffect(() => {
    const typed = text.trim();
    const mine = ++latest.current;
    if (typed === "") {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      suggestNames(kind, typed)
        .then((names) => {
          // Only the newest question counts: a slow answer to an older one is not shown.
          if (mine !== latest.current) return;
          setFound(names);
          setActive(-1);
        })
        .catch(() => mine === latest.current && setFound([]));
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [text, kind]);

  const typed = text.trim();
  const exact = found.some((s) => s.name.toLowerCase() === typed.toLowerCase());
  const options: Suggestion[] = [...found, ...(typed !== "" && !exact ? [{ name: typed, typed: true }] : [])];

  const pick = (s: Suggestion) => {
    onPick(s);
    setText("");
    setFound([]);
    setActive(-1);
  };

  return (
    <div className="suggest">
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={options.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        autoCapitalize="off"
        placeholder={placeholder}
        // biome-ignore lint/a11y/noAutofocus: the field is the point of the dialog that was just opened
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && options.length > 0) {
            e.preventDefault();
            setActive((a) => (a + 1) % options.length);
          } else if (e.key === "ArrowUp" && options.length > 0) {
            e.preventDefault();
            setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            // Without a choice made, Enter takes the first suggestion if there is exactly the typed word, else the text.
            const chosen =
              options[active] ??
              (exact ? found.find((s) => s.name.toLowerCase() === typed.toLowerCase()) : options.at(-1));
            if (chosen) pick(chosen);
          } else if (e.key === "Escape" && options.length > 0) {
            e.stopPropagation();
            setFound([]);
            setText("");
          }
        }}
      />
      {options.length > 0 && (
        // The input owns the keyboard (aria-activedescendant), so the list itself takes no focus.
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the combobox pattern of the ARIA practices
        <ul id={`${id}-list`} role="listbox" aria-label={`Vorschläge: ${label}`} className="suggest-list">
          {options.map((s, index) => (
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the input (aria-activedescendant)
            // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keys for the options
            <li
              key={`${s.typed ? "typed" : "known"}-${s.name}`}
              id={`${id}-${index}`}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the combobox pattern of the ARIA practices
              role="option"
              aria-selected={index === active}
              className={s.typed ? "suggest-typed" : undefined}
              // Before the field loses focus, or the tap would never arrive.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
            >
              {kind === "item" && !s.typed && <ItemIcon icon={s.icon ?? null} name={s.name} />}
              <span>{s.typed ? typedLabel(s.name) : s.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
