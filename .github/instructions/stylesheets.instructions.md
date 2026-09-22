---
description: "Use when adding a new SCSS partial or GOV.UK Frontend based stylesheet. Covers where to add partials and how they're wired into application.scss."
applyTo: 'src/client/stylesheets/**/*.scss'
---

# Stylesheet Conventions

- New partials go under the matching folder: layout/structure in `core/`, reusable mixins/functions in `helpers/`, shared markup-adjacent styles in `partials/`, one-off page/component overrides in `components/`, and design tokens in `variables/`.
- Each folder has an `_index.scss` that forwards/imports its partials — add new partials there rather than importing them directly from `application.scss`.
- Prefix partial filenames with `_` (Sass partial convention) and keep one concern per file.
- This project extends `govuk-frontend` (see `_govuk-frontend.scss`) — prefer GOV.UK Frontend variables/mixins over hardcoded values.
- Defra brand tokens live in `variables/` per [.github/skills/javascript-design-language/SKILL.md](../skills/javascript-design-language/SKILL.md) (installed AICE skill) — two greens (`$defra-green` `#008531` for backgrounds/nav/hero/breadcrumb-bar, `$defra-green-aa` `#00a33b` for text/links on green), Helvetica/Arial font stacks; body links stay GOV.UK blue, never green. Class naming: `.govuk-*` unmodified, `.defra-*` for shared brand components (header, footer, nav, hero, tiles), `.app-*` for feature-specific ones.
- Lint with `npm run lint:scss` (Stylelint + `stylelint-config-gds`) before committing.
