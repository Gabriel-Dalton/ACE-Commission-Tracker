# Feature Request / RFC: "Growth plan counts toward the $1,000 goal (but earns no commission)"

> **Status:** Implemented in this branch (`claude/youthful-thompson-iT4ze`)
> **Author:** Gabriel Dalton
> **Type:** Commission-logic change + UI surfacing
> **Migration required:** None (client-side categorization only)

---

## 1. One-liner

Today the **Growth** plan ($299/mo) is *fully excluded* — it neither counts toward
the $1,000 monthly target nor earns commission, so a Growth sale does **nothing**
for the tracker. This change makes Growth a **"Goal Contributor":** its $299 MRR
counts toward the $1,000 target (helping *platform* deals cross the line into
commission), while Growth itself still earns **$0**.

In Gabriel's words:

> *"If I get someone on the Growth plan, which is $299 a month, it counts towards
> the goal, but it doesn't actually give commission. It will only help towards
> that $1,000 goal."*

---

## 2. Background — how commission works today

Commission is gated by a **$1,000 "eligible MRR" target**, evaluated **per
close-month** (the calendar month a deal was signed). Above that line, platform
deals earn **10% of first-year contract value**, paid out as the client pays
(up to 12 months). This is the "above the line" model.

There are currently **three** plan categories:

| Category | Examples | Counts toward $1,000 target? | Commission |
|---|---|---|---|
| **Platform** | Scale, Pro tiers, Unlimited Domains | ✅ Yes | 10% of MRR **above the line** × 12 months, paid as client pays |
| **Managed** | Managed Small/Medium/…/Enterprise | ✅ Yes | Flat **$300/deal** (one-shot) |
| **Excluded** | Lite ($89), Starter ($149), **Growth ($299)** | ❌ No | **$0** |

### The "above the line" mechanic (the important part)

For each close-month cohort:

```
eligibleMRR   = platformMRR + managedMRR          (what counts toward $1,000)
overage       = max(0, eligibleMRR − 1000)        (the part above the line)

targetToFill  = max(0, 1000 − managedMRR)          (how much platform must cover first)
platformAbove = max(0, platformMRR − targetToFill) (platform MRR above the line)

platform commission (12-mo forecast) = platformAbove × 12 × 10%
managed commission                   = $300 per managed deal
```

The subtlety that makes this feature work: **Managed MRR "fills" the target first**,
which *lowers* `targetToFill` and pushes *more* of the platform MRR above the line.
Managed gets a flat $300 **and** subsidizes platform's path to commission.

**Growth should behave like Managed for the target-fill step — but earn nothing.**

---

## 3. The problem / gap

A Growth sale is currently invisible to the commission engine. Concretely:

- Gabriel closes an **$899 Scale** platform deal in June. Eligible MRR = $899 →
  **below** the $1,000 line → **$0 commission**. ("$101 more to unlock.")
- He then sells a **$299 Growth** plan in June. Today this changes **nothing** —
  Growth is excluded, eligible MRR stays $899, commission stays $0.

But that Growth sale is real recurring revenue for ACE. It *should* count toward
the goal that unlocks commission on the platform deal — even though Growth itself
isn't commissionable.

---

## 4. Proposed change — a 4th category: "Goal Contributor"

Introduce a new plan category that **counts toward the $1,000 target but earns no
commission**. Growth moves into it. Lite and Starter stay fully excluded.

| Category | Counts toward target? | Earns commission? | Plans |
|---|---|---|---|
| Platform | ✅ | ✅ (above-line %) | Scale, Pro, Unlimited |
| Managed | ✅ | ✅ (flat $300) | Managed * |
| **Goal Contributor** *(new)* | **✅** | **❌ ($0)** | **Growth** |
| Excluded | ❌ | ❌ ($0) | Lite, Starter |

Mechanically, a Goal Contributor behaves **exactly like Managed for the
target-fill calculation** (it reduces `targetToFill`, pushing platform MRR above
the line), but it has **zero commission units** and **no flat bonus**.

```
eligibleMRR   = platformMRR + managedMRR + goalMRR
targetToFill  = max(0, 1000 − managedMRR − goalMRR)   ← Growth fills the target too
platformAbove = max(0, platformMRR − targetToFill)
```

### Why "scoped to Growth only"?

