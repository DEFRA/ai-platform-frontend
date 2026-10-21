# Build plan: UI flow v2 and v3

How to rebuild the portal to the v2 screens ([../v2/](../v2/)) as amended by v3 ([what changed](./what%20changed%20in%20V3.png)).
v3 wins wherever the two differ. v1 is superseded: do not read it or build from it. Every screen is written out below, so
the images are needed only to check look and feel. What this plan leaves out on purpose is listed under step 13; once
the build is done, whatever is still not built goes into [remaining.md](../../plans/remaining.md).

Rules for every step: build to this design only (no legacy paths; remove what a page replaces), GOV.UK components and the
existing Defra theme, colocated tests covering a person with only their own keys, a team member and a team admin, and
`npm run format`, `format:check`, `lint` and `test` green before each pull request. Follow `.github/copilot-instructions.md`.

## Decisions (agreed 21 Oct 2026)

| #   | Question                              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Team description                      | Backend `PATCH /v1/teams/{id}` accepts `description`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| D2  | Role when adding a member             | Backend `POST /v1/teams/{id}/members` accepts `role` (`admin` or `user`, default `user`).                                                                                                                                                                                                                                                                                                                                                                      |
| D3  | Email on add                          | Not now. The add-member inset reads only "They will see the team when they next sign in." Email is left out on purpose (step 13).                                                                                                                                                                                                                                                                                                                              |
| D4  | Models not available to UK teams      | Backend restricts: a model is team-eligible only with a SKU whose `tiers` include `team` and whose regions are all in the UK, and only in environments its catalogue `environments` lists. `GET /v1/models?tier=team` leaves the rest out and `POST /v1/teams/{id}/deployments` refuses them with `model-not-eligible`. The UI still matches the screens ("Not in the UK yet", the inset naming the others), and screen 09 still covers any set-up that fails. |
| D5  | Who receives a team secret            | Backend grants the model to the team's secret for that environment when the deployment turns `active`. Nobody receives a secret from a request; admins reveal with a reason.                                                                                                                                                                                                                                                                                   |
| D6  | Limits                                | Backend exposes limits per team per environment.                                                                                                                                                                                                                                                                                                                                                                                                               |
| D7  | Progress steps                        | Backend records a time per step and names the model: "Setting up {model} in Azure", "Preparing your client secret".                                                                                                                                                                                                                                                                                                                                            |
| D8  | Support reference                     | Frontend only: `AIP-` and the last 5 characters of the deployment's `operationId`, upper case. A backend reference and alert are left out on purpose (step 13).                                                                                                                                                                                                                                                                                                |
| D9  | Signed-in home data                   | One `GET /v1/teams/{id}/deployments` per team; no summary endpoint.                                                                                                                                                                                                                                                                                                                                                                                            |
| D10 | Team in the address                   | Backend team routes accept the slug or the id; frontend addresses use the slug.                                                                                                                                                                                                                                                                                                                                                                                |
| D11 | Secret expiry                         | Show "Expires {date}" only when the credential has `expiresAt` (B18); otherwise the row shows no date.                                                                                                                                                                                                                                                                                                                                                         |
| D12 | Environment names                     | Development = `dev` (and `infradev` on the test instance); Test = `qa`; Pre-production = `preprod`; Production = `prod`.                                                                                                                                                                                                                                                                                                                                       |
| D13 | Test before `qa` exists               | An environment not in `TEAM_ENVIRONMENTS` reads "not available yet". Set up Test is built and tested behind config.                                                                                                                                                                                                                                                                                                                                            |
| D14 | Team tabs                             | Own `app-sub-navigation` component that looks exactly like the screens; no new dependency.                                                                                                                                                                                                                                                                                                                                                                     |
| D15 | `/connect` "What access do you need?" | Removed. "Try it" and "Add to a team" enter their journeys directly.                                                                                                                                                                                                                                                                                                                                                                                           |

