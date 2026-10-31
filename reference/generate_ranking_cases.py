#!/usr/bin/env python3
"""Writes golden cases for the suggestion ranking from the reference model (simulate_spec.ranked).

The domain test packages/domain/test/planning/ranking-oracle.test.ts replays them, so the TypeScript ranking
cannot drift from the reference. Ties are made deterministic: every random key is equal, input order decides.

  python3 reference/generate_ranking_cases.py
"""
import datetime
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import simulate_spec as ref  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "domain", "test", "planning", "ranking-oracle.json")
MEALS = ["main"] * 8 + ["side", "dessert", "baking", "snack"]
BASES = ["pasta", "rice", "potatoes", "grains", "bread", "other", "other"]
DIETS = ["vegan", "vegetarian", "vegetarian", "fish", "meat", "meat"]


class Flat:
    @staticmethod
    def random():
        return 0.5


def make_case(rng, n):
    start = datetime.date(2026, 11, 1) + datetime.timedelta(days=rng.randrange(14))
    n_days = rng.choice([2, 3])
    days = [start + datetime.timedelta(days=i) for i in range(n_days)]
    recs = [dict(id=i + 1, name=f"R{i + 1}", meal=rng.choice(MEALS), base=rng.choice(BASES), diet=rng.choice(DIETS),
                 time=rng.choice([None, 20, 30, 45, 46, 90, 300]), proven=rng.random() < 0.6, wants=rng.random() < 0.3)
            for i in range(14)]
    planned_count = rng.randrange(n_days)
    plan, taken = {}, set()
    for d in days[:planned_count]:
        options = [r for r in recs if ref.eligible(r, d, taken, set())]
        if not options:
            break
        pick = rng.choice(options)
        plan[d] = pick
        taken.add(pick["id"])
    day = days[len(plan)]
    blocked = {r["id"] for r in rng.sample(recs, rng.randrange(3))} - taken
    history = [(day - datetime.timedelta(days=rng.randrange(1, 6)), rng.choice(BASES[:6])) for _ in range(rng.randrange(4))]
    recent = {r["id"] for r in rng.sample(recs, rng.randrange(5))}
    pool = [r for r in recs if ref.eligible(r, day, taken, blocked)]
    expected = [r["id"] for r in ref.ranked(pool, day, plan, history, Flat, recent, n_days)]
    return dict(
        name=f"case {n}",
        dates=[d.isoformat() for d in days],
        planned=[dict(date=d.isoformat(), recipeId=r["id"]) for d, r in plan.items()],
        passed=sorted(blocked),
        history=[dict(date=d.isoformat(), base=b) for d, b in history],
        recent=sorted(recent),
        recipes=[dict(id=r["id"], name=r["name"], mealType=r["meal"], base=r["base"], diet=r["diet"],
                      totalTimeMinutes=r["time"], isProven=r["proven"], wantsToTry=r["wants"], yields=2) for r in recs],
        expected=expected,
    )


if __name__ == "__main__":
    rng = random.Random(20261031)
    cases = [make_case(rng, n) for n in range(300)]
    with open(OUT, "w") as f:
        json.dump(cases, f, indent=1)
        f.write("\n")
    print(f"wrote {len(cases)} cases to {os.path.normpath(OUT)}")
