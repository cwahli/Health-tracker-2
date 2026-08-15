# Inbox — class examples, not a catalog todo list

~14 folders are **4 unique meals** snapshotted many times. Treat the meal as an *example of a class*, not 14 tickets.

| Unique meal | Class | Durable solver |
|---|---|---|
| Croissants + wrap + quinoa | `FALSE_FRIEND` + query-scope | Bind only rows tagged with that component’s `searchQuery`. Do not steal tortilla/olive/sesame from a sibling. |
| Prawn pasta + doughnut + hams | `DISH_DROP` / identity | Scout presence + name match. Ham ≠ Serrano collapse is a matcher bug, not a new FDC. |
| Lassi 1000g | `OPENING_WRONG` | Weight-anchor / claimedItems. Frozen tape stays red on purpose. |
| Quota / no scout | transport | Not food-calc. Do not invent binds. |

**Forbidden “green”:** adding `CANONICAL_BASE_FOODS` / aliases / expected FDC so `lookupCanonicalBaseFood` matches. That is the same bug on the next food.

**Flow (no `/loop`, no babysit):**

1. Classify the meal (one class in session).
2. Write a unit test that would fail on *any* new food of that class (query-scoped bind, refuse false friend, no index re-inject).
3. Patch scout **or** resolver **or** backend bind — the layer that broke the contract.
4. Run that test file. Two burned hypotheses → `blocked_human`.
5. One outer replay of the example meal. Catalog replay cannot promote.

Human is only needed at `blocked_human` (genuinely new food, or scout opening is wrong and needs a new photo/text).
