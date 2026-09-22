# AICE Template System

All AICE UIs use a shared Nunjucks template hierarchy sourced from `DEFRA/service-manual-ui`. Every page extends one of the layout templates, which in turn extend the base `page.njk`. Partials are included by the layouts and the base template automatically.

---

## Template inheritance tree

```
govuk/template.njk  (GOV.UK Frontend base)
└── layouts/page.njk  ← base AICE layout: header, nav, breadcrumbs, footer, scripts
    ├── layouts/hub.njk          ← landing pages / section gateways
    ├── layouts/article.njk      ← standard article (two-thirds column)
    ├── layouts/two-thirds.njk   ← two-thirds column with required caption + description
    ├── layouts/section.njk      ← section page with sidebar section-navigation
    └── layouts/side-nav.njk     ← one-quarter sidebar + three-quarters content
```

---

## Choosing a layout

| Layout | Use when | Key feature |
|---|---|---|
| `hub.njk` | Landing page or major section gateway | Stat cards + grouped hub card sections |
| `article.njk` | Standard content / guide page | Two-thirds column; caption and description optional |
| `two-thirds.njk` | Content page where caption and description are always required | Like article but caption/description are mandatory fields |
| `section.njk` | Page within a multi-page section where users navigate between related pages | One-third sidebar with section-navigation partial |
| `side-nav.njk` | Page within a manual where a persistent broader section list is needed | One-quarter sidebar with navigation partial |

---

## Base layout — `layouts/page.njk`

Root template that all others extend. Handles:
- `<head>` — stylesheet imports
- Cookie banner (via `partials/cookie-banner.njk`)
- Header — Defra logo, service name, optional search
- Navigation bar — driven by `navItems` array or inline `customNav`
- `beforeContent` block — breadcrumbs (`govukBreadcrumbs` macro)
- `content` block — empty; sub-layouts fill this
- Footer (via `partials/footer.njk`)
- `bodyEnd` block — JS module import

### Variables

| Variable | Type | Required | Description |
|---|---|---|---|
| `serviceName` | string | Yes | Used in `<title>` and header service name link |
| `serviceUrl` | string | No | Service name link href; defaults to `/` |
| `pageTitle` | string | Yes | Browser tab prefix; rendered as `pageTitle \| serviceName` |
| `currentUrl` | string | No | Current path; drives `aria-current` on nav items |
| `navItems` | `{ text, href }[]` | No | Service navigation links |
| `showSearch` | boolean | No | Show the header search form |
| `breadcrumbs` | `{ text, href }[]` | No | Standard breadcrumb trail (sub-layouts override this block) |
| `gtmContainerId` | string | No | Google Tag Manager container ID; enables cookie banner |
| `hideCookieBanner` | boolean | No | Suppress the cookie banner entirely |
| `cookieConsentSet` | boolean | No | User has previously responded to the banner |
| `cookieAction` | `'accept' \| 'reject'` | No | Set after consent form submission to show confirmation message |

---

## Layout data contracts

### `hub.njk` — Landing / section gateway page

```
{% extends "layouts/hub.njk" %}
```

| Variable | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | h1 heading and `pageTitle` |
| `caption` | string | No | Small caption above h1 (`.govuk-caption-xl`) |
| `description` | string | No | Lead paragraph below h1 (`.govuk-body-l`) |
| `breadcrumbItems` | `{ text, href }[]` | No | Breadcrumb items; defaults to Digital Defra / Digital service manual / title |
| `statCards` | `{ number, label, description?, href }[]` | No | Clickable stat highlight cards |
| `hubSections` | `{ title, description?, items: { text, href, description?, tag?, tagColour? }[] }[]` | No | Grouped two-column card lists |
| `content` | string | No | Markdown rendered after hub sections |
| `supportBox` | `{ title?, description?, items?: string[] }` | No | Contextual help box at the bottom |

### `article.njk` — Standard article page

```
{% extends "layouts/article.njk" %}
```

| Variable | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | h1 heading and `pageTitle` |
| `caption` | string | No | Small caption above h1 |
| `description` | string | No | Lead paragraph below h1 |
| `breadcrumbItems` | `{ text, href }[]` | No | Breadcrumb items; defaults to Digital Defra / title |
| `content` | string | Yes | Markdown body |
| `supportBox` | `{ title?, description?, items?: string[] }` | No | Support box |

