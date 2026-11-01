import { useEffect, useState } from "react";
import { itemIconsUrl } from "./api";
import { ITEM_ICON_CODEPOINTS } from "./item-icon-codepoints";

const FAMILY = "KitchenOwlItems";
let loading: Promise<boolean> | null = null;

/** Forgets whether the font was loaded, so a test can start over. */
export function resetItemFont(): void {
  loading = null;
}

/** Loads KitchenOwl's icon font once; false when this browser or the server cannot provide it. */
function loadItemFont(): Promise<boolean> {
  loading ??=
    typeof FontFace === "undefined"
      ? Promise.resolve(false)
      : new FontFace(FAMILY, `url(${itemIconsUrl})`)
          .load()
          .then((font) => {
            document.fonts.add(font);
            return true;
          })
          .catch(() => false);
  return loading;
}

/**
 * An ingredient's icon, drawn from KitchenOwl's own icon font by the key KitchenOwl gives the item, so the list looks
 * as it does there. Without a key or a font the first letter of the name stands in.
 */
export function ItemIcon({ icon, name }: { icon: string | null; name: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let current = true;
    void loadItemFont().then((ok) => current && setReady(ok));
    return () => {
      current = false;
    };
  }, []);
  const code = icon ? ITEM_ICON_CODEPOINTS[icon] : undefined;
  if (ready && code !== undefined)
    return (
      <span className="item-icon" data-icon={icon} aria-hidden="true">
        {String.fromCodePoint(code)}
      </span>
    );
  return (
    <span className="item-icon letter" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
