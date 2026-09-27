# Administrator runbook

## Ownership and release gate

| Owner | Responsibilities and access |
|---|---|
| Teams administrator | Custom app upload; pilot availability and installs; updates; removal |
| Entra application owner | Single-tenant app registration; bot secret creation/rotation; tenant ID |
| Cloud platform team | App Service/Bot/monitoring deployment; Key Vault reference; network paths; incident response |
| GitLab application owner | OAuth application/connection, scope approval, grants and revocation |
| Data/security owner | Metadata-sharing policy, approved project prefixes, audiences, regions and retention |

A Teams administrator alone need not hold subscription ownership or GitLab
administrator rights. Coordinate these owners. Use the existing corporate vault
and network approval process; do not create alternative infrastructure to bypass
restricted permissions. The platform deployer needs resource-group deployment
rights, subnet join permission, and permission to grant the secret-reader role
on a dedicated vault. App registration rights are separate from Azure RBAC.

This release has offline protocol and package tests, not live tenant certification.
Complete the acceptance tests below in a dedicated pilot before production.

## Choose what may be shared

Start with `PREVIEW_MODE=link`. There are no entity lookups or GitLab consent
prompts. Readers follow the original reference into GitLab to see details.

Enable `PREVIEW_MODE=metadata` only after the data owner approves sharing fetched
metadata with every reader of a Teams message. Set a nonempty
`PROJECT_ALLOWLIST`, for example `company/engineering,company/documentation`.
Matching includes descendants on path-segment boundaries. No wildcards or full
URLs are accepted. Review the audience of channels/chats, including guests and
shared channels; allowing the app for a pilot group does not restrict who can
read a card the pilot sends. Confidential entities are withheld, but other private
project titles may also be sensitive. Posted cards persist after grant revocation.

## Network and residency prerequisites

