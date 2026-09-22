---
name: javascript-design-language
description: AICE (AI Capability and Enablement) design language reference for Defra digital services built on GOV.UK Frontend. Use when building or prototyping a frontend that should align with the AICE design language such as choosing brand colours, structuring page layouts, applying component classes, or copying SCSS tokens into a new project.
compatibility: GOV.UK Frontend (GDS) based projects. Assets use SCSS and HTML.
metadata:
  author: defra-aice
  version: "1.0"
  github-repo: DEFRA/aice-team
  github-ref: main
  github-tree-sha: <sha at install time>
---

# AICE Design Language

The AICE design language is a Defra-branded layer on top of [GOV.UK Frontend](https://frontend.design-system.service.gov.uk/). It uses the full GDS component library as a base and adds Defra-specific colours, layout patterns, and components on top.

## Core principle

Never override `.govuk-*` classes directly. Add Defra-specific classes alongside them:

```html
<!-- Good: Defra class extends GDS without touching it -->
<header class="defra-header">...</header>

<!-- Good: GDS component used as-is -->
<button class="govuk-button">Save</button>
```

## Naming conventions

- `.defra-*` — shared brand components (header, footer, navigation, hero, tiles)
- `.app-*` — feature-specific components (hub, radar, triage, kanban)
- `.govuk-*` — GDS base components; use as-is, never override directly

## The two visual modes

Every page is one of two modes:

**Entry/hub pages** — top-level section gateways and the home page:
- Open with a full-viewport-width `.defra-hero` (Defra green background, white text)
- Follow the hero with tile grids or stat cards
- Used for: home page, major section gateways

**Content pages** — all other pages:
- No hero
- Standard `.defra-breadcrumb-bar` (green strip) below navigation
- Two-thirds column for body text
- Optional left sidebar for section navigation
- Optional `.defra-support-box` at the bottom

Both modes always include: `.defra-header`, `.defra-primary-nav`, and `.defra-footer`.

## Quick colour reference

| Token | Hex | Use |
|-------|-----|-----|
| Defra green | `#008531` | Nav backgrounds, hero, breadcrumb bar, footer border, active indicators |
| Defra green AA | `#00a33b` | Service name link; white text on green (large text) |
| GOV.UK blue | `#1d70b8` | **All body links** — never replace with green |
| GOV.UK yellow | `#ffdd00` | Focus indicators only |
| GOV.UK light grey | `#f3f2f1` | Page/card backgrounds |

See [references/colours.md](references/colours.md) for the complete palette.

## Components

See [references/components.md](references/components.md) for the full component catalogue with CSS class names, HTML structure, and responsive behaviour.

## Page layouts

See [references/layouts.md](references/layouts.md) for a description of each layout type and when to use it.

## Template system

See [references/templates.md](references/templates.md) for the complete Nunjucks template hierarchy, data contract for each layout, and partials catalogue.

## Starting a new project

1. Copy [assets/_variables.scss](assets/_variables.scss) into your project's SCSS.
2. Import it alongside `govuk-frontend`.
3. Use [assets/layouts/page.njk](assets/layouts/page.njk) as the base layout — all pages extend it.
4. Choose a sub-layout for each page type:
   - `layouts/hub.njk` — landing pages and section gateways
   - `layouts/article.njk` — standard content/guide pages
   - `layouts/two-thirds.njk` — content pages with a required caption and description
   - `layouts/section.njk` — pages within a multi-page section (sidebar section-nav)
   - `layouts/side-nav.njk` — pages within a manual with a persistent broader section list
5. Copy the partials from [assets/partials/](assets/partials/) into your project's template path and customise links for your service.
6. See [references/templates.md](references/templates.md) for the full data contract (variable list) of each layout.
7. Reference [assets/example-page.njk](assets/example-page.njk) for an annotated entry/hub page example, or [assets/example-page.html](assets/example-page.html) for a plain HTML reference.
