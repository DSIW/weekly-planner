/** A spinner with a word beside it, for a page or list that is still being fetched. */
export function Loading({ what = "Lädt …" }: { what?: string }) {
  return (
    <p className="loading" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {what}
    </p>
  );
}
