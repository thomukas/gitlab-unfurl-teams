# Vendored Teams manifest schema

`MicrosoftTeams.schema.json` is Microsoft's v1.17 manifest schema, retrieved on
2026-09-27 from:

https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json

It is vendored for deterministic offline validation with AJV's draft-04 support.
Line endings are normalized to LF. Schema validation cannot verify bot registration,
publisher URL contents, tenant policy or live OAuth behavior. The builder adds
GUID, version, safe-origin and publisher-placeholder checks. Update the schema and
manifestVersion together after reviewing Microsoft's compatibility guidance.
