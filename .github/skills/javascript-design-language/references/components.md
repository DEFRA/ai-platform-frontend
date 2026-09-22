# AICE Component Reference

Components are divided into two groups:

- **`.defra-*`** — shared brand components, used across all page types
- **`.app-*`** — feature-specific components, used in specific contexts

---

## Shared brand components

### `.defra-header`

White background header containing three grid columns: logo | service name | search.

```html
<header class="defra-header">
  <div class="defra-header__inner">
    <!-- Logo -->
    <a href="/" class="defra-header__logo-link">
      <img class="defra-header__logo" src="/assets/defra-logo.svg" alt="Defra">
    </a>
    <!-- Service name -->
    <a href="/" class="defra-header__service-name">Defra Service Manual</a>
    <!-- Search (optional) -->
    <form class="defra-header-search" role="search">
      <div class="defra-header-search--nhs">
        <div class="defra-header-search__wrapper">
          <input class="defra-header-search__input" type="search" name="q">
        </div>
        <button class="defra-header-search__button" type="submit">
          <!-- search icon svg -->
        </button>
      </div>
    </form>
  </div>
</header>
```

Key details:
- Grid: `grid-template-columns: auto 1fr auto; gap: 24px`
- Service name colour: `#00a33b` (Defra green AA)
- Service name font: Arial, 22px bold (responsive: 18px at 768px, 16px at 480px)
- Search hidden on mobile (max-width: 768px)
- Logo height: 60px (responsive: 45px at 768px, 40px at 480px)

---

### `.defra-primary-nav`

Full-width Defra green bar directly below the header. White text links in a horizontal flex row.

```html
<nav class="defra-primary-nav" aria-label="Primary navigation">
  <div class="defra-primary-nav__inner">
    <ul class="defra-primary-nav__list">
      <li><a class="defra-primary-nav__link defra-primary-nav__link--current" href="/service-manual">Digital service manual</a></li>
      <li><a class="defra-primary-nav__link" href="/delivery-groups">Delivery groups</a></li>
    </ul>
  </div>
</nav>
```

Key details:
- Background: `#008531`
- Links: white, underlined, 16px
- Add `defra-primary-nav__link--current` for the active section

---

### `.defra-service-navigation`

Responsive secondary navigation for within a section. Shows a hamburger toggle on mobile.

```html
<nav class="defra-service-navigation" aria-label="Section navigation">
  <div class="defra-service-navigation__inner">
    <button class="defra-service-navigation__toggle" aria-expanded="false">Menu</button>
    <ul class="defra-service-navigation__list">
      <li><a class="defra-service-navigation__link" aria-current="page" href="/section/page">Page title</a></li>
    </ul>
  </div>
</nav>
```

---

### `.defra-breadcrumb-bar`

Full-width Defra green strip containing breadcrumb navigation. White text and links.

```html
<div class="defra-breadcrumb-bar">
  <div class="defra-width-container">
    <nav aria-label="Breadcrumb">
      <a class="defra-breadcrumb-bar__link" href="/">Home</a>
      <span class="defra-breadcrumb-bar__separator" aria-hidden="true">/</span>
      <span class="defra-breadcrumb-bar__current">Current page</span>
    </nav>
  </div>
</div>
```

Key details:
- Background: `#008531`; all text white
- Used on content pages — **not** on entry/hero pages (breadcrumbs there use `.defra-breadcrumbs--inverse`)

---

### `.defra-hero`

**Entry/hub pages only.** Full-viewport-width green banner with white heading and body text. The most visually distinctive element of the AICE design language.

```html
<div class="defra-hero">
  <div class="defra-width-container">
    <h1 class="govuk-heading-xl">Service name</h1>
    <p class="govuk-body-l">A short description of what this service provides.</p>
  </div>
</div>
```

Key details:
- `width: 100vw; left: 50%; transform: translateX(-50%)` — bleeds past the container to full viewport width
- Background: `#008531`; text: white
- Padding: `40px 15px`
- `.govuk-heading-xl` and `.govuk-body-l` inside the hero are forced white automatically
- `.govuk-main-wrapper` must have `padding-top: 0` so the hero sits flush below the nav

**With "What's new" sidebar variant:**

```html
<div class="defra-hero">
  <div class="defra-width-container" style="display: flex; gap: 30px;">
    <div>
      <h1 class="govuk-heading-xl">Service name</h1>
      <p class="govuk-body-l">Description</p>
    </div>
    <aside class="defra-hero__whats-new">
      <h2 class="govuk-heading-s">What's new</h2>
      <ul class="govuk-list govuk-list--bullet">
        <li>Recent update</li>
      </ul>
    </aside>
  </div>
</div>
```

The `.defra-hero__whats-new` box has a semi-transparent white border (`rgba(255,255,255,0.6)`).

---

### `.defra-tile-grid` / `.defra-tile`

3-column responsive card grid. The primary way to present a set of links on entry/hub pages.

```html
<ul class="defra-tile-grid">
  <li>
    <div class="defra-tile">
      <h3 class="govuk-heading-s defra-tile__title">
        <a class="defra-tile__link" href="/section">Section name</a>
      </h3>
      <p class="govuk-body-s defra-tile__body">Short description of the section.</p>
    </div>
  </li>
</ul>
```

