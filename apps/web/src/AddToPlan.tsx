import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCurrentSession, proposeRecipe, refreshRecipes, SessionFailed } from "./api";
import { dayLabel } from "./dates";

const MESSAGES: Record<string, string> = {
  not_next_open_day: "Es ist schon ein anderer Tag dran. Bitte in der Planung nachsehen.",
  recipe_already_proposed: "Dieses Gericht wartet schon an einem anderen Tag auf eine Antwort.",
  proposal_already_pending: "Für diesen Tag wartet schon ein Vorschlag auf eine Antwort.",
  session_not_open: "Die Planung ist nicht mehr offen.",
};
const FALLBACK = "Das hat nicht geklappt. Bitte später noch einmal versuchen.";

/**
 * After a recipe was created: put it forward for the next open day of the current plan, so it does not have to be
 * searched for again. Offered only while a plan is open and a day still needs a dish.
 */
export function AddToPlan({ recipeId }: { recipeId: number }) {
  const client = useQueryClient();
  const current = useQuery({ queryKey: ["session"], queryFn: fetchCurrentSession });
  const session = current.data;
  const day =
    session?.status === "open"
      ? session.days.find(
          (d) => d.status === "open" && !session.proposals.some((p) => p.status === "pending" && p.date === d.date),
        )
      : undefined;
  const propose = useMutation({
    mutationFn: async (despiteTime: boolean) => {
      if (!session || !day) throw new SessionFailed("unavailable");
      // The planner reads KitchenOwl's recipes in advance; the new one has to be in before it can be proposed.
      await refreshRecipes().catch(() => {});
      return proposeRecipe(session.id, day.date, recipeId, despiteTime);
    },
    onSuccess: (updated) => client.setQueryData(["session"], updated),
    onSettled: () => client.invalidateQueries({ queryKey: ["session"] }),
  });

  if (propose.isSuccess && day)
    return (
      <p role="status" className="success">
        Für {dayLabel(day.date)} vorgeschlagen. Die andere Person kann jetzt zustimmen.
      </p>
    );
  if (propose.isSuccess) return null;
  if (!session || !day) return null;

  const reason = propose.error instanceof SessionFailed ? propose.error.reason : "unavailable";
  return (
    <div className="add-to-plan">
      <button type="button" disabled={propose.isPending} onClick={() => propose.mutate(false)}>
        {propose.isPending ? "Wird vorgeschlagen …" : `Für ${dayLabel(day.date)} vorschlagen`}
      </button>
      {propose.isError && (
        <p role="alert" className="error">
          {reason === "too_long_for_weekday"
            ? "Das Rezept ist für einen Wochentag eigentlich zu lang."
            : (MESSAGES[reason] ?? FALLBACK)}
        </p>
      )}
      {propose.isError && reason === "too_long_for_weekday" && (
        <button type="button" className="secondary" disabled={propose.isPending} onClick={() => propose.mutate(true)}>
          Trotzdem vorschlagen
        </button>
      )}
    </div>
  );
}