Use the same approved OAuth origin in the runtime, GitLab callback URI and Teams
manifest. Supported public-cloud origins are `https://token.botframework.com`,
`https://europe.token.botframework.com`, `https://unitedstates.token.botframework.com`,
and `https://india.token.botframework.com`. Each callback is that origin plus
`/.auth/web/redirect`. Match the Azure Bot resource's regional configuration to
the selected service using the template's `botLocation` parameter (default
`global`). Validate the region/OAuth pairing with your Azure owner before
using a regional endpoint. Sovereign clouds are not supported by this runtime.
[Microsoft regional OAuth documentation](https://learn.microsoft.com/en-us/azure/bot-service/ref-oauth-redirect-urls)

| Path | Purpose |
|---|---|
| Azure Bot Service → public App Service HTTPS `/api/messages` | Teams invokes; JWT verification is mandatory |
| Approved corporate CIDR → App Service/SCM HTTPS | Deployment and support probes |
| Backend → `login.botframework.com:443` | Microsoft signing-key retrieval/rotation |
| Backend → `login.microsoftonline.com:443` | Single-tenant bot credential acquisition in metadata mode |
| Backend → selected token-service host:443 | User-token lookup, sign-in and disconnect |
| Backend → configured GitLab origin | Metadata API reads only |
| Backend/platform → dedicated Key Vault and approved Azure Monitor endpoints | Secret resolution and operations logs |
| User browser and Microsoft token service → GitLab OAuth endpoints | Authorization, token issuance and refresh |

The Bicep template requires an existing delegated App Service integration subnet
and routes outbound traffic through it. **It does not create a firewall or prove
that the subnet's route/NSG rules restrict egress.** The network owner must enforce
and test the table above, including DNS and private Key Vault routes. Inbound
access is restricted to the AzureBotService service tag and the supplied support
CIDR; SCM only permits the supplied corporate deployment CIDR. Run deployment
commands from that network. Do not use `0.0.0.0/0` for the corporate CIDR.

For private self-managed GitLab, a private backend-to-GitLab route alone is not
enough: the Microsoft token service also needs a supported route to GitLab's
OAuth token and refresh endpoints. If that cannot be provided, keep link mode;
metadata mode needs a separately reviewed authentication design. Do not expose
the entire GitLab instance just to get OAuth working. Trust chains, proxies and
conditional-access policies must be exercised in the pilot.

## Register identities and secrets

1. The Entra owner creates an app registration with **Accounts in this
   organizational directory only**. Record application/client ID (`BOT_ID`) and
   directory ID (`BOT_TENANT_ID`). Do not add Graph application permissions.
2. For metadata mode, create a client secret and store it as `bot-password` in an
   existing dedicated, RBAC-enabled Key Vault in the deployment resource group.
   Use the portal or your approved secure secret-injection process. Do not put
   the value in Bicep parameters, shell history, CI logs, or the Teams package.
3. The template grants its secret-reader managed identity Key Vault Secrets User
   on that dedicated vault in metadata mode. It grants no bot privileges to the
   managed identity. Ensure private vault access and RBAC propagation work.
4. For metadata mode, the GitLab owner creates an instance- or group-owned OAuth
   application where possible. Request `read_api` only. It is a broad read grant
   over resources accessible to that user, not a project-limited grant. Leave
   **Trusted** off unless the security owner approves skipping per-user consent.
   Set the redirect URI to the chosen Microsoft OAuth callback above.
5. After provisioning the Azure Bot below, add an OAuth connection in its portal
   configuration, named `gitlab` (or the configured connection name). Select
   **Generic Oauth 2**, supply the GitLab application ID and secret, set the
   authorization endpoint to `${GITLAB_ORIGIN}/oauth/authorize`, token and refresh
   endpoints to `${GITLAB_ORIGIN}/oauth/token`, and scope to `read_api`. Leave token
   exchange URL empty. Run **Test Connection** and then test the actual Teams flow;
   a portal test alone does not establish user sign-in works.

Link mode skips steps 2, 4 and 5. The template enables the Teams channel and
configures the messaging endpoint automatically.

## Build and provision

Use a reviewed commit and a supported Node version (22 or 24). Build as described
in the README. The generated `build.json` records the source commit. Check that
`git status --short` is empty for release builds. Prefer the CI artifact from the
exact reviewed commit; verify `SHA256SUMS` after downloading. The inventory lists
bundled runtime libraries, not build tools or the hosting platform.

Copy `deploy/azure/parameters.example.json` to a local parameters file and replace
every `REPLACE` value using the Bicep parameter names. It contains no
secret values: `name`, `botClientId`, `gitlabOrigin`, `vaultName`,
`integrationSubnetResourceId`, `deploymentSourceCidr`, `operationsActionGroupId`,
and, if approved, `previewMode`, `projectAllowlist`, `oauthOrigin`. Use a dedicated
resource group and an operations action group already maintained by your team.
The default App Service plan is S1 with two instances (`instanceCount`); compute, monitoring, and existing network
services incur their usual charges. Set a budget using your organization's policy.

```sh
az bicep build --file deploy/azure/main.bicep --outfile /tmp/main.json
az deployment group what-if --resource-group "$RESOURCE_GROUP" \
  --template-file deploy/azure/main.bicep --parameters @deployment.parameters.json
az deployment group create --resource-group "$RESOURCE_GROUP" \
  --template-file deploy/azure/main.bicep --parameters @deployment.parameters.json
az webapp deploy --resource-group "$RESOURCE_GROUP" --name "$APP_NAME" \
  --src-path artifacts/gitlab-unfurl-backend.zip --type zip
```

Review the what-if before execution. The template creates the App Service plan,
app, bot and Teams channel, secret-reader identity/role, 30-day log workspace,
HTTP 5xx and health alerts. It disables FTP/basic publishing and requires TLS.
It does not create the Entra app, vault, subnet/firewall, operations action group,
GitLab OAuth application, or Bot OAuth connection. Their ownership and secrets
remain with the designated teams. The only provisioned backend is production;
use a separate pilot resource group/app/bot to test updates.

Validate that the Key Vault reference shows **Resolved**, the app starts, and
`GET /healthz` and `GET /readyz` return 200 from the support network. `/readyz`
checks signing-key availability and, in metadata mode, bot credential acquisition.
It does not check the GitLab OAuth connection or end-user grants. Access from
outside the approved ingress sources should be denied.

## Package, install and pilot

1. Set `BOT_ID`, `GITLAB_ORIGIN`, `OAUTH_ORIGIN`, `APP_VERSION`, `DEVELOPER_NAME`,
   `WEBSITE_URL`, `PRIVACY_URL`, and `TERMS_URL` in the build environment. Use real
   internal support/privacy/terms pages. Scripts do not auto-load `.env` files.
2. Run `pnpm package:teams`. Only `manifest.json`, `color.png` and `outline.png`
   belong at the archive root. The builder validates the Microsoft schema and
   fails if packaging is unsuccessful.
3. In **Teams admin center → Teams apps → Manage apps**, upload the ZIP. Configure
   availability for a dedicated pilot group; do not grant organization-wide
   availability during the pilot.
4. Configure installation for the same group. Where app-centric management is
   enabled, use the app's **Users and groups → Installs** controls; use the tenant's
   supported setup-policy workflow otherwise. Availability and installation are
   separate concepts. End-user custom-app sideloading is not required for an
   admin-uploaded organizational app.
5. Allow for policy propagation. Microsoft documents up to 24 hours, and rare
   longer delays. Confirm the app is installed for the actual sender account.
   In metadata mode, each sender connects their GitLab account on first use.

[Custom app upload](https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings),
[app availability](https://learn.microsoft.com/en-us/microsoftteams/app-centric-management),
[preinstallation](https://learn.microsoft.com/en-us/microsoftteams/install-teams-apps).

## Acceptance tests

Record tenant, source commit, package version, date, tester and result for each.
Do not treat the offline suite as a substitute for these results.

- In link mode, private/nonexistent references have the same generic appearance;
  no title, people, labels or existence information is disclosed.
- In metadata mode, first sign-in opens and closes correctly; the resumed paste
  displays a card. Test the selected region, browser policies, and desktop/web.
  Authenticated unfurl creation on mobile is not a supported commitment.
- With two users having different GitLab permissions, a sender without access
  gets no metadata. A sender with access can share an approved item's metadata;
  the other recipient can read the sent card. Have the data owner acknowledge
  that behavior. Test actual guest/shared-channel contexts used by the company.
- Unapproved namespaces, confidential issues/epics, wrong host URLs, malformed
  invokes and invalid/expired JWTs are rejected without credential disclosure.
- Test access-token expiry, refresh-token rotation, revoked grants, expired bot
  secrets, GitLab downtime and Microsoft dependency failure. GitLab 401 should
  offer reconnect, and infrastructure failure should be diagnosable by request ID.
- Test **Disconnect GitLab**, GitLab grant revocation, removal of a pilot user,
  and emergency disabling. Existing cards must be treated as retained content.
- Demonstrate that secrets resolve, logs contain no tokens/headers/bodies, alerts
  reach the existing operations group, readiness failures are visible, and the
  network denies unapproved ingress and egress.
- Install a higher manifest version and deploy a new backend artifact; demonstrate
  rollback to the previous reviewed artifact. Keep pilot evidence with the release.

## Operation and troubleshooting

| Symptom | Check |
|---|---|
| Host liveness fails | Startup logs, valid bot/tenant IDs, runtime version and startup command |
| Readiness fails | JWKS egress/DNS; bot secret validity; Key Vault reference/permission/network |
| 401 on invoke | JWT audience, bot registration, issuer/lifetime, signing-key retrieval |
| 403 on invoke | Ingress restriction versus application denial; tenant, recipient and signed service URL |
| 413 / 429 / 503 | 64 KiB request cap; per-user/process rate; dependency failure or concurrency limit |
| No preview | Sender installation/availability, registered GitLab domain, URL shape, allowlist and confidential flag |
| Sign-in does not complete | Matching OAuth origin/callback/manifest domain, connection name, GitLab OAuth reachability and client secret |
| GitLab 401 | Reconnect action; user revocation or token refresh failure |

Structured request logs include a random correlation ID, outcome and latency;
handler logs include sanitized outcomes. Preserve the `x-request-id` for support.
Never enable proxy header/body capture, verbose HTTP client traces or token-bearing
URL logging. Namespace hashes are pseudonymous, not anonymized. Restrict workspace
access and review the default 30-day retention against corporate policy.

The template alerts on more than five HTTP 5xx responses over five minutes and
failed health checks. Add corporate thresholds for sustained 401/403/429, latency,
secret expiry and failed sign-ins. Local guards allow 40 concurrent invokes,
30 per user per minute and 600 per process per minute. Enforce shared limits at
the organization's gateway if the app has multiple instances.

## Credential rotation and revocation

- **Bot secret:** create a replacement while the old secret remains valid. Update
  the existing Key Vault secret's latest version. Refresh App Service Key Vault
  references or restart after configuration refresh; versionless references may
  otherwise take time to update. Verify reference resolution, readiness and a
  fresh token acquisition/paste before removing the old Entra secret. Keep the
  previous valid secret available during the rollback window.
- **GitLab OAuth client secret:** coordinate rotation with the GitLab owner,
  update the Azure Bot OAuth connection, and test sign-in and refresh. Reauthorization
  may be required. Do not assume the old secret overlaps or stays valid.
- **One user:** use the extension's Disconnect action to remove that user's stored
  token-service connection, then revoke the application under GitLab **Edit
  profile → Access → Applications** to revoke the grant. For an unavailable user,
  the GitLab administrator must use the organization's supported account/grant
  revocation procedure. Removing Teams access alone does not revoke GitLab grants.
- **Emergency stop:** stop the backend in Azure for immediate containment; block
  app availability in Teams as well. For credential compromise, revoke the bot
  secret and affected GitLab grants. Deleting the shared Bot OAuth connection is
  an integration-wide action, not a way to revoke one user.

[Key Vault reference refresh behavior](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references).

## Upgrade, rollback and uninstall

Deploy backend updates to the pilot first, verify the artifact checksum and commit,
then deploy the same reviewed ZIP to production. Redeploy the previous backend
ZIP for rollback; keep previous configuration and secret versions where valid.
There is no database migration. An incompatible secret rotation may require a new
valid secret rather than a code rollback. During rollback keep the safer sharing
policy; do not restore broad metadata access unintentionally.

For a Teams package update, preserve app/bot ID, increment `APP_VERSION`, and
upload through the app details page. To restore older manifest behavior, package
that behavior with a new, higher version. Rebuild if the GitLab or OAuth host
changes. Recheck group availability and installation after updates.

For uninstall, stop the backend and remove/block the Teams app, revoke GitLab
grants and client secrets as appropriate, then remove the OAuth connection and
retire the bot/app registration. Inventory and delete owned Azure resources;
never delete shared vaults, subnets or action groups. Handle logs and existing Teams
cards under retention policy. Removing infrastructure does not retract messages.
