#!/usr/bin/env python3
"""Reference model of spec/weekly-planning.allium, run against the real KitchenOwl recipes.

Attributes are read from tags and times exactly as the app would read them. The hard rules, the soft-rule
order and the deck behave as in the spec; users are simulated (accept the top suggestion, or pass/veto at random).

  set -a; . ./.env; set +a
  python3 -I reference/simulate_spec.py
"""
import collections
import datetime
import os
import random
import statistics
import sys

import requests

WEEKDAY_LIMIT = 45
VARIETY_WINDOW = 2
VEG_SHARE = 0.66
NEW_PER_SESSION = 1

MEAL = {"🍽️ Hauptgericht": "main", "🥦 Beilage": "side", "🍦 Dessert": "dessert", "🍰 Backen": "baking",
        "🥞 Frühstück": "breakfast", "🍿 Snack": "snack", "🍸 Getränk": "drink"}
BASE = {"🍝 Pasta": "pasta", "🍚 Reis": "rice", "🥔 Kartoffeln": "potatoes", "🌾 Getreide": "grains", "🥖 Brot": "bread"}


def canon(s):
    return s.replace("️", "").strip()


def attrs(r):
    t = {canon(x["name"]) for x in r["tags"]}
    meal = next((v for k, v in MEAL.items() if canon(k) in t), None)
    base = next((v for k, v in BASE.items() if canon(k) in t), "other")
    diet = ("vegan" if canon("🌱 Vegan") in t else "vegetarian" if canon("🥬 Vegetarisch") in t
            else "fish" if canon("🐟 Fisch") in t else "meat" if canon("🥩 Fleisch") in t else None)
    return dict(id=r["id"], name=r["name"], meal=meal, base=base, diet=diet, time=r.get("time") or None,
                proven=canon("✅ Erprobt") in t, wants=canon("⭐ Ausprobieren") in t)


def is_weekend(d):
    return d.weekday() >= 5


def eligible(rec, day, taken, blocked):
    if rec["meal"] != "main" or rec["id"] in taken or rec["id"] in blocked:
        return False
    return is_weekend(day) or rec["time"] is None or rec["time"] <= WEEKDAY_LIMIT