"Try on your own" is the research tier on screen; "research" stays in code.

## Environments

Already in place: deployments carry `environment`; a team client secret is one per team per environment; the request API
takes `environment`; `TEAM_ENVIRONMENTS` and `RESEARCH_ENVIRONMENT` in both repositories; one tenant file per team per
environment folder; catalogue `environments` and `capacityPolicy.environments`; `promotedFrom` in the team schema.

This plan adds: one ordered environment list (D12) with availability from `teamEnvironments`, the first available being
where a new request goes (stated, not chosen); the team page grouped by environment; limits per environment (D6); Set up
{environment} to add a team's models to another environment; model steps filtered by what the target environment can
deploy (backend refuses the same, D4); and one helper, `environmentSetUpUrl(team, environment)`, so the link can later point at the
Environments page ([../environment/](../environment/)) by changing one place. The rest is left out on purpose (step 13).

## Build order

One pull request per step, each green and merged before the next. Steps 1 to 3 (backend) may run alongside step 4.

| #   | Repo           | Pull request                                                                                                                                                         | Screens        |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 0   | frontend       | This plan, the v2, v3 and environment images, v1 files renamed `-v1` with a superseded note, links repointed (path-only in `implemented/`); `remaining.md` untouched | none           |
| 1   | backend        | D1, D2, D6, D10                                                                                                                                                      | none           |
| 2   | backend        | D4 team eligibility (UK team SKU, target environment); D7 step times and labels                                                                                      | none           |
| 3   | backend        | D5 secret granted on activation; no team secret returned from issuance                                                                                               | none           |
| 4   | frontend       | Foundations: navigation, environment list and set-up URL, model availability, step list, sub-navigation                                                              | chrome         |
| 5   | frontend       | Models, model detail, journey entry routes; remove the `/connect` access type                                                                                        | 01, 02         |
| 6   | frontend       | Team request journey                                                                                                                                                 | 03 to 09       |
| 7   | frontend       | Teams list, team Models tab, team secret routes, remove a model                                                                                                      | 11, 12, 20, 21 |
| 8   | frontend       | Your access                                                                                                                                                          | 10             |
| 9   | frontend       | Members tab, add a member, change role, remove a person                                                                                                              | 13, 14, 15     |
| 10  | frontend       | Details tab, create a team                                                                                                                                           | 16, 17, 18     |
| 11  | frontend       | Set up Test                                                                                                                                                          | 19             |
| 12  | frontend       | Home                                                                                                                                                                 | 22, 23         |
| 13  | frontend       | Wording sweep, remove superseded code; last, add only what is still not built to the `remaining.md` table                                                            | all            |
| 14  | journey-tests  | Journeys and selectors for the new pages                                                                                                                             | all            |
| 15  | discovery-docs | Built-state record in `build-stories.md#status`                                                                                                                      | none           |

## Step detail

### 0. Plan into the repository

- Add this file and the `v2/`, `v3/` and `environment/` images.
- Do not touch `docs/plans/remaining.md` in this step; it is updated once, in step 13, with only what is still left.
- In `docs/plans/implemented/` change nothing except the three link paths below.
- Rename the v1 files with `git mv`, appending `-v1` (the `v1/images/` folder stays as it is):
  `v1/build-spec.md` → `v1/build-spec-v1.md`, `v1/ui-flow-three-routes.md` → `v1/ui-flow-three-routes-v1.md`,
  `v1/_govuk-frontend.scss` → `v1/_govuk-frontend-v1.scss`.
- Put this note at the top of each renamed file, under its title (as a `//` comment in the `.scss` file):
  "**Superseded.** There is a new plan for the v2 and v3 screens: [../v3/build-plan.md](../v3/build-plan.md). This file
  is kept for history; do not build from it." Inside `build-spec-v1.md`, change `_govuk-frontend.scss` to
  `_govuk-frontend-v1.scss`.