The request is specifically about the **$299 Growth** tier. Lite ($89) and Starter
($149) remain excluded. The category is **data-driven** (a single array,
`GOAL_CONTRIBUTOR_PLANS = ['growth']`), so promoting Starter/Lite later is a
one-line change.

---

## 5. Behavior spec (the logic)

### What changes

1. **Target math.** Growth MRR is added to `eligibleMRR` and subtracted from
   `targetToFill`, exactly like Managed. This is the *entire* substantive change;
   it lives in one function (`getCloseMonthContext`).
2. **Categorization.** Growth is no longer `isExcluded`. New helpers:
   `isGoalContributor(plan)` and `isCommissionable(plan)` (= platform **or**
   managed). Everything that means "earns commission / has payment units" now keys
   off `isCommissionable` instead of `!isExcluded`.
3. **UI surfacing.** New violet **"Growth · goal"** badge, a **"Counts toward
   goal"** status pill, a dedicated breakdown line, an updated rules modal, and a
   split self-serve picker.

### What does **not** change

- **Lite & Starter** stay fully excluded (no goal, no commission).
- **Managed** (flat $300 + counts) and **Platform** (10% above line × 12) are
  untouched.
- **Growth earns $0** — no units, no flat bonus, no above-line share.
- **Payment tracking & "subscription revenue collected"** ignore Growth (it has no
  commissionable units to collect). Growth shows up **only** in the
  target/eligible-MRR math and a "goal contributor" breakdown row.
- **No DB migration.** `plan = 'growth'` is already stored as text; the meaning is
  reinterpreted client-side.
- **12-month cap, "paid as the client pays," cancellation** — unchanged.

### Cohort/timing semantics (inherited from Managed)

The $1,000 target is evaluated **per close-month**, so a Growth sale helps the
platform deals that **closed in the same calendar month**. The contribution is a
snapshot taken at the platform deal's close month (just like Managed) and does not
need to be "collected" to count. See §10 for a possible rolling-MRR alternative.

---

## 6. Worked examples

All use TARGET = $1,000, rate = 10%, managed flat = $300. "12-mo" = full first-year
forecast (paid out as the client pays).

### A. The headline case — Growth rescues a near-miss

| | Platform | Managed | Growth | Eligible MRR | Platform above line | Commission (12-mo) |
|---|---|---|---|---|---|---|
| **Before** | $899 Scale | — | — | $899 | $0 (below target) | **$0** |
| **After** | $899 Scale | — | +$299 | $1,198 | $899 − (1000−299) = **$198** | **$237.60** |

A $299 Growth sale converts a $0 month into **$237.60** of platform commission
(≈ $19.80/mo as Acme pays). Growth itself earns **$0**.

### B. Stacking above an already-passing month

`$1,200 Platform` alone → above line $200 → **$240/yr**.
Add `$299 Growth` → `targetToFill = 701` → above line `1200 − 701 = $499` →
**$598.80/yr**. The Growth sale added **$358.80** (= 299 × 12 × 10%). Growth: $0.

### C. Growth alone — below target

`$299 Growth`, no platform deals → eligible $299 → **$0 commission**. Progress bar:
"$701 more to unlock." Growth shows as **counting toward the goal**, earns $0.

### D. Two Growth subs + a platform deal

`$750 Platform` + `$299` + `$299` Growth → goalMRR $598 → eligible $1,348 →
`targetToFill = 1000 − 598 = 402` → above line `750 − 402 = $348` → **$417.60/yr**.
Both Growth subs count; neither pays.

### E. Growth + Managed both fill the target

`$600 Platform` + `$569 Managed` + `$299 Growth` →
`targetToFill = max(0, 1000 − 569 − 299) = 132` → above line `600 − 132 = $468` →
platform **$561.60/yr** + managed **$300** + Growth **$0** = **$861.60** forecast.

---

## 7. Edge cases (and how they're handled)

