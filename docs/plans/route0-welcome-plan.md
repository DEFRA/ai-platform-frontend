# Route 0: Welcome page (entry point into all three tiers)

> Part of the ["three routes to a credential"](../ui-flow-three-routes.md) journey. See also [Route 1](route1-plan.md), [Route 2](route2-plan.md), [Route 3](route3-plan.md). **Status: not yet implemented.**

Scope: a new small plan, separate from Routes 1-3, covering the home page (`/`) content. Not a
build story of its own - it is the shared front door the diagrams' three routes all start from
(directly, or via `/models`). Currently `ai-platform-frontend/src/server/routes/home/index.njk`
is an empty placeholder (confirmed by reading it: just an `appHeading` and an empty `<p>`).

**Depends on:** Route 1 (`/models`, `/connect`), Route 2 (`/connect` team radio, `/teams/new`),
and Route 3 (`/manage` role-aware view) all being implemented first, since this page's links
target routes those plans build. Build this last, or stub the links early and fix them up once
each route lands - implementer's choice, noted in Decisions.

Per the AICE `javascript-design-language` skill (`ai-platform-frontend/.github/skills/javascript-design-language/`),
its `references/layouts.md` defines an **entry/hub page** pattern (`.defra-hero` full-width green
banner + `.defra-tile-grid` 3-column tiles below) that is exactly this page's shape - use it
instead of generic GOV.UK cards:

- Base layout: `assets/layouts/hub.njk` (extends `assets/layouts/page.njk`) - copy/adapt into
  `src/server/common/templates/layouts/` if not already wired up from earlier route work.
- Hero: `.defra-hero` (Defra green `$defra-green` `#008531` background, white `govuk-heading-xl`
  and `govuk-body-l` text) - a short welcome/service intro, not a tile itself.
- Three tiers as `.defra-tile-grid` tiles (3-column, collapses to 1 column at <=776px per
  `references/layouts.md`'s responsive table) - not a 4th "which one is for me" page, see Decisions.
- Reference `references/components.md` for the tile's exact HTML structure/CSS classes and
  `references/colours.md` for the hero/tile colour tokens (never substitute `$defra-green` where
  `$defra-green-aa` is required for text contrast).

## Steps

1. `ai-platform-frontend/src/server/routes/home/controller.js`: extend the view model with three
   "tiers" entries and a signed-in flag (`getSessionUser(request)` - reuse whatever the existing
   `require-sign-in`/`session.js` helpers expose) so the template can vary link targets/CTAs for
   signed-in vs signed-out visitors without new server logic beyond passing that flag through.
2. `ai-platform-frontend/src/server/routes/home/index.njk`: replace the empty content block with
   the AICE hub layout - `.defra-hero` intro banner followed by a `.defra-tile-grid` of three tiles
   (per the skill's entry/hub pattern above, not a generic card/summary-list component):
   - **"Try a shared model"** (Research tier, Route 1): one-line description ("Get a personal,
     rate-limited credential for a shared model in minutes - no team needed"), links to `/models`
     (browse first) as the primary path, per B06 flow item 1's "start page and model detail both
     offer Connect to a model".
   - **"Set up your team"** (Team tier, first person, Route 2): description ("Create a team and
     request a dedicated model for your applications"), links to `/connect` with the team radio
     pre-selected via a query param (confirm `/connect?type=team` or similar with the Route 2
     implementer) or simply to `/connect` itself if pre-selection isn't worth the extra plumbing.
   - **"Manage your team's AI access"** (Team tier, joining, Route 3): description ("See what your
     team already has, and connect to it"), links to `/manage`.
   - A fourth, smaller link to `/models` alone for browsing without committing to a path yet (also
     reachable from card one, but worth a standalone link since it's public and unauthenticated).
3. Signed-out visitors clicking any of the three cards hit the existing sign-in redirect
   (`require-sign-in` helper, already built) with the correct `returnTo` - no new auth logic needed,
   just correct link targets.
4. `ai-platform-frontend/src/server/routes/home/controller.test.js`: assert the three cards render
   with the correct hrefs, and that the page still renders (200) for both signed-in and signed-out
   requests (it's a public page).
5. Update `ai-platform-frontend/src/config/nunjucks/context/build-navigation.js` only if the header
   nav needs a "Home"/logo-linked-to-`/` entry that isn't already there - check current behaviour
   first, likely already present as the service name link.

## Relevant files

- `ai-platform-frontend/src/server/routes/home/controller.js` - view model additions
- `ai-platform-frontend/src/server/routes/home/index.njk` - the three-card welcome content
- `ai-platform-frontend/src/server/routes/home/controller.test.js` - updated assertions

## Verification

1. `npm test` in ai-platform-frontend - updated `home/controller.test.js`.
2. Manual: visit `/` signed out - see three cards + models link, all public; click each and confirm
   it lands on `/models`, `/connect`, `/manage` respectively (the latter two prompting sign-in first
   if not authenticated, then returning to the intended page).
3. Accessibility: run the existing axe/journey test pattern (if one covers the home page) to confirm
   the new cards are WCAG 2.2 AA and keyboard-navigable, per the repo's GOV.UK Frontend conventions.
4. `npm run lint` / `npm run format:check`.

## Decisions

- Build this after Routes 1-3 land so links are real; if built earlier, stub the three hrefs and
  track them as a follow-up rather than guessing at not-yet-built paths.
- Use the AICE design-language skill's hub/tile-grid pattern (`.defra-hero` + `.defra-tile-grid`)
  rather than a bespoke card component - copy the relevant partial/layout from
  `.github/skills/javascript-design-language/assets/` into this repo's template structure if not
  already present from earlier route work, per the skill's "Starting a new project" steps.
- Content is three cards, not a fourth "which one is for me" decision-tree page - the diagrams
  already position `/connect`'s access-type radios as that decision point; the welcome page's job
  is just to get a visitor to the right starting door, including the Route 3 "you're already on a
  team" case which the other two doors don't cover.

## Further considerations

1. Should the "Set up your team" card pre-select the team radio on `/connect` via a query param, or
   just land on the plain chooser? Recommend the plain chooser to avoid extra plumbing, unless the
   Route 2 implementer finds it trivial to support.