def ranked(pool, day, plan, history, rng, recent=(), n_days=3):
    """plan: {date: rec}; history: [(date, base)] of the log. Lower key = better."""
    near = [b for d, b in history if 0 < (day - d).days <= VARIETY_WINDOW] + [r["base"] for d, r in plan.items()]
    chosen = list(plan.values())
    veg_now = sum(r["diet"] in ("vegan", "vegetarian") for r in chosen)
    new_now = sum(not r["proven"] for r in chosen)
    veg_target = -(-VEG_SHARE * n_days // 1)          # ceil: 2 of 3, 2 of 2
    need_veg = veg_now < veg_target - (n_days - len(chosen) - 1) * 0 and (n_days - len(chosen)) <= (veg_target - veg_now)

    def key(r):
        base_pen = 1 if (r["base"] != "other" and r["base"] in near) else 0
        veg = r["diet"] in ("vegan", "vegetarian")
        # prefer vegetarian only while the share is at risk; otherwise meat/fish is as good as vegetarian
        veg_pen = (0 if veg else 1) if need_veg else 0
        new_pen = (0 if not r["proven"] else 1) if new_now < NEW_PER_SESSION else (1 if not r["proven"] else 0)
        want_pen = 0 if (r["wants"] and not r["proven"]) else 1   # the boost is for new recipes only
        recent_pen = 1 if r["id"] in recent else 0
        return (base_pen, veg_pen, new_pen, want_pen, recent_pen, rng.random())
    return sorted(pool, key=key)


def session(recs, days, rng, history, pass_rate=0.0, veto_rate=0.0, recent=()):
    plan, passed, vetoed = {}, set(), set()
    stats = dict(shown=0, vetoes=0, passes=0, empty=False)
    for day in days:
        while True:
            taken = {r["id"] for r in plan.values()}
            pool = [r for r in recs if eligible(r, day, taken, passed | vetoed)]
            if not pool:
                stats["empty"] = True
                break
            top = ranked(pool, day, plan, history, rng, recent, len(days))[0]
            stats["shown"] += 1
            if rng.random() < pass_rate:
                passed.add(top["id"]); stats["passes"] += 1; continue
            if rng.random() < veto_rate:
                vetoed.add(top["id"]); stats["vetoes"] += 1; continue
            plan[day] = top
            break
    return plan, stats


def long_run(recs, rng, weeks, confirm_rate, pass_rate=0.2, veto_rate=0.1):
    """Two sessions a week (Mon-Wed, Thu-Sat). 'recent' = planned in the last 14 days."""
    recs = [dict(r) for r in recs]
    byid = {r["id"]: r for r in recs}
    start = datetime.date(2026, 11, 2)
    log, planned_on, rows, new_flags = [], {}, [], []
    for w in range(weeks):
        for off, n in ((0, 3), (3, 3)):
            days = [start + datetime.timedelta(7 * w + off + i) for i in range(n)]
            recent = {rid for rid, d in planned_on.items() if (days[0] - d).days <= 14}
            hist = [(d, b) for d, b in log if 0 < (days[0] - d).days <= VARIETY_WINDOW]
            plan, st = session(recs, days, rng, hist, pass_rate, veto_rate, recent)
            new_flags.append(sum(not r["proven"] for r in plan.values()))
            for d, r in plan.items():
                log.append((d, r["base"]))
                planned_on[r["id"]] = d
                if rng.random() < confirm_rate:   # the household taps "we cooked it"
                    byid[r["id"]]["proven"] = True
            rows.append(plan)
    allp = [r for plan in rows for r in plan.values()]
    n_new = new_flags
    veg = [sum(r["diet"] in ("vegan", "vegetarian") for r in plan.values()) for plan in rows]
    ids = [r["id"] for r in allp]
    counts = collections.Counter(ids)
    return dict(dinners=len(allp), distinct=len(counts), most_repeated=counts.most_common(1)[0][1],
                new_per_session=statistics.mean(n_new), sessions_without_new=sum(x == 0 for x in n_new) / len(rows),
                veg_share=sum(veg) / len(allp), meat_fish_per_session=statistics.mean(len(p) - v for p, v in zip(rows, veg)),
                new_left=sum(not byid[i]["proven"] for i in byid if byid[i]["meal"] == "main"))


def main():
    url = os.environ.get("KITCHENOWL_URL", "https://kitchenowl.s.dsiw-it.de").rstrip("/")
    h = {"Authorization": "Bearer " + (os.environ.get("KITCHENOWL_TOKEN") or sys.exit("KITCHENOWL_TOKEN not set"))}
    raw = requests.get(f"{url}/api/household/{os.environ.get('KITCHENOWL_HOUSEHOLD_ID', '2')}/recipe", headers=h, timeout=60).json()
    recs = [attrs(r) for r in raw]
    print(f"{len(recs)} recipes read from KitchenOwl")

    miss = [r["name"] for r in recs if r["meal"] is None or r["diet"] is None]
    print(f"attributes missing (meal type or diet): {miss or 'none'}")
    mains = [r for r in recs if r["meal"] == "main"]
    wk = [r for r in mains if r["time"] is None or r["time"] <= WEEKDAY_LIMIT]
    print(f"\nPOOL: {len(mains)} mains; {len(wk)} usable on a weekday, {len(mains) - len(wk)} weekend-only")
    for label, sub in (("weekday-usable", wk), ("all mains", mains)):
        veg = sum(r["diet"] in ("vegan", "vegetarian") for r in sub)
        new = sum(not r["proven"] for r in sub)
        print(f"  {label}: {veg} vegetarian/vegan, {new} new, bases: "
              + ", ".join(f"{b} {n}" for b, n in collections.Counter(r['base'] for r in sub).most_common()))
    wkveg = [r for r in wk if r["diet"] in ("vegan", "vegetarian")]
    print("  weekday vegetarian by base: " + ", ".join(f"{b} {n}" for b, n in collections.Counter(r['base'] for r in wkveg).most_common()))
    print(f"  weekday new vegetarian: {sum(not r['proven'] for r in wkveg)}; weekday new meat/fish: {sum(not r['proven'] for r in wk if r not in wkveg)}")

    rng = random.Random(7)
    mon = datetime.date(2026, 11, 2)  # a Monday
    scenarios = {"Mon-Wed (weekdays)": [mon + datetime.timedelta(i) for i in range(3)],
                 "Fri-Sun (weekend included)": [mon + datetime.timedelta(4 + i) for i in range(3)],
                 "Mon-Tue (two days)": [mon + datetime.timedelta(i) for i in range(2)]}
    users = {"accepts the top suggestion": (0.0, 0.0), "picky: passes 40%, vetoes 20%": (0.4, 0.2)}
    N = 2000
    print(f"\nSIMULATION: {N} sessions per row, history = pasta yesterday, rice the day before")
    for sname, days in scenarios.items():
        for uname, (pr, vr) in users.items():
            res = []
            for _ in range(N):
                hist = [(days[0] - datetime.timedelta(1), "pasta"), (days[0] - datetime.timedelta(2), "rice")]
                plan, st = session(recs, days, rng, hist, pr, vr)
                res.append((plan, st))
            full = [p for p, s in res if len(p) == len(days)]
            veg_ok = sum(sum(r["diet"] in ("vegan", "vegetarian") for r in p.values()) >= round(VEG_SHARE * len(days)) for p in full)
            one_new = sum(sum(not r["proven"] for r in p.values()) >= 1 for p in full)
            clash = sum(any(a["base"] == b["base"] != "other" for a, b in zip(list(p.values()), list(p.values())[1:])) for p in full)
            first_base_clash = sum(list(p.values())[0]["base"] == "pasta" for p in full)
            shown = statistics.mean(s["shown"] for _, s in res)
            print(f"  {sname:27} | {uname:31} | complete {len(full)/N:5.1%} | veg target met {veg_ok/len(full):5.1%} | "
                  f">=1 new {one_new/len(full):5.1%} | same base on neighbours {clash/len(full):5.1%} | "
                  f"day 1 repeats yesterday's pasta {first_base_clash/len(full):4.1%} | cards seen {shown:4.1f}")
    print("\nLONG RUN: 12 weeks, 2 sessions a week, user passes 20% / vetoes 10%, 20 runs each")
    for label, flag in (("never confirmed (old spec)", 0.0), ("confirms 60% of planned meals", 0.6), ("confirms every planned meal", 1.0)):
        agg = collections.defaultdict(list)
        for _ in range(20):
            for k, v in long_run(recs, rng, 12, flag).items():
                agg[k].append(v)
        print(f"  {label}:")
        print("    " + "; ".join(f"{k} {statistics.mean(v):.2f}" for k, v in agg.items()))
    # how deep can a user swipe before the deck runs dry on a weekday?
    day = mon
    pool = [r for r in recs if eligible(r, day, set(), set())]
    print(f"\nDECK on a plain Monday: {len(pool)} candidates; first 5 of a ranked deck: "
          + "; ".join(f"{r['name'][:28]} ({r['base']},{r['diet'][:3]},{r['time']}m)" for r in ranked(pool, day, {}, [(day - datetime.timedelta(1), 'pasta')], rng)[:5]))


if __name__ == "__main__":
    main()