Key details:
- Grid: 3 columns → 1 column at ≤776px
- Tile border: `1px solid #b1b4b6`; hover: `#008531` border, light grey background, lift effect
- Accessible: only the heading is the semantic link; a CSS `::after` pseudo-element stretches click target to the full card
- Link colour: `#1d70b8` (GOV.UK blue)
- Half-width variant: add `defra-tile-grid--half` for a 2-column grid

---

### `.defra-version-banner`

An informational strip used below the hero on entry pages to flag version/status information.

```html
<div class="defra-version-banner">
  <span class="defra-version-banner__label">v2.1</span>
  <p class="defra-version-banner__text">Last updated January 2025. <a href="/changelog">See what's changed</a>.</p>
</div>
```

- Light grey background, mid-grey border
- Green label badge (white text, bold)

---

### `.defra-support-box`

Contact/help box used at the bottom of content pages.

```html
<div class="defra-support-box">
  <h2 class="govuk-heading-s">Get help</h2>
  <p class="govuk-body">Contact the team at <a href="mailto:team@defra.gov.uk">team@defra.gov.uk</a>.</p>
</div>
```

- Light grey background, 5px left border in `#008531`
- `margin-top: 40px`

---

### `.defra-footer`

Custom footer with Defra green top border and meta links.

```html
<footer class="defra-footer">
  <div class="defra-width-container">
    <div class="defra-footer__meta">
      <div class="defra-footer__meta-item">
        <ul class="defra-footer__inline-list">
          <li class="defra-footer__inline-list-item">
            <a class="defra-footer__link" href="/privacy">Privacy</a>
          </li>
          <li class="defra-footer__inline-list-item">
            <a class="defra-footer__link" href="/accessibility">Accessibility</a>
          </li>
        </ul>
      </div>
      <div class="defra-footer__meta-item">
        <p class="defra-footer__licence-description">
          All content is available under the
          <a class="defra-footer__link" href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>.
        </p>
      </div>
    </div>
  </div>
</footer>
```

- Top border: `10px solid #008531`
- Background: `#f3f2f1` (GOV.UK light grey)
- Links: black (`#0b0c0c`) by default

---

### `.defra-alert`

Warning/information strip with an orange left border.

```html
<div class="defra-alert" role="alert">
  <p class="govuk-body">This content is in draft and subject to change.</p>
</div>
```

---

## Feature-specific components

### `.app-hub__card` / `.app-hub__section`

Two-column card list used on hub/section pages to group related links.

```html
<section class="app-hub__section">
  <h2 class="govuk-heading-m">Section heading</h2>
  <ul class="app-hub__card-list">
    <li class="app-hub__card">
      <h3 class="govuk-heading-s app-hub__card-title">
        <a class="govuk-link" href="/page">Page title</a>
      </h3>
      <p class="govuk-body-s app-hub__card-description">Short description.</p>
    </li>
  </ul>
</section>
```

- 2-column grid → 1-column at ≤776px
- Cards separated by a bottom border

---

### `.app-stat-card`

Clickable stat highlight card. Used in a 4-column grid at the top of hub pages.

```html
<a class="app-stat-card" href="/stats">
  <span class="app-stat-card__number">42</span>
  <span class="app-stat-card__label">Tools reviewed</span>
  <span class="app-stat-card__description">Across all categories</span>
</a>
```

- Top border: `4px solid #008531`
- Background: `#f3f2f1`
- Number: 36px bold, Defra green colour
- Grid: 4 → 2 → 1 column (responsive)

---

### `.app-radar-card`

Filterable tool card for the AI tools radar. Left border colour indicates status.

```html
<article class="app-radar-card" data-status="endorse">
  <div class="app-radar-card__body">
    <span class="govuk-tag">Endorse</span>
    <h3 class="govuk-heading-s"><a href="/tools/tool-name">Tool name</a></h3>
    <p class="govuk-body-s">Brief description of the tool.</p>
  </div>
</article>
```

- 4px left border using the appropriate status colour
- 2-column grid → 1-column at ≤640px

---

## Layout utilities

### `.defra-width-container`

The standard max-width container. Use inside any full-bleed component to constrain content.

```html
<div class="defra-width-container">
  <!-- content at max 960px, centred, with 15px horizontal padding -->
</div>
```

- `max-width: 960px; margin: 0 auto; padding: 0 15px`

### `.app-subnav` / `.app-sub-navigation`

Left sidebar navigation for content pages with multiple sections.

```html
<nav class="app-sub-navigation" aria-label="Contents">
  <h2 class="app-subnav__header">Contents</h2>
  <ul class="app-subnav__section">
    <li class="app-subnav__section-item app-subnav__section-item--current">
      <a class="app-subnav__link app-subnav__link--current" href="/section/page">Current page</a>
    </li>
    <li class="app-subnav__section-item">
      <a class="app-subnav__link" href="/section/other">Other page</a>
    </li>
  </ul>
</nav>
```

- Active item: `4px solid #008531` left border, light grey background
- Sticky on desktop (min-width: 648px): `position: sticky; top: 20px`
