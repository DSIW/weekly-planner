import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { disablePush, enablePush, isSubscribed, needsInstalling, PushFailed, pushSupported } from "./push";

/** A minimalist outline bell in the text colour; crossed out while notifications are off. */
function Bell({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={off ? "bell-off" : "bell"}
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Switches the reminder notification on or off for this phone. Shows nothing where notifications cannot work. */
export function Notifications() {
  const client = useQueryClient();
  const supported = pushSupported();
  const on = useQuery({ queryKey: ["push"], queryFn: isSubscribed, enabled: supported });
  const toggle = useMutation({
    mutationFn: (enable: boolean) => (enable ? enablePush() : disablePush()),
    onSettled: () => client.invalidateQueries({ queryKey: ["push"] }),
  });

  if (!supported) {
    return needsInstalling() ? (
      <p className="muted">Für Benachrichtigungen die App zum Home-Bildschirm hinzufügen.</p>
    ) : null;
  }
  if (on.data === undefined) return null;
  const message =
    toggle.error instanceof PushFailed && toggle.error.reason === "denied"
      ? "Benachrichtigungen sind blockiert. Bitte in den Einstellungen des Browsers erlauben."
      : toggle.isError
        ? "Das hat nicht geklappt. Bitte später noch einmal versuchen."
        : null;
  return (
    <div className="notify">
      <button
        type="button"
        className="icon-button"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!on.data)}
        aria-label={on.data ? "Benachrichtigungen aus" : "Benachrichtigungen an"}
        title={on.data ? "Benachrichtigungen sind an" : "Benachrichtigungen einschalten"}
      >
        <Bell off={!on.data} />
      </button>
      {message && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
    </div>
  );
}
