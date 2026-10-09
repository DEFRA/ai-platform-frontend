> Source proposal only. The agreed, authoritative version of this work is
> [centralised-gateway-plan.md](centralised-gateway-plan.md) next to this file — read that first.
> Kept here for the reasoning behind the change.

Important NOTE:
read these notes in this file but aftar that mainly see this commit already merged in ai-platform-discovery-docs repo which is in the workspace for the real new change needed for the centralised Gateway : https://github.com/DEFRA/ai-platform-discovery-docs/commit/e85485eab0bf9c3449c7a01bb5b65ab694320ec2

I've reviewed the draft openai.json against the current backend (sync, credential issuer and vault registries, config, seed data). Below is a proposed shape for the provider files and the backend changes that go with it.

1. The principle
   Every model is exposed through Azure APIM, whatever cloud hosts it. APIM is the only gateway today, but the schema keeps the gateway as an explicit field so it can change later.
   Hosting varies; the gateway doesn't. Models are hosted on Microsoft Foundry now. Amazon Bedrock and direct provider APIs (OpenAI, Anthropic, Meta) may follow post-MVP.
   Bedrock and direct APIs are hosting platforms behind APIM. They are not new gateways or credential adapters. Credentials are always issued by APIM and stored in Key Vault.

2. Problems with the current draft
   The two offerings have the same id (azure-openai). catalogue-service.js indexes offerings in a Map, so the second (cloud: "aws") replaces the first. Every model says cloud: "azure", so the check at L117 would skip all of them.

The second offering contradicts itself. It's named "OpenAI on Azure" but says cloud: "aws".

The backend assumes Bedrock is its own credential adapter. This shows up in four places:

config.js
the vault registry comment ("a Bedrock credential's secret goes to AWS"), credential-vault-registry.js
catalogue-service.test.js
registry.test.js
That would mean credentials bypass APIM. Adapter ids are gateway ids, and today there is only one: azure-apim.
cloud can't describe a direct provider, because a direct provider has no cloud. The draft also doesn't say who runs a direct API. For Meta that could be Meta itself or a third-party host.

terms sits on the provider, but terms differ by hosting route. OpenAI models sold by Microsoft and the OpenAI API are covered by different terms.

3. What the provider file holds
   At runtime, the provider file has one job in the backend: turning a model's provider/offering into its cloud and gateway. The providers collection is written during sync, but no route reads it. So the file holds only what that job needs, plus labels.

Field Where Why
id, displayName Provider Model provider (OpenAI, Anthropic, Meta). id must match the file name.
id, displayName Offering One offering per hosting route. Models reference it as offering.
hosting.platform Offering foundry, bedrock or direct. Tells Terraform and APIM which integration to build.
hosting.cloud Offering Required for foundry (azure) and bedrock (aws). Not allowed for direct.
hosting.provider Offering Required for direct (who runs the API). Not allowed for cloud platforms, where the cloud already says who hosts it.
gateway Offering Required. Only azure-apim today. Sync stores it as the model's adapter.
terms Offering Optional URL. Leave it out rather than setting it to null.
These are deliberately left out of the provider file:

Field Reason
Status and status reason An offering is in the release or it isn't. Model files already carry eligible, eligibilityReason, lifecycle and environments[].
Regions and data zones They describe a deployment, so they're already on each model (region, regions, dataZone).
Exposed APIs This already exists as the model's apiProfile. The frontend uses it for code snippets.
Upstream API format This is the format APIM uses to call the host. It's an APIM and Terraform detail that follows from the platform.
Who sells it The terms link covers whose terms apply. 4. File layout
Keep one file per model provider: catalogue/providers/openai.json, anthropic.json, meta.json.

GitHub source: reads each file under catalogue/providers/ as one provider object, and skips catalogue/schema/ (github-catalogue-source.js).
Don't split offerings into separate files or subfolders. The source would read each file as a provider.
Local seed: providers.seed.json stays an array of the same objects.

Exampkes:

{
"$schema": "../schema/provider.schema.json",
"id": "openai",
"displayName": "OpenAI",
"offerings": [
{
"id": "azure-openai",
"displayName": "OpenAI on Microsoft Foundry",
"hosting": { "platform": "foundry", "cloud": "azure" },
"gateway": "azure-apim"
}
]
}

Schema:

{
"$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "provider.schema.json",
"type": "object",
"additionalProperties": false,
"required": ["id", "displayName", "offerings"],
"properties": {
"$schema": { "type": "string" },
    "id": { "$ref": "#/$defs/id" },
    "displayName": { "type": "string", "minLength": 1 },
    "offerings": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/offering" } }
  },
  "$defs": {
"id": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
    "offering": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "displayName", "hosting", "gateway"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "displayName": { "type": "string", "minLength": 1 },
        "hosting": { "$ref": "#/$defs/hosting" },
        "gateway": { "enum": ["azure-apim"] },
        "terms": { "type": "string", "pattern": "^https://" }
      }
    },
    "hosting": {
      "type": "object",
      "additionalProperties": false,
      "required": ["platform"],
      "properties": {
        "platform": { "enum": ["foundry", "bedrock", "direct"] },
        "cloud": { "enum": ["azure", "aws"] },
        "provider": { "$ref": "#/$defs/id" }
},
"oneOf": [
{ "properties": { "platform": { "const": "foundry" }, "cloud": { "const": "azure" } }, "required": ["cloud"], "not": { "required": ["provider"] } },
{ "properties": { "platform": { "const": "bedrock" }, "cloud": { "const": "aws" } }, "required": ["cloud"], "not": { "required": ["provider"] } },
{ "properties": { "platform": { "const": "direct" } }, "required": ["provider"], "not": { "required": ["cloud"] } }
]
}
}
}

8. Backend changes
   Now:

catalogue-service.js:

Read hosting.cloud into cloud and gateway into adapter.
Fail the sync on a duplicate offering id, instead of letting the last one win.
Stored model and credential documents keep the same fields, so no backfill is needed.

Model files: stop repeating cloud and adapter, and let the offering supply them. The mismatch check at L117 then only matters for older releases.

Bedrock assumption: remove it from the config.js comment, the vault registry comment and the tests that use adapter: "aws-bedrock".

Seed and fixtures: update providers.seed.json and the test fixtures to the new shape.

Before the first direct offering:

Cloud fallback: catalogue-service.js currently turns a missing cloud into azure. When the offering is known, it should take the offering's cloud, and store null if the offering has none.
Model page caption: the frontend says "hosted by Defra in {region}" (models/controller.js), which is wrong for a direct offering. Sync will also need to store platform and hosting.provider on the model.
Network path: traffic from APIM to a direct vendor leaves Defra's cloud accounts. The design pack requires private-path and data evidence before any offering goes live (cloud-designs.md).

Big Example:

{
"$schema": "../schema/provider.schema.json",
"id": "openai",
"displayName": "OpenAI",
"offerings": [
{
"id": "azure-openai",
"displayName": "OpenAI on Microsoft Foundry",
"hosting": { "platform": "foundry", "cloud": "azure" },
"gateway": "azure-apim",
"terms": "https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy"
},
{
"id": "bedrock",
"displayName": "OpenAI open-weight models on Amazon Bedrock",
"hosting": { "platform": "bedrock", "cloud": "aws" },
"gateway": "azure-apim"
},
{
"id": "direct",
"displayName": "OpenAI API",
"hosting": { "platform": "direct", "provider": "openai" },
"gateway": "azure-apim"
}
]
}

{
"$schema": "../schema/provider.schema.json",
"id": "anthropic",
"displayName": "Anthropic",
"offerings": [
{
"id": "bedrock",
"displayName": "Claude on Amazon Bedrock",
"hosting": { "platform": "bedrock", "cloud": "aws" },
"gateway": "azure-apim"
},
{
"id": "direct",
"displayName": "Anthropic API",
"hosting": { "platform": "direct", "provider": "anthropic" },
"gateway": "azure-apim"
}
]
}

so it's more specific on hosting, platform, and whether direct or not. this provides the right level of flexibility, i think, whilst being clear/discinct on what it Cloud, What is director, and what Platform its served from, but importantly, we don't need to tell the users all of this, but it provides us with what we need for orchestraion, but it also provides enough for visibility/monitoring and SRE - as users during audit would need to know What Model, What Cloud, What Provider, what API and what Endpoint in Which region.

Key thing is - it's one Credential journey to the Gateway - the gateway manages behind scenes credentials, and we look at 3 legged oauth later
