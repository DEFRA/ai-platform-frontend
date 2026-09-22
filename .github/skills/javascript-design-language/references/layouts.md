# AICE Layout Patterns

Every page uses one of two visual modes. The choice is determined by the page's role in the information architecture.

---

## Entry/hub pages

**When to use:** Top-level section gateways and the home page. Pages that introduce a major area of the service rather than presenting detail content.

**Visual signature:** Large full-viewport-width green hero banner at the top, followed by tile grids or stat cards.

**Structure:**

```
┌─────────────────────────────────────────────────────────┐
│  .defra-header (white, logo + service name + search)    │
├─────────────────────────────────────────────────────────┤
│  .defra-primary-nav (Defra green bar, white links)      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  .defra-hero (full-viewport-width Defra green)          │
│    ┌─────────────────────────────────────────────────┐  │
│    │  .defra-width-container (960px max)              │  │
│    │    .govuk-heading-xl   ← white                   │  │
│    │    .govuk-body-l       ← white                   │  │
│    └─────────────────────────────────────────────────┘  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  .defra-width-container                                 │
│    .defra-version-banner (optional)                     │
│    .defra-section                                       │
│      .defra-tile-grid (3-col tiles)                     │
│    .app-hub__stats (4-col stat cards, optional)         │
│    .app-hub__section + .app-hub__card-list (optional)   │
├─────────────────────────────────────────────────────────┤
│  .defra-footer (Defra green top border)                 │
└─────────────────────────────────────────────────────────┘
```

**Key requirements:**
- `.govuk-main-wrapper` must have `padding-top: 0` so the hero sits flush below the nav bar
- The hero uses `width: 100vw; left: 50%; transform: translateX(-50%)` — the parent must not have `overflow-x: hidden` at the `<html>` or `<body>` level
- Breadcrumbs on entry pages (if shown) use `.defra-breadcrumbs--inverse` (white text overlaid on the hero), not the standard breadcrumb bar

**Variants:**
- **Home page:** Single-column hero, then tile grid
- **Section gateway:** Hero may include a `.defra-hero__whats-new` sidebar column, followed by stat cards and hub card sections

---

## Content pages

**When to use:** All pages that present information rather than gateway navigation — articles, guides, reference pages, and form steps.

**Visual signature:** Green breadcrumb bar below navigation, content in a column layout, no hero.

### Standard article (two-thirds column)

```
┌─────────────────────────────────────────────────────────┐
│  .defra-header                                          │
├─────────────────────────────────────────────────────────┤
│  .defra-primary-nav                                     │
├─────────────────────────────────────────────────────────┤
│  .defra-breadcrumb-bar (Defra green strip, white text)  │
├─────────────────────────────────────────────────────────┤
│  .defra-width-container                                 │
│    .govuk-grid-row                                      │
│      .govuk-grid-column-two-thirds                      │
│        .govuk-heading-xl                                │
│        <article content>                                │
│        .defra-support-box (optional)                    │
├─────────────────────────────────────────────────────────┤
│  .defra-footer                                          │
└─────────────────────────────────────────────────────────┘
```

### Content with left sidebar navigation

Used when a section has multiple pages that share a common nav.

```
┌─────────────────────────────────────────────────────────┐
│  .defra-header                                          │
├─────────────────────────────────────────────────────────┤
│  .defra-primary-nav                                     │
├─────────────────────────────────────────────────────────┤
│  .defra-breadcrumb-bar                                  │
├─────────────────────────────────────────────────────────┤
│  .defra-width-container                                 │
│    .govuk-grid-row                                      │
│      .govuk-grid-column-one-quarter                     │
│        .app-sub-navigation (sticky on desktop)         │
│      .govuk-grid-column-three-quarters                  │
│        <content>                                        │
├─────────────────────────────────────────────────────────┤
│  .defra-footer                                          │
└─────────────────────────────────────────────────────────┘
```

The `.app-sub-navigation` becomes sticky (`position: sticky; top: 20px`) on viewports ≥ 648px.

---

## Form journey pages

Used for multi-step journeys (e.g. triage).

### Question page

Standard GDS question page pattern with back link, error summary, and a single question per page.

```
┌─────────────────────────────────────────────────────────┐
│  .defra-header                                          │
├─────────────────────────────────────────────────────────┤
│  .defra-primary-nav                                     │
├─────────────────────────────────────────────────────────┤
│  .govuk-main-wrapper                                    │
│    .govuk-back-link                                     │
│    .govuk-grid-column-two-thirds                        │
│      .govuk-error-summary (if errors)                   │
│      <form>                                             │
│        govukRadios / govukInput / govukTextarea         │
│        govukButton "Continue"                           │
├─────────────────────────────────────────────────────────┤
│  .defra-footer                                          │
└─────────────────────────────────────────────────────────┘
```

### Confirmation page

Journey end state using the GOV.UK panel component.

```
┌─────────────────────────────────────────────────────────┐
│  .defra-header                                          │
├─────────────────────────────────────────────────────────┤
│  .defra-primary-nav                                     │
├─────────────────────────────────────────────────────────┤
│  .govuk-main-wrapper                                    │
│    govukPanel (green, "Application submitted" + ref)    │
│    <next steps content>                                 │
├─────────────────────────────────────────────────────────┤
│  .defra-footer                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Responsive behaviour

| Breakpoint | Change |
|-----------|--------|
| ≤ 768px | Header search hidden; nav collapses to hamburger |
| ≤ 776px | Tile grid: 3 → 1 column; hub cards: 2 → 1 column; stat cards: 4 → 2 columns |
| ≤ 648px | Sidebar nav: sticky → normal flow (stacks above content) |
| ≤ 480px | Service name: 18px → 16px; logo: 45px → 40px; stat cards: 2 → 1 column |