| # | Situation | Behavior | Why |
|---|---|---|---|
| E1 | **No platform deal**, only Managed + Growth above $1,000 | Above-line $ earns nothing extra; Managed still gets $300, Growth $0 | Only *platform* MRR earns the above-line %. Guard: `overage > 0 && platformMRR > 0`. |
| E2 | **Managed + Growth already ≥ $1,000** | `targetToFill` floors at 0; *all* platform MRR is above the line | `Math.max(0, 1000 − managedMRR − goalMRR)` |
| E3 | **Growth alone, < $1,000** | Counts toward goal, unlocks nothing, earns $0 | overage = 0 |
| E4 | **Multiple Growth subs** | Their MRR sums into `goalMRR` and stacks | `goalDeals.reduce(...)` |
| E5 | **Lite / Starter** | Still fully excluded — no goal, no commission | Remain in `EXCLUDED_PLANS` |
| E6 | **Growth marked paid / cancelled** | N/A — Growth has 0 commission units, so no payment boxes / cancel control render | `dealMaxUnits = 0` |

---

## 8. UI / UX changes

- **Plan badge:** new violet **"Growth"** badge (`badge-goal`) — distinct from the
  grey "excluded" badge, so a glance separates "helps the goal" from "ignored."
- **Status pill:** **"Counts toward goal"** (violet), replacing the old "Excluded".
- **Commission cell:** "$0.00 — Counts toward $1,000 goal · no commission".
- **Forecast breakdown:** a dedicated line —
  *"Beta LLC — Growth (counts toward target · no commission) … $299/mo"* — listed
  alongside platform & managed contributors, so `Eligible MRR` visibly adds up.
- **"Deals counting toward target" stat:** Growth now included in the count.
- **Rules modal:** new **"Counts toward goal"** row; **"Excluded"** row narrowed to
  Lite & Starter.
- **Plan picker (Self-serve tab):** split into **"Counts toward goal"** (Growth,
  with an explanatory banner) and **"Excluded · no commission"** (Lite, Starter).
- **PDF / CSV export:** Growth itemized as a goal contributor; status exports as
  `goal`.

---

## 9. Data model / migration

**None.** `deals.plan` is free-text and already stores `'growth'`. The change is a
reinterpretation of that value in the client. Historical Growth deals
automatically begin counting toward the goal for their own close-month on next
load. The monthly verification queue (`queue-verifications.mjs`) already skips
zero-unit plans, so Growth correctly generates **no** "is this client still with
us?" prompts (there's no commission to collect).

---

## 10. Configurability & future extensions

- **Promote Starter/Lite to goal contributors:** add the key to
  `GOAL_CONTRIBUTOR_PLANS`. One line.
- **Toggle in UI:** a settings switch ("self-serve tiers count toward goal")
  mirroring the existing `managedCountsTowardTarget` pattern.
- **Rolling/active-MRR target** *(bigger):* today the target is per close-month.
  A future model could evaluate the target against *currently active* MRR so a
  Growth sub keeps helping every month it's live. Out of scope here; noted for
  later.

---

## 11. Implementation map (files & functions)

- `index.html`
  - **Constants:** split `EXCLUDED_PLANS`; add `GOAL_CONTRIBUTOR_PLANS`.
  - **Helpers:** `isGoalContributor`, `isCommissionable`; update `isPlatform`.
  - **`getCloseMonthContext`:** compute `goalDeals` / `goalMRR`; fold into
    `eligibleMRR` and `targetToFill` (the core change).
  - **`dealMaxUnits` / `dealMonthlyShare` / revenue / renewal / carry-over:** key
    off `isCommissionable` so Growth stays at 0 units / $0.
  - **`dealStatus` + badges + status text + commission cell + breakdown + stats:**
    surface the "goal" state.
  - **Rules modal + plan picker + edit-tab routing:** documentation & navigation.
  - **CSS:** `--violet` / `--violet-soft`; `.badge-goal`, `.deal-status.goal`,
    `.pdf-status-cell.goal`.
- `scripts/verify-goal-contribution.mjs` — standalone assertions mirroring the
  in-app math for every example in §6 (run with `node`).

---

## 12. Testing checklist

- [x] Scenario A–E produce the exact figures in §6 (`verify-goal-contribution.mjs`).
- [x] Edge cases E1–E2 (`max(0, …)` floors; `platformMRR > 0` guard).
- [x] Growth renders the violet badge, "Counts toward goal" pill, and $0 commission
      cell; no payment boxes / cancel control.
- [x] Lite & Starter unchanged (excluded, grey).
- [x] `Eligible MRR` in header + breakdown + PDF includes Growth and adds up.
- [x] No console errors; no DB migration needed.