- Repoint links:
  - To this file, the current design: the "source UI flow" links in `.github/instructions/route-plans.instructions.md`
    (lines 28 and 41, and replace the v1 path in its `applyTo` with `docs/flat-design-updates/v3/build-plan.md`),
    `docs/plans/README.md` (line 34) and `README.md` (line 35).
  - To the renamed v1 files, path only (link text and every other word unchanged):
    `docs/plans/implemented/01-portal-journeys.md` lines 4 and 52, `docs/plans/implemented/implemented-features.md`
    line 37, and the comment in `src/client/stylesheets/partials/_chrome.scss` line 4.
  - Backend: `ai-platform-backend-api/.github/instructions/route-plans.instructions.md` line 29 to this file (done in
    step 1's pull request).
- Afterwards, search both repositories for `flat-design-updates/v1/` and confirm every match ends in `-v1.md` or `-v1.scss`
  (images excepted), and that `git diff docs/plans/implemented` shows only those path changes.

### 1. Backend: small API changes (D1, D2, D6, D10)

- Also repoint `.github/instructions/route-plans.instructions.md` line 29 from the v1 flow to
  `ai-platform-frontend/docs/flat-design-updates/v3/build-plan.md` (see step 0).

- `PATCH /v1/teams/{id}` takes `serviceCode` and/or `description` (trimmed, at most 500, may be empty). Admins only.
- `POST /v1/teams/{id}/members` takes `role`, default `user`. Admins only.
- Team routes resolve `{id}` as slug or id.
- `GET /v1/teams/{id}` returns `environments: [{ environment, limits: { requestsPerMinute, tokensPerMinute } }]` for each
  environment the team has a tenant file in, from what the desired-state builder wrote (the defaults today).
- A deployment requested in a new environment copies the limits of the team's first environment.

### 2. Backend: team eligibility (D4) and progress steps (D7)

- One rule, in the catalogue service: a model is team-eligible in an environment when it is eligible, has a SKU with
  `team` in `tiers` whose regions all start `uk` (a SKU without `regions` uses the model's `regions`), and its
  `environments` include that environment. Use the same rule in `team-desired-state.js` when choosing the team SKU.
- `GET /v1/models?tier=team` (optionally `&environment=`) returns only team-eligible models; the unfiltered list is
  unchanged, so the Models page can still say "Not in the UK yet" and "Not for teams yet".
- `POST /v1/teams/{id}/deployments` refuses any model not team-eligible in the requested environment with `400`
  `model-not-eligible`, before anything is written. The frontend already maps that code; keep its message.
- Tests: GPT-4.1 nano (team SKU only in `swedencentral`) is refused and left out; GPT-4o is offered; a model whose
  `environments` lack the target is refused.

- Record when each step starts and ends (status history on the deployment) and return `progressSteps[].at` (ISO time).
- Labels: "Request recorded", "Team checked", "Setting up {model display name} in Azure", "Preparing your client secret".

### 3. Backend: team secret on activation (D5)

- When a deployment turns `active`, grant its model to the team's credential for that environment, creating the
  credential (secret to the vault, never returned) if there is none. Idempotent, under the existing lock.
- `POST /v1/credentials` no longer issues team credentials; remove that path, and its frontend caller in step 6.
- Reveal, rotate and revoke stay admin only.

### 4. Frontend foundations

- **Navigation** (`build-navigation.js`): signed in "Models", "Your access", "Teams", "Help", then "Signed in as {name}"
  and "Sign out"; signed out "Models", "Help", "Sign in". No Home item; the service name links to `/`. `Teams` is current
  for `/teams*`.
- **Environment list** (replaces the radio helpers in `connect/team-environments.js`, extends `environment-names.js`):
  ordered `dev`, `qa`, `preprod`, `prod` named as D12 (`infradev` reads "Development" and takes the `dev` slot when
  configured), each available when in `teamEnvironments`; `defaultTeamEnvironment()` is the first available.
  `environmentSetUpUrl(teamSlug, environment)` returns `/teams/{slug}/{name in lower case}`, e.g. `/teams/flood-risk-mapping/test`.
- **Model availability** (helper beside the models controller): `canTry` (eligible with the `research` tier); team wording
  "Runs in the UK" (a SKU with `team` in `tiers` and every region starting `uk`), "Not in the UK yet" (team SKU only
  outside the UK) or "Not for teams yet" (no team SKU); hide slugs ending `-2` (capacity duplicates); ineligible models
  (for example embeddings) go under "Not available yet" with their `eligibilityReason`.
- **Step list** component (`common/components/step-list`): vertical circles joined by a line; done is a green circle with
  a white tick, current a blue ring spinner with a bold label, waiting a grey ring with a grey label; an optional hint
  under each label; a visually hidden "Done", "In progress" or "Not started" before each label.
- **Sub-navigation** component (`common/components/sub-navigation`): a row of links under the H1, the current one bold
  black with a green bar beneath, the others blue underlined links, a grey rule under the row; `aria-current="page"`.

### 5. Models and model detail (01, 02)

**`/models`**: H1 "Models". Lead "Add a model to your team, or try one on your own first." Button "Add models to a team"
(`/connect/team/start`) and beside it the link "Try a model on your own for 7 days" (`/connect/shared/start`). Select
"Show" with "All models", "Models you can add to a team", "Models you can try on your own", a secondary "Apply" button and
a "Clear" link, bottom-aligned on one row; no provider filter. Table: Model (link) | Good for (use cases) | Try on your own
("Try it" to `/connect/shared/start?modelSlug=`) | Add to a team ("Add to a team" to `/connect/team/start?modelSlug=` with
hint "Runs in the UK", or plain "Not for teams yet" or "Not in the UK yet"). No tags. H2 "Not available yet": name in bold
and reason.

**`/models/{slug}`**: back link "Back to models". Caption provider, H1 name. Lead "Good for {use cases}." Button "Add to a
team" (when "Runs in the UK") and link "Try it on your own" (when `canTry`). H2 "How you can use it", summary list: "For a
team" "A deployment just for your team, in UK South. Shared by the team through one client secret." (or the team wording);
"On your own" "A personal key for 7 days. Requests can be processed outside the UK, so do not use OFFICIAL-SENSITIVE
data."; "Version" "{version}. Pinned, so it will not change under you." H2 "Call it from your code" with the existing curl,
Python and JavaScript tabs and "Copy code", then one line "You need a client secret or a key before this will work."

**Entry routes**: `GET /connect/shared/start` and `GET /connect/team/start` (optional validated `modelSlug`) set the
journey and redirect to `/connect/shared/model` (or `/connect/shared/details` when a model is given) and
`/connect/team/select`. Remove `GET` and `POST /connect`, `connect/index.njk` and the access-type step.

### 6. Team request journey (03 to 09)

Every page has a GOV.UK back link to the previous step, and from 04 a caption with the team name.

**03 `/connect/team/select`**: H1 "Which team is this for?" One radio per team, hint "You are an admin." or "You are a
member." then "Created today, no models yet." or "Has {models} in {environment}." Then the "or" divider and the radio
"Create a team" (to `/teams/new?returnTo=/connect/team/select`); afterwards the new team is listed, not selected. Button
"Continue".

**04 `/connect/team/model`**: H1 is the legend "Which models does your team need?" Hint "Your team gets its own
deployment of each one." Checkboxes for models that read "Runs in the UK" and that the target environment can deploy,
hint the use cases; a model the team already has is disabled with hint "Already set up for this team". Inset "{names}
are not available to teams in the UK yet. See all models" (`/models`). Skip the page when exactly one model is offered and
it came from the model page. Button "Continue".

**05 `/connect/team/details`**: H1 "What will your team use it for? (optional)". Hint "For example, the service or piece
of work it supports. This helps us plan capacity." Character count 500. Inset "**It will be set up in {Development}.**
When it is working, you can set it up in Test and other environments from your team's page." No environment radio.
Button "Continue".

**06 `/connect/team/check`**: H1 "Check your answers". Team, Models and What it is for, each with "Change" that returns
here; Environment "{Development}" with no Change. H2 "Now request access". "We will set up a deployment of {models} for
your team. It usually takes about 2 minutes, and you can leave the page while it happens." Button "Request access".

**07 `/connect/team/request/{team}/{id}`, working**: H1 "Setting up {model} for your team". Lead "This usually takes
about 2 minutes. You can leave this page and come back." Step list with times ("10:41", "Started at 10:42"). "This page
updates by itself. Last checked at {time}." Link "Go to {team}". Keep the meta refresh for no JavaScript; no banner, no
"Stop checking", no "Check now", no pipeline links. Queued: H1 "Waiting for another change to {team} to finish".

**08 ready**: green panel "{model} is ready" / "for {team}, in {Development}". H2 "Get your client secret". "Your team
shares one client secret for {Development}. Have somewhere safe ready to paste it, such as your team's secret store."
Admins: button "Show the client secret" (reveal with a reason, that environment's credential). Members: "Ask an admin of
{team} for the client secret." H2 "What happens next", "Once you have the client secret:" bullets "everyone in {team} can
use {model} with it", "admins can show it again or rotate it from your team's page" (link), "when it is working, you can
set it up in Test" (`environmentSetUpUrl`; only when Test is available).

**09 failed**: H1 "We could not set up {model}". A plain reason, for example "{model} is not available to teams in the UK
yet, so it could not be set up. It should not have been offered to you. {other model} is not affected." H2 "What you can
do", "You can:" bullets "remove it from your team" (to 20), "use {other model}, which your team already has" (when there
is one), "ask the AI Platform team for help, quoting reference **{AIP-XXXXX}**" (D8). Details "Technical details for the AI
Platform team", closed by default: Reference, What failed (`failureReason`), Links (Pull request, Apply run).

### 7. Teams list, Models tab, secret routes, remove a model (11, 12, 20, 21)

**11 `/teams`**: H1 "Teams". Lead "A team shares its models, and has one client secret for each environment." Button
"Create a team". Table Team (link) | Your role ("Admin" or "Member") | Members (count) | Models (one per line, ", setting
up" or bold ", could not be set up" after the name; ready needs no words).

**12 `/teams/{slug}`**: caption "Team", H1 team name, sub-navigation Models | Members | Details (everyone sees all three;
only admins see change actions). One summary card per available environment, titled with its name, card action "Add a
model". Rows: each model with a tag ("Ready to use" green; "Setting up" and "Removing" yellow; "Waiting for another
change" grey; "Setup failed" red), "See what happened" for a failure, "Remove" for admins on ready or failed models.
"Client secret": "Expires {date}" (D11) with "View", "Rotate", "Revoke" for admins, "Ask an admin for it" for members;
hidden when the environment has no models. "Limits": "{rpm} requests and {tpm} tokens a minute". An available environment
with no models: "Not set up. {Environment} gets its own deployments, client secret and limits." and link "Set up
{Environment}" (`environmentSetUpUrl`). After the last model is removed: "No models in {Environment}" and "Add a model".
Under the cards: "{names} are not available yet." and "To change your limits, contact the AI Platform team." The page
refreshes itself while anything is changing. Remove the stacked summary, resource rows and forms.

**Team secret routes**: `/teams/{slug}/client-secrets/{credentialId}/view`, `/rotate` and `/revoke` (GET and POST),
reusing the reveal, rotate and revoke templates and logic from `/manage`; back and cancel return to the Models tab. Remove
the team branch from `/manage`.

**20 `/teams/{slug}/models/{id}/remove`**: caption team, H1 "Remove {model} from {Environment}?" Warning text "Anything
using {model} through your team's address will stop working as soon as it has been removed. Your team's other models and
its client secret are not affected." (never set up: "It was never set up, so nothing is using it."). "Removing takes a few
minutes. You can add the model again later." Warning button "Remove {model}" and link "Cancel".

**21 after removal**: success banner above the caption, heading "{model} is being removed from {Environment}", body "Apps
using it through your team's address will stop working once it has gone. This takes a few minutes." A refusal shows its
message in the same place (for example "Another change to this team is in progress"). The row reads "Removing" with no
actions; a failed removal returns as "Ready to use" with the reason.

### 8. Your access (10)

**`/manage`**: H1 "Your access". Lead "Keys for trying models on your own. A key works for {7} days, and you can renew it
up to {3} times." Table Model | Expires: "{date}, in {n} days", hint "Renewed once" or "Renewed {n} times"; actions
"View", "Renew", "Revoke" (owner only, existing confirm pages). Expired: "Expired on {date}", hint "Renewed {n} times, so
it cannot be renewed again" when at the cap, action "Get a new key". No tags. Link "Try another model on your own". Inset
"Your teams' models and client secrets are on each team's page. Go to Teams". No team rows, "Your models" or "Your teams".

### 9. Members (13, 14, 15)

**13 `/teams/{slug}/members`**: sub-navigation, button "Add a member" (admins). Table Name ("{name} (you)", or "Not signed
in yet" in grey) | Email (masked for non-admins, as today) | Role | "Change" (admins). Under it: "Members can use the
team's models and add new ones. Admins can also see and rotate client secrets, add people, change roles and remove
models."

**14 `/teams/{slug}/members/add`**: caption team, H1 "Add a member". "Email address", hint "Their Defra work address, for
example name@defra.gov.uk". Radios "Role": "Member" (default; hint "Can use the team's models and add new ones"), "Admin"
(hint "Can also see and rotate client secrets, add people, change roles and remove models"). Inset "They will see the
team when they next sign in." (D3). Button "Add a member".

**15 `/teams/{slug}/members/{memberId}/role`** (`me` for yourself): H1 "Change your role" or "Change {name}'s role". The
same radios. Last admin: error summary and field error "You are the only admin. Add another admin before you change your
role." Button "Save role". Link "Remove yourself from this team" or "Remove {name} from this team" to
`/teams/{slug}/members/{memberId}/remove`: H1 "Remove {name} from {team}?", warning "Removing someone does not change the
client secret. Rotate it if they had a copy.", the same last-admin rule, warning button "Remove {name}", link "Cancel".

### 10. Details and create a team (16, 17, 18)

**18 `/teams/{slug}/details`**: sub-navigation. Summary list: Team name; Team ID `{slug}`, hint "Part of your team's
address on the gateway. It cannot change."; Service code, hint "Not checked yet" (plain text while not verified),
"Change" (admins); What the team does, "Change" (admins). Change pages `/teams/{slug}/details/service-code` and
`/teams/{slug}/details/description` return here with a success banner.

**16 `/teams/new`**: back link. H1 "Create a team". "Team name", hint "This also makes your team ID, which cannot be
changed later." "Service code" (width 3), hint "3 letters or numbers, for example FRM. Your team's AI use is charged to
this code." (format and existence only; codes may be shared). "What the team does (optional)", character count 500. Button
"Continue".

**17 `/teams/new/check`**: H1 "Check your answers": Team name (Change), Team ID with hint "Cannot be changed later" (no
Change), Service code (Change), What the team does (Change). "You will be the team's first admin. You can add other
people, and other admins, once it is created." Button "Create a team". Then, from the request journey, back to 03 with the
new team listed and not selected; from Teams, to the new team's Members tab.

### 11. Set up Test (19)

**`/teams/{slug}/test`** (any available environment by its lower-case name): caption team, H1 "Which models do you want in
Test?" Hint "These are the models your team has in Development." Checkboxes ticked, hint "Ready in Development", only
models the target environment can deploy. H2 "What happens next", "When you continue:" bullets "we set up a separate
deployment of each model in Test", "your team gets a separate client secret for Test", "Test starts with the same limits
as Development". Button "Continue" to 06 with Environment "Test", then 07 "Setting up {model} in Test". An environment not
in `teamEnvironments` returns 404.

### 12. Home (22, 23)

**`/` signed out**: H1 "Get AI model access". Lead "Use approved AI models in your Defra service. You do not need an Azure
account." Start button "Start now" (sign in, then `/models`). H2 "Who it is for": "Anyone at Defra building a service or
trying an idea out. Sign in with your Defra account." H2 "Two ways to get access": H3 "For your team's service" "Your team
gets its own deployment of a model in the UK, set up in Development first. Everyone in the team uses it through one client
secret."; H3 "To try a model on your own" "A personal key that works for 7 days, with 60 requests a minute and 100,000
tokens a day. Do not put OFFICIAL-SENSITIVE data through it." H2 "Browse without signing in", link "See the models you can
use".

**`/` signed in**: H1 "Get AI model access". Lead "Use approved AI models in your Defra service." Button "Add models to a
team" and link "Try a model on your own". H2 "Needs your attention", only when not empty: "{model} could not be set up for
{team}. See what happened", "{model} is being set up for {team}. Check progress", and own keys within 3 days of running out
("Your key for {model} runs out on {date}. Renew it"). H2 "Your teams": link to each team's Models tab and "{Admin or
Member}. {model} in {Development}." or "{model} setting up." H2 "Your own keys": "You have {n} key(s), for {models}. It
expires on {date}. Go to Your access" or "You have no keys of your own." Remove the expiry banner and team insets.

### 13. Clean-up and documents

- Replace "research tier" and "Research" wording on every page with "on your own"; code names stay.
- Remove what the new pages replaced: the access-type page, the environment radio and its helpers, `/manage` team rows,
  "Stop checking", resource rows, inline member forms, and their tests and session fields.
- Do not edit `docs/plans/implemented/` (the step 0 link paths were the only exception).
- Last of all, once steps 1 to 12 are done: add to the "At a glance" table in `docs/plans/remaining.md` only what is still
  not built, as rows (no new section, no new file, no row for work that was built). Start from the list below, drop
  anything that got built, and add anything from steps 1 to 12 that was blocked or left unfinished, with what blocks it.

**Left out on purpose (candidates for remaining.md):**

| Category   | Item                                                                                                                                                                                                                                                                                 | State                 | Blocked by                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------- |
| UI flow v3 | Email a person added to a team (GOV.UK Notify adapter behind a port, key in the vault, one template); the add-member inset then adds "We will email them to say they have been added."                                                                                               | Deferred, not removed | A decision to start it    |
| UI flow v3 | Backend support reference for a failed set-up, in the support link, with an automatic alert to the platform team (B22 channel); replaces the frontend `AIP-` reference built from `operationId`                                                                                      | Deferred, not removed | B22 alert channel         |
| UI flow v3 | Environments page ([mock-up](../flat-design-updates/environment/)): release pipeline across Development, Test, Pre-production and Production, promotion via `promotedFrom`, health and checks, Production approvals, capacity, audit, usage; then `environmentSetUpUrl` points there | Not started           | Design sign-off           |
| UI flow v3 | Test environment: `qa` estate, `TEAM_ENVIRONMENTS` and `AIP_ENVIRONMENTS` in both repositories, registry entry, tenants and deployments folders; until then Test reads "not available yet"                                                                                           | Not started           | `qa` subscription         |
| UI flow v3 | Team secret expiry per environment (with B18: at most 3 months in DEV and QA, a year in PREPROD and PROD); the team Models tab shows "Expires {date}" once the backend sets `expiresAt`                                                                                              | Not started           | Entra admin consent (B18) |
