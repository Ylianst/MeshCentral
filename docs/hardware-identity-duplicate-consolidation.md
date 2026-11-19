# Hardware identity duplicate consolidation

For an existing duplicate after hardware identity rebind, preserve the original node and `hwi<newNodeId>` alias. Verify matching SMBIOS UUID, domain, original and duplicate identities, and alias target before any mutation. Stop MeshCentral and take a verified full `meshcentral-data` backup before opening the three `@seald-io/nedb` databases for writes.

* Preserve the original node, its name, group, tags, notes and original system information.
* Reassociate duplicate `meshcentral-power.db` records by changing only the `nodeid` field to the original NodeID.
* Keep `meshcentral-events.db` audit records unchanged. They describe creation, changes, removal, and agent activity for the temporary duplicate identity; rewriting them would misrepresent the audit trail. These records remain stored under their historical identity and are **not** presented as merged events under the original NodeID.
* Remove the verified duplicate node and transient `si`, `if`, `nt`, `lc`, and `al` records only after successfully transferring power records. Preserve `hwi<newNodeId>` alias for reconnect.
* Revalidate original node and alias and absence of duplicate; restart the service. Restore the complete backup on failure before restarting.

This is a targeted administrative migration, not an automatic production agent-path action. In particular, do not attempt event rewrites or database file edits while MeshCentral is running. The `resolveHardwareIdentityAlias` path should not perform destructive database cleanup in response to a connection until concurrency and persistence semantics are tested.

The Miller/Bock device used to validate the procedure had 10 duplicate audit events and 2 duplicate power records. No automated tests of this offline migration have been run against production. Review and test on a restored backup first.