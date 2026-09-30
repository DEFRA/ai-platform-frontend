# Build spec: Get AI model access

Text version of the fifteen design sheets, so nothing has to be read off an image.

Each page below lists the components in the order they appear, then the exact copy.
Component names are GOV.UK Frontend macros. Copy is final, not placeholder.

Pair this with `_govuk-frontend.scss` in the same folder, which does the theme.

---

## How to use this instead of the images

Images are the most expensive and least precise input you can give a model. A page
of screenshot is thousands of vision tokens and the model still has to guess your
markup. This file is a few hundred tokens per page and names the macro.

Suggested order, cheapest first:

1. **Theme, once.** Drop in `_govuk-frontend.scss`. That is roughly 60% of the
   visual change and it applies to every page at once. No AI needed.
2. **Chrome, once.** Header, nav and footer (below). One layout file.
3. **Content changes, no AI at all.** Every note tagged _Content_ on the sheets is a
   string swap in a template. Grep and replace.
4. **Presenter layer, once.** One filter that every enum and date passes through.
   Kills a whole class of drift permanently.
5. **Per page, one at a time.** Paste only that page's section from this file. One
   page per prompt keeps context small and the output accurate.

Do not paste the whole file at once, and do not paste it alongside the images.

---

## Chrome: header, navigation, footer

Applies to every page. Replaces the GOV.UK header and footer, which Defra branding
does not allow off a GOV.UK domain.

### Header

```html
<header class="defra-header">
  <div class="defra-header__inner">
    <img
      class="defra-header__logo"
      src="/assets/defra-logo.svg"
      alt="Department for Environment, Food &amp; Rural Affairs"
    />
    <a href="/" class="defra-header__svc">Get AI model access</a>
  </div>
</header>
```

| Property        | Value                                                           |
| --------------- | --------------------------------------------------------------- |
| Background      | `#ffffff`                                                       |
| Inner container | `max-width: 960px; margin: 0 auto; padding: 12px 15px`          |
| Layout          | `display: flex; align-items: center; gap: 22px`                 |
| Logo            | `115px` wide, `60px` tall, the Defra SVG                        |
| Service name    | `24px`, `#0b0c0c`, no underline, baseline aligned with the logo |

Service name comes from `serviceName` in `src/config/config.js`. It currently reads
`ai-platform-frontend`, which also appears in every page title.

### Navigation

`govukServiceNavigation` exists in govuk-frontend 6. Restyle it to Defra's bar rather
than building one.

| Property           | Value                                                               |
| ------------------ | ------------------------------------------------------------------- |
| Background         | `#008531`                                                           |
| Bottom rule        | `1px solid rgba(255,255,255,0.3)`                                   |
| Inner container    | `max-width: 960px; margin: 0 auto`                                  |
| Link               | `#ffffff`, `16px`, weight `400`, `padding: 12px 16px`, no underline |
| Link bottom border | `4px solid transparent`                                             |
| Active item        | weight `700`, `border-bottom-color: #ffffff`, `aria-current="page"` |

Items, signed in: **Models**, **Your access**, **Help**, then right-aligned
`Signed in as {name}` and **Sign out**.
Signed out: **Models**, **Help**, then **Sign in**. No "Your access".

Dropped from the current nav: **Home**, because the service name links home, and
**Connect to a model**, because it is a task rather than a place.

### Phase banner

`govukPhaseBanner`, Alpha tag, pointing at a real feedback form.

