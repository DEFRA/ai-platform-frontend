---
description: 'Use whenever you finish implementing a new feature, route, or cross-cutting platform capability (frontend or backend) — reminds you to update the shared implemented-features list new joiners read.'
applyTo: 'src/**, docs/plans/**'
---

# Keep the implemented-features list current

[docs/implemented-features.md](../../docs/implemented-features.md) is the one cross-repo list of
what has been built so far in the AI Platform Portal, written for new joiners — a short
bullet-point index, not a duplicate of the detailed plan docs and READMEs it links to.

Update it whenever you ship something that changes the answer to "what does this platform do
today?":

- A route/plan moves from not-yet-implemented to implemented, or its shape changes materially (e.g.
  a refactor like Route 2's per-team-per-environment credential change) — update its row in the
  "Journey status at a glance" table and its route section.
- A new cross-cutting feature lands (a new shared mechanism like locks, backfills, audit events)
  that isn't tied to one route — add a bullet under "Cross-cutting platform features".

Keep entries to one or two lines with a link to the authoritative source (route plan, README
section, design-pack page) for detail — do not grow this file into a second copy of that detail.
Update the "Last updated" date at the top whenever you edit it.

This is separate from (and in addition to) keeping `docs/plans/routeN-plan.md` STATUS lines
current — see [route-plans.instructions.md](route-plans.instructions.md) for that mechanism.
