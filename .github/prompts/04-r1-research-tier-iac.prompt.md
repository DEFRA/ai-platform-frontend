---
mode: agent
description: 'R1 - build the research tier in Terraform: allow subscription-key, parameterise the team API module, and add the platform-owned research file.'
---

You are implementing **Phase R1** of
`ai-platform-frontend/docs/plans/in-progress/research-tier-infradev-plan.md`. Read that phase, and
the sections "The shape the design requires" and "Pipeline ordering", in full first.

This is the bulk of the work and the start of the second track. It does not depend on R5, R6 or R7.

## Repository

`ai-platform-infra`. Read `docs/modules.md` and `docs/gitops-contract.md` before writing anything.

## The shape - settled, do not redesign it

The research tier is **not** a parallel stack. It is a team called `research` that the platform
owns:

- The `research` API is generated from a platform-owned team file naming
  `credentialType: subscription-key`. There is no second API builder.
- Deployments are **account** children, visible to every project. A project is not a model
  boundary; the API's `allowedDeployments` is. The account/project split is provisioned throughput
  versus project-dedicated managed compute, and the platform does not use the latter.
- `aip-key-guard` and the global policy's `key` branch already exist in `modules/apim` and have
  never been reachable. This is what makes them reachable.

Three places refuse `subscription-key` today and all three must change together:
`schemas/team.schema.json`, the validation in `tenants/variables.tf`, and
`checks/tests/unit/schemas.test.js`, which pins the refusal.

`modules/apim-team-api` hardcodes `subscription_required = false` and `aipCredentialType` `oauth`
in the API, the policy XML and the metric dimension.

## The one thing people get wrong

**The research path does not translate the model name.** The team path runs `aip-request-model` to
map a catalogue slug to the derived `{slug}-{model}`; research skips it and forwards the deployment
name the caller sent, as the imported official spec defines it. The allow-list is still enforced,
on the raw name, before any backend call.

So research deployment names **are** written in the research file and carried in the catalogue's
`deploymentName` - a deliberate exception to "no resource names in a team file", because here the
name is the public contract. A drift between the two is a broken endpoint for every caller, which
is why item 7's check reconciles them in both directions.

## Also in this phase

Item 5 is platform layer, not tenant: the custom API Management role the Portal API needs to mint
subscriptions. Terraform owns it - the deploy identity has User Access Administrator - and it must
be **idempotent**: deterministic `role_definition_id` via `uuidv5`, the environment carried in the
role name, a deterministic assignment name, and an explicit wait for role-definition propagation.
`assignableScopes` cannot name a resource, so scope the definition to the resource group and the
assignment to the API Management resource.

Terraform creates **no** `azurerm_api_management_subscription` - those are the backend's, minted
per person. Say so in a comment.

## Constraints

- Terraform best practice: validated inputs, minimal outputs, no secret in a state output, checkov
  clean, exact-pinned provider versions, a fixture under `examples/`.
- Existing team-API tests must still assert `oauth`; add one asserting the `key` branch.
- Do not apply anything. R2 applies, with owner confirmation.
- Release through release-please and record the version in the plan.

## Done when

`terraform validate` and the module tests pass, `aip-checks` passes, and a plan against Infradev
shows additions only - in particular no replacement of the existing `cool-team` API.