> This is a new service. [Give feedback](#) to help us improve it.

### Footer

```html
<footer class="defra-footer">
  <div class="govuk-width-container">
    <ul>
      <li>Privacy</li>
      <li>Cookies</li>
      <li>Accessibility statement</li>
    </ul>
    <p>
      Maintained by the AI Capability and Enablement team at Defra. If you've
      got a question or want to feed back, <a href="#">get in touch</a>.
    </p>
    <p>
      All content is available under the
      <a href="#">Open Government Licence v3.0</a>, except where otherwise
      stated
    </p>
  </div>
</footer>
```

| Property   | Value                         |
| ---------- | ----------------------------- |
| Top rule   | `10px solid #008531`          |
| Background | `#f3f2f1`                     |
| Padding    | `25px 0`                      |
| Links      | `#0b0c0c`, `16px`, underlined |

---

## Presenter layer

One place every enum and date passes through, so the raw values stop reaching the
screen. Build this before the page work.

| Raw              | Shown           |
| ---------------- | --------------- |
| `openai`         | OpenAI          |
| `anthropic`      | Anthropic       |
| `uksouth` / `uk` | UK South        |
| `research, team` | Research, Team  |
| `gpt-4o`         | GPT-4o          |
| `active`         | Active          |
| `pending`        | Setting up      |
| `revoked`        | Revoked         |
| `expired`        | Expired         |
| `failed`         | Failed          |
| `approved`       | Approved        |
| `not-approved`   | Not approved    |
| `planned`        | Planned         |
| ISO timestamp    | 12 October 2026 |

---

## 01. Home, signed out: `/`

`govukPhaseBanner` · `h1` · lead paragraph · `govukButton isStartButton` ·
`h2` + body ×3 · `govukInsetText` · `h2` + link

```
h1      Get AI model access
lead    Use approved AI models in your Defra service. You do not need an
        Azure account.
button  Start now

h2      Who it is for
body    Anyone at Defra building a service or trying an idea out. Sign in with
        your Defra account.

h2      How it works
body    It takes about 5 minutes.
list    Pick a model from the list.
        Tell us what you are building.
        Get a key and a code example to paste into your service.

h2      What you get
list    A key that works for 7 days, in the Sandbox environment.
        60 requests a minute and 100,000 tokens a day.
        Models hosted in the UK, so your data stays in the UK.
inset   This service is in alpha. Sandbox is for building and trying things
        out. Do not put OFFICIAL-SENSITIVE data through it.

h2      Browse without signing in
link    See the models you can use
```

---

## 02. Home, signed in: `/`

`govukNotificationBanner` (Important) · `h1` · lead · `govukButton isStartButton` ·
`h2` · `govukInsetText` · link

The banner shows only when a key has 3 days or fewer left.
The inset shows only when the caller is in a team that holds a key. Needs the API
to return the caller's team keys on this route.

```
banner  Important
        Your research key runs out in 3 days, on 1 October 2026.
        Renew your key

h1      Get AI model access
lead    Use approved AI models in your Defra service. You do not need an
        Azure account.
button  Browse models

h2      Your access
inset   {Team} already has a key for GPT-4o and GPT-4o mini. Anyone in the team
        can use it, so you may not need your own.
        View the {Team} key
link    See every key you and your teams hold
```

---

## 03. Models: `/models`

`h1` · body · two `govukSelect` + `govukButton secondary` + Clear link · result
count · `govukTable`

Columns: **Model**, **Provider**, **Tier**, **Where it runs**, **Context window**
(right aligned), **Status**.

Ineligible rows: no link on the model name, `aria-disabled="true"`, secondary text
colour, and the reason in a cell spanning Tier, Where it runs and Context window.

```
h1      Models
body    Models you can use, and the ones you cannot use yet.
label   Provider          (select, default "All providers")
label   Tier              (select, default "All tiers")
button  Apply filters     (secondary)
link    Clear filters
count   Showing 6 models

tags    Approved          govukTag green
        Not approved      govukTag grey
        Planned           govukTag grey

reason  Hosted in the US, not the UK or EU
        Not assured for Defra use yet
```

Status wording comes from the provider status in B04. Do not use "Available": the
platform keeps _available model_, _eligible offering_ and _active grant_ as separate
things and "Available" blurs them.

---

## 04. Model detail: `/models/{slug}`

`govukBackLink` · `h1` · caption · `govukSummaryList` · `govukButton` · `h2` + list ·
`h2` + `govukTabs` with code · `govukInsetText`

Code runs full width, not in a two-thirds column, or the curl line gets cut off.

```
back    Back to models
h1      GPT-4o
caption OpenAI, hosted by Defra in UK South

summary Provider            OpenAI
        Version             2024-08-06 (pinned)
        Context window      128,000 tokens
        Where it runs       UK South, UK data zone
        Tiers               Research, Team
        Rate limit          60 requests a minute
        Daily allowance     100,000 tokens

button  Connect to this model

h2      Good for
list    Summarising and rewriting text
        Pulling structured data out of documents
        Answering questions over content you supply

h2      Call it from your code
tabs    curl · Python · JavaScript
inset   This endpoint is a mock while the gateway is being built. Calls to it
        will not reach a model yet.
```

The heading "Connect to this model" currently sits directly above a button with the
same words. Keep the button, drop the heading.

---

## 05. Connect, what access: `/connect`

`govukBackLink` · `h1` · hint with Change link · `govukRadios` · body · `govukButton`

```
back    Back
h1      What access do you need?
hint    You are connecting to GPT-4o. Change model

radio1  Just for me, to research or try something out
  hint  A key that lasts 7 days in Sandbox. No team needed. Ready in about
        a minute.
radio2  For my team
  hint  A key the whole team shares. Admins can rotate or revoke it. Takes a
        few minutes to set up.

body    Not sure? Start with research access. You can move to a team key later
        and keep the same sign-in.
button  Continue
```

The model arrives from the page people came from. Do not ask for it again; show it
with a Change link, the way Check your answers does.

---

## 06. Connect, purpose: `/connect/shared/details`

`govukBackLink` · `h1` · hint · `govukCharacterCount` · `h3` + list ·
`govukCheckboxes` (one) · `govukButton`

```
back    Back
h1      What will you use GPT-4o for?
hint    A sentence is enough. We use this to understand what people are
        building, and to help you if a call is blocked.
count   500 characters

h3      Before you continue
body    A research key comes with limits:
list    building and research only, not a live service
        no OFFICIAL-SENSITIVE data
        it stops working after 7 days
        you can renew it 3 times, then you need a team key

check   I understand these limits
button  Continue
```

---

## 07. Connect, validation errors: `/connect/shared/details`

Same page plus `govukErrorSummary` at the top of `<main>`, below the back link and
above the `h1`. Page title prefixed `Error: `.

```
summary There is a problem
        Enter what you will use GPT-4o for
        Confirm that you understand the limits

inline  Error: Enter what you will use GPT-4o for
        Error: Confirm that you understand the limits
```

Rules: summary text and inline message match word for word. Each summary line links
to its field. Show the summary even for a single error. Never "please", "sorry",
"valid", "invalid" or "required field". Re-render what people typed.

`validation` lands here. `active-credential-exists` and `renewal-cap-reached` come
back from the confirm step, so they belong on page 08.

---

## 08. Check your answers: `/connect/shared/check`

`govukBackLink` · `h1` · `govukSummaryList` with Change links · `govukWarningText` ·
`govukButton`

```
back    Back
h1      Check your answers

rows    Model                      GPT-4o                    Change
        Access for                 Just me, research         Change
        What you will use it for   {purpose}                 Change
        Environment                Sandbox
        Rate limit                 60 requests a minute
        Daily allowance            100,000 tokens
        Runs out                   5 October 2026

warn    Your key is shown once. Have somewhere ready to copy it to.
button  Confirm and get my key
```

Every Change link carries visually hidden text: `Change<span class="govuk-visually-hidden"> model</span>`.

`POST /v1/credentials` fires from this button, not earlier.
`409 active-credential-exists` returns here: show the existing key and link to it,
do not issue a second. `502 upstream-unavailable` shows a retry page, never a secret.

---

## 09. Your key, shown once: `/connect/shared/credential`

`govukPanel` · `govukWarningText` · `h2` + read-only input + copy button ·
`govukSummaryList` · `h2` + `govukTabs` · `govukInsetText` · `h2` + links

```
panel   Your key is ready
        GPT-4o, in Sandbox
warn    This key is shown once. Copy it now and store it safely.

h2      Your key
input   readonly, aria-label "Your key"
button  Copy key                   (secondary, progressive enhancement)

summary Endpoint           mock-gateway.ai-platform.defra.gov.uk
        Deployment name    gpt-4o
        API version        2024-10-21
        Rate limit         60 requests a minute
        Daily allowance    100,000 tokens
        Runs out           5 October 2026

h2      Try it now
inset   The gateway is still being built, so this call will not reach a model
        yet. Your key is real and will work when the gateway goes live.

h2      What next
links   See this key and your other access
        Read the quick start guide
        Tell us how that went
```

The key is substituted into the code example, so it is paste and run with no
placeholder to swap. Page excluded from caching and from back-forward cache.

---

## 10. Setting up a team key: `/connect/team/request/{teamId}/{id}`

`h1` · lead · `govukNotificationBanner` · `h2` + status list · timestamp ·
`govukButton secondary` · links

One route that changes state, per B09. It becomes the key page when the work
finishes.

```
h1      Setting up your team key
lead    GPT-4.1 for {Team}, in Sandbox.
banner  In progress
        This usually takes about 2 minutes. You can leave this page and
        come back.

h2      Progress
steps   Done        Request recorded
        Done        Team checked
        Doing now   Setting up access in Azure
        To do       Creating your key

note    Last checked at 14:32. This page checks again every 10 seconds.
button  Stop checking
links   Check now · Go to your access
```

Wrap the step list in `aria-live="polite"` so a screen reader hears each change.
Keep the meta refresh as the no-JavaScript fallback but add the visible stop
control: without one this risks failing WCAG 2.2 SC 2.2.1 Timing Adjustable, and it
throws focus to the top of the page on every cycle.

Status tag widths are fixed so the step names share a left edge.

---

## 11. Your access: `/manage`

`h1` · `govukTable` with caption · `h2` + second table · `h2` + line

One table, not three, and no tabs. Tabs hide rows and grow with every team joined;
GDS advises against them where people compare content, which is this page's job.

```
h1      Your access
caption Keys you can use
cols    For · Models · Environment · Status · Runs out · Actions

row1    You / Research      GPT-4o, ends 9d4f          Sandbox
        3 days left (orange tag)    1 October 2026     Renew · Revoke
row2    {Team} / Team       GPT-4o, GPT-4o mini, ends 2b17   Sandbox
        Active (green tag)          12 October 2026    Rotate · Revoke

h2      Being set up            (only render when something is pending)
cols    Model · For · Status · Actions
row     GPT-4.1 · {Team} · Setting up (blue tag) · Check progress

h2      Your teams
body    You are an admin of {Team}. See who is in {Team}
```

The **Models** column is the important addition. Since 25 September one key covers
several models through `allowedDeployments[]` and nothing on screen says which. For
a shared team key that is the thing people most need to know.

Key hint renders as `ends 9d4f`, not `…9d4f`. The ellipsis form makes a screen
reader read an ellipsis and four characters with nothing to say what they are.

Rotate and Revoke are admin only. Already true in the template; confirm the API
returns `403 admin-required` as well.

---

## 12. Your access, nothing yet: `/manage`

```
h1      Your access
h2      Keys you can use
body    You do not have a key yet.
body    Pick a model and answer three short questions. It takes about 5 minutes.
button  Browse models

h2      Your teams
body    You are not in a team yet.
body    Team keys are shared, last longer and can be rotated. If your team
        already has one, ask an admin to add you.
links   Create a team · Read about teams
```

Both empty states get a way out. The teams one currently dead-ends.

---

## 13. Team members and roles: `/teams/{id}`

`govukBackLink` · `h1` · `govukSummaryList` · `h2` + `govukTable` ·
`govukButton secondary` · `govukWarningText`

```
back    Back to your access
h1      {Team}
summary Service code        FPS  [To be verified, yellow tag]
        What the team does  {description}
        Your role           Admin

h2      Members
cols    Name · Email · Role · Status · Actions
tags    Active (green) · Invited (blue, until first sign-in)
button  Add a member
warn    Removing someone does not change the team key. Rotate it if they had
        a copy.
```

The service code is captured but checked against nothing, so say so rather than
letting people assume it is confirmed.

---

## 14. Rotate a team key: `/manage/rotate/{id}`

`govukBackLink` · `h1` (the question) · `govukWarningText` · body · `h3` + list ·
`govukSummaryList` · `govukButton --warning` + cancel link

```
back    Back to your access
h1      Are you sure you want to rotate the {Team} key?
warn    Anything using the old key stops working straight away.
body    You get a new key on the next page. It is shown once, so have
        somewhere ready to paste it.

h3      Before you rotate
list    Tell anyone using this key that it is changing.
        Have your deployment pipeline or secret store open.

summary Key           {Team}, ends 2b17
        Models        GPT-4o, GPT-4o mini
        Environment   Sandbox

button  Yes, rotate the key        (govuk-button--warning)
link    No, keep the key I have
```

The way out is a link, not a second button, so there is one obvious primary action.
A crafted POST from someone who is not an admin returns 403.

---

## 15. Navigation

No page. It sets the rule the nav follows: three items, and everything phase 2 adds
attaches beneath an existing section rather than beside it. Five of the eight phase 2
surfaces belong to a team, so they sit under Your access as `/teams/{id}/...`.

---

## Accessibility, carried forward

Two defects in the current build that these designs fix, worth doing early because
both are cheap:

1. **Auto-refresh with no control.** `/manage` and the team request page both use
   `<meta http-equiv="refresh">` with no way to pause, stop or extend. See page 10.
2. **Missing landmarks.** The header and footer render as `<div>` with no role, so
   screen reader users lose landmark navigation. Stock govuk-frontend outputs
   `<header>` and `<footer>`, so something in the template chain has changed it.

Still needs a person rather than a design: keyboard path through the connect journey
and the one-time reveal, zoom to 200%, 320px reflow (the six column table on page 11
and the code blocks are the two most likely to break), and forced colours.
