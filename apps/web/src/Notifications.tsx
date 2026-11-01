import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { disablePush, enablePush, isSubscribed, needsInstalling, PushFailed, pushSupported } from "./push";

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
      <button type="button" className="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(!on.data)}>
        {on.data ? "Benachrichtigungen aus" : "Benachrichtigungen an"}
      </button>
      {message && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
    </div>
  );
}
