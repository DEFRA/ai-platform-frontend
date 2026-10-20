# Plans

What is built, and what is left, in two places only.

| Where                        | Holds                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| [implemented/](implemented/) | One file per category of built work. Read these to learn how a feature works today. |
| [remaining.md](remaining.md) | Every feature not yet built, in one file, by category.                              |

## Implemented

| File                                                                                 | Category                     | What it covers                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| [01-portal-journeys.md](implemented/01-portal-journeys.md)                           | Portal journeys              | Routes 0 to 3, sign-in, pages, flat Defra design                               |
| [02-research-tier.md](implemented/02-research-tier.md)                               | Research tier                | Personal API keys, real Azure, Key Vault, environments, Infradev IaC           |
| [03-team-tier.md](implemented/03-team-tier.md)                                       | Team tier                    | Teams and roles, dedicated models, GitOps provisioning, status, client secrets |
| [04-catalogue-and-gateway.md](implemented/04-catalogue-and-gateway.md)               | Catalogue and gateway        | Catalogue from `ai-platform-infra`, hosting and gateway shape                  |
| [05-platform-and-gitops-pipeline.md](implemented/05-platform-and-gitops-pipeline.md) | Platform infrastructure      | The five repositories, how a change flows, Infradev, CDP dev, operating notes  |
| [06-shared-services-and-security.md](implemented/06-shared-services-and-security.md) | Shared services and security | Idempotency, audit, locks, backfills, security baseline, federated auth        |

## Remaining

[remaining.md](remaining.md): identity and credentials (B18), limits and reporting (B17, B19), observability (B20 to B22),
gateway authorisation (B23), research tier follow-ups, quality and delivery, platform operations, and the discovery-docs
record.

## Keeping this current

- When a feature is built, move its entry from `remaining.md` into the matching `implemented/` file (add a new numbered
  file for a new category), date it, and update the tables above.
- When a feature is left out on purpose, say so in `remaining.md` ("deferred, not removed") rather than deleting it.
- Link, do not copy: design direction is in `ai-platform-discovery-docs`, acceptance criteria are its `build-stories.md`.

The source UI flow is [../ui-flow-three-routes.md](../ui-flow-three-routes.md); the one-page index for new joiners is
[implemented/implemented-features.md](implemented/implemented-features.md).