### `two-thirds.njk` — Two-thirds column with required caption and description

```
{% extends "layouts/two-thirds.njk" %}
```

| Variable | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | h1 heading and `pageTitle` |
| `caption` | string | Yes | Caption above h1 (always displayed) |
| `description` | string | Yes | Lead paragraph (always displayed) |
| `breadcrumbs` | `{ text, href }[]` | No | Breadcrumb items; defaults to Digital Defra / Digital service manual / title |
| `content` | string | Yes | Markdown body |
| `supportBox` | `{ title?, description?, items?: string[] }` | No | Support box |

### `section.njk` — Section page with sidebar navigation

```
{% extends "layouts/section.njk" %}
```

| Variable | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | h1 heading and `pageTitle` |
| `caption` | string | No | Caption above h1 |
| `description` | string | No | Lead paragraph below h1 |
| `sectionTitle` | string | No | Used in breadcrumb default instead of `title` |
| `breadcrumbItems` | `{ text, href }[]` | No | Breadcrumb items; defaults to Digital Defra / Digital service manual / sectionTitle or title |
| `sectionNav` | `{ title, items: { text, href }[] }[]` | Yes | Sidebar navigation groups for `section-navigation.njk` |
| `currentUrl` | string | No | Active item matching in sidebar nav |
| `content` | string | Yes | Markdown body |
| `supportBox` | `{ title?, description?, items?: string[] }` | No | Support box |

### `side-nav.njk` — One-quarter sidebar + three-quarters content

```
{% extends "layouts/side-nav.njk" %}
```

| Variable | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | h1 heading and `pageTitle` |
| `content` | string | Yes | Markdown body |
| `currentUrl` | string | No | Active item matching in `navigation.njk` sidebar |
| `supportBox` | `{ title?, description?, items?: string[] }` | No | Support box |

---

## Partials catalogue

Partials live in `assets/partials/` and are included by the layouts. Customise them for your project.

| Partial | Included by | Purpose | Key variables |
|---|---|---|---|
| `cookie-banner.njk` | `page.njk` (bodyStart) | GOV.UK-compliant analytics cookie consent banner | `gtmContainerId`, `cookieConsentSet`, `cookieAction`, `hideCookieBanner`, `currentUrl` |
| `footer.njk` | `page.njk` | Defra footer with green top border, meta links, licence | None (customise links directly) |
| `header-search.njk` | `page.njk` (inside header) | Inline search form; hidden on mobile | None |
| `main-navigation.njk` | `page.njk` (when `showMainNavigation` is set) | Top-level global nav bar | `currentUrl` |
| `service-navigation.njk` | `page.njk` (default nav) | Service-level nav bar; hamburger on mobile | `currentUrl` |
| `navigation.njk` | `side-nav.njk` | Manual sections sidebar list (govuk-list) | `currentUrl` |
| `section-navigation.njk` | `section.njk` | In-section sidebar grouped nav | `sectionNav`, `currentUrl` |
| `support-box.njk` | All content layouts | Contextual help box; only renders when `supportBox` is set | `supportBox.title`, `supportBox.description`, `supportBox.items` |

---

## Navigation modes

`page.njk` supports three navigation modes in priority order:

1. **`showMainNavigation: true`** — includes `partials/main-navigation.njk` (the top-level global nav with all major sections)
2. **`customNav` array** — renders an inline `defra-service-navigation` from the provided `{ text, href }[]` items
3. **Default** — includes `partials/service-navigation.njk` (service-specific nav); set `hideServiceNavigation: true` to suppress entirely

---

## Page title convention

The `<title>` is rendered as:

```
pageTitle | serviceName
```

If `pageTitle` equals `serviceName` (i.e. the home page), the suffix is omitted.

---

## Responsive breakpoints

| Breakpoint | Effect |
|---|---|
| ≤ 768px | Header search hidden; nav collapses to hamburger |
| ≤ 776px | Hub card list: 2 → 1 column; tile grid: 3 → 1 column; stat cards: 4 → 2 |
| ≤ 648px | Section sidebar: sticky → normal flow (stacks above content) |
| ≤ 480px | Service name: 18px → 16px; logo: 45px → 40px; stat cards: 2 → 1 |
