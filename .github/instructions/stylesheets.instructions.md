---
description: "Use when adding a new SCSS partial or GOV.UK Frontend based stylesheet. Covers where to add partials and how they're wired into application.scss."
applyTo: 'src/client/stylesheets/**/*.scss'
---

# Stylesheet Conventions

- New partials go under the matching folder: layout/structure in `core/`, reusable mixins/functions in `helpers/`, shared markup-adjacent styles in `partials/`, one-off page/component overrides in `components/`, and design tokens in `variables/`.
- Each folder has an `_index.scss` that forwards/imports its partials — add new partials there rather than importing them directly from `application.scss`.
- Prefix partial filenames with `_` (Sass partial convention) and keep one concern per file.
- This project extends `govuk-frontend` (see `_govuk-frontend.scss`) — prefer GOV.UK Frontend variables/mixins over hardcoded values.
- Defra brand tokens (e.g. Defra Green `#00a33b`, Helvetica/Arial font stacks) are overrides on top of GOV.UK Frontend defaults, not replacements — define them once in `variables/` per the [Defra branding guidance](https://digital.defra.gov.uk/design/branding), and use them sparingly (e.g. header/nav borders) per the main instructions' "Design and content standards".
- Lint with `npm run lint:scss` (Stylelint + `stylelint-config-gds`) before committing.
