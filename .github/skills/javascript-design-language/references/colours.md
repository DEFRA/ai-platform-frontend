# AICE Colour Reference

## Brand greens

| Token | Hex | Use |
|-------|-----|-----|
| `$defra-green` | `#008531` | Navigation bar background, breadcrumb bar background, hero section background, footer top border (10px), active state left-border indicators, version banner label, stat card top border, search button |
| `$defra-green-aa` | `#00a33b` | Service name link colour — AA-compliant for white text on green backgrounds (large text only) |
| `$defra-light-green` | `#eefdf4` | Subtle background highlights |

## GOV.UK palette (preserved as-is)

| Token | Hex | Use |
|-------|-----|-----|
| `$govuk-blue` | `#1d70b8` | **All body links** — never substitute Defra green here |
| `$govuk-yellow` | `#ffdd00` | Focus indicators only — keyboard navigation highlight |
| `$govuk-light-grey` | `#f3f2f1` | Page backgrounds, card backgrounds, support box background |
| `$govuk-mid-grey` | `#b1b4b6` | Borders (tiles, cards, separators) |
| `$govuk-black` | `#0b0c0c` | Body text, focus text colour |
| `$govuk-white` | `#ffffff` | Header background, tile background, hero text |

## Status colours (AI toolkit radar)

These match the GOV.UK Tag colour family and are used for the AI tools radar status indicators only.

| Status | Hex | Context |
|--------|-----|---------|
| Endorse | `#00703c` | Green — tools endorsed for use |
| Pilot | `#1d70b8` | Blue — tools in pilot |
| Assess | `#b58840` | Amber/gold — tools under assessment |
| Avoid | `#d4351c` | Red — tools to avoid |

## Usage rules

- **Defra green is never used for body links.** Links always use GOV.UK blue (`#1d70b8`).
- **Yellow is focus-only.** Never use `#ffdd00` for decorative colour.
- **Green text on white** requires `$defra-green-aa` (`#00a33b`) not `$defra-green` (`#008531`) — the primary green does not meet WCAG AA contrast for normal-weight text on white.
- The service name link uses `$defra-green-aa` explicitly to meet contrast requirements.

## Focus style

The standard focus style used across all interactive elements:

```css
outline: 3px solid transparent;
color: #0b0c0c;
background-color: #ffdd00;
box-shadow: 0 -2px #ffdd00, 0 4px #0b0c0c;
text-decoration: none;
```

This replaces the default browser focus ring with a yellow background + black underline bar, consistent with GOV.UK Frontend's focus indicator pattern.
