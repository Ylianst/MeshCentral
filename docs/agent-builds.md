# Agent builds

Agent builds lets administrators keep a catalog of agent binaries and choose
which build individual devices use. Builds can come from local files, public
download URLs, GitHub releases or GitHub Actions artifacts. Adding a build to
the catalog does not install it or change the server's default installers.

## Default agent downloads

MeshCentral obtains its default agent binaries from public GitHub releases.
The agent executables are not included in the server package. The release
manifest selects an exact repository, tag, asset, size and full-file SHA384 for
each file. It can reference several repositories and release versions. These
downloads do not require a GitHub token and do not use Actions artifacts or a
moving `latest` URL. Private releases are supported by catalog imports, but
cannot be used for automatic default downloads or scheduled release checks.

At startup, MeshCentral checks the persistent cache before signing Windows
agents or loading installer and update files. Missing files are downloaded and
verified before being moved into the cache. A complete cache works without
internet access. A failed download leaves that file unavailable and reports the
reason, while the server continues starting so administrators can recover it.
Download attempts have a combined two-minute startup deadline.

Open **Current defaults > Default downloads** to see file status and retry. The
retry also checks uploaded and imported builds in the default domain for files
with the expected release hashes. After restoring missing files, restart
MeshCentral to load them. Closing the dialog does not cancel these downloads.
Only administrators in the default domain can restore the shared defaults.

For offline installation, copy the release files into
`meshcentral-data/agentbuilds/` using the filenames in the manifest, or upload
native binaries through **Upload build**, complete the review and select
**Add build**. Then open **Current defaults > Default downloads** and select
**Check files**. Files listed in the release manifest must match its size and
SHA384. APKs, universal macOS binaries and other files unsupported by the native
upload review must be copied into the directory. Existing
`meshcentral-data/agents/` and per-domain `agents-<domain>/` overrides retain
their precedence.

To disable automatic downloads, merge this into `config.json`:

```json
{
  "settings": {
    "agentDownloads": {
      "enabled": false
    }
  }
}
```

The default manifest is `agents/agent-defaults.json` in the MeshCentral package.
An administrator can supply another using `settings.agentDownloads.manifest`,
with a path relative to the data directory or an absolute path. This is a
server-wide setting: choosing different defaults affects installers and devices
that follow the server default after a restart. Per-device pins and holds still
apply. Changing the manifest requires a restart.

A missing default does not prevent using a pinned or uploaded build. Devices
following that missing default retain their installed binary. Selecting a return
to the default is blocked until the file is restored and loaded.

The initial defaults preserve the binaries previously shipped in MeshCentral
1.2.6, using the `legacy-1.2.6` migration releases in MeshAgent and
MeshCentralAndroidAgent. Maintainers must publish those releases before a
MeshCentral package that uses them as defaults. The release workflow verifies
every pinned download before the npm release. See
[Agent release format](agent-releases.md) for the publication order.

## Release update checks

MeshCentral checks each repository in its default manifest once a day, with a
small random delay. Checks are shared by all domains and devices on the server.
The first check runs shortly after startup. **Default downloads > Check for
updates** starts a manual check. Repeated manual requests within one minute
reuse the previous result.

Only published stable version tags with an `agent-release.json` asset are
reported. Drafts, prereleases and migration releases are excluded. The dialog
shows the latest release, current default tags, last successful check and any
error. Results and HTTP validators are cached while the server is running.
Failed requests retain the previous result and delay subsequent checks.

Beta releases such as `1.2.0-beta.1`, and the preserved September release
`testing-sep2026`, remain available through **Import build > GitHub > Releases**.
Importing them does not install them or change the defaults; administrators
choose which devices receive them.

Checks do not download binaries, change defaults or deploy agents. Import an
available release to inspect its files, check device requirements and test it on
selected devices. Administrators can then choose a reviewed default manifest
and restart the server. Pins and holds retain their policies.

Set `settings.agentDownloads.checkIntervalHours` to an integer from 1 to 168
to change the schedule, or 0 for manual checks only. Setting
`settings.agentDownloads.enabled` to false disables both scheduled and manual
network checks as well as downloads. Public release checks need no GitHub token.

## Access and navigation

Open **My Server > Agent builds**. On mobile, select **Agent builds** from the
main menu. Catalog management, imports and bulk deployments require full server
administrator rights in the current domain.

To manage one device, open its **General** page and select the edit icon beside
**Mesh Agent**. Users with full rights on that device can change its build policy
without full server administrator rights. The link back to the catalog is only
shown to server administrators. Login tokens, temporary devices and recovery
agents cannot use these controls.

## Browse the catalog

The catalog opens on **Current defaults**. Use the view selector and file filter
to find builds:

| View | Contents |
| --- | --- |
| Current defaults | The files currently selected by the server, including domain overrides and server-signed binaries. |
| Additional builds | Uploaded and imported builds, and bundled build directories with a manifest. |
| Bundled agents | The agent files shipped directly in the server's `agents` directory, before signing or overrides. |
| Archived builds | Builds hidden from new selections. |

The **Devices** column on Current defaults counts registered devices of each
agent type, including offline, pinned and held devices. It does not mean every
listed device runs that default file. Installed counts use the last binary hash
reported by each device. Devices without a reported hash are excluded.

Expand a build's details to inspect its source, requirements and hashes. A hash
match confirms that a file agrees with its manifest; it does not verify the
publisher or guarantee that the executable will run on a particular device.

## Add a build

### Upload files

1. Select **Upload build** and choose the native agent binaries.
2. Select **Review files**.
3. Enter a build name and select the files to keep.
4. Confirm the compiled agent type and whether each file includes remote desktop
   support. Several MeshAgent types can share a CPU architecture, so architecture
   detection alone may not identify the correct type.
5. Confirm that you trust the files, then select **Add build**.

Uploads accept ELF, PE and thin Mach-O executables. Extract local archives before
uploading them. Universal Mach-O binaries and agents with appended connection
settings are not supported. Inspection reads the file without executing it.
It reports detected requirements and signature presence, but does not validate
publisher signatures. Some requirements, including instruction-set attributes
for uploaded ARM binaries, may remain unknown.

### Import from a URL

Select **Import build > Download URL**, enter the direct HTTPS download address,
then select **Download and review**. The URL must serve a native executable or a
ZIP archive. Supply a filename if the URL does not provide one. An optional
SHA256 checks the complete downloaded file, including the archive for ZIP imports.

Public GitHub release asset URLs work here. GitHub Actions run and artifact page
URLs require authentication and cannot be used as ordinary public downloads.
Use the GitHub source below, or download and extract the artifact yourself before
uploading its binaries.

URL imports use public HTTPS addresses on port 443. Private network addresses,
custom authentication and other archive formats are not supported. Non-binary
ZIP entries are skipped; unsafe paths, links, duplicate filenames, encrypted
entries and corrupt archives are rejected.

### Import from GitHub

**Public GitHub releases do not require a token or any GitHub configuration.**

Select **Import build > GitHub**, enter the repository as `owner/repository`, and
choose a source:

| Source | Selection | Token needed? |
| --- | --- | --- |
| Releases | A published release and its attached files. | No for public releases. |
| Workflow runs | Successful builds, optionally filtered by branch or full commit SHA. | Yes, to download Actions artifacts. |
| Pull request | Successful runs for the PR's current head commit. | Yes, to download Actions artifacts. |
| Run ID | A specific workflow run. | Yes, to download Actions artifacts. |

Select **Find builds**, choose a release or run, select its files, then select
**Download and review**. Complete the same review used for local uploads.

Workflow results include only completed, successful runs with available artifacts
matching the configured names. The defaults are `meshagent*` and `meshservice*`.
Matching is case-insensitive and `*` matches any text. This omits code-scanning
reports and other artifacts that do not match the agent names. Expired, empty
and oversized artifacts are also excluded. Matching a name does not establish
that an archive contains a valid agent; the downloaded files are still inspected.

GitHub results are paged. A workflow page examines 20 successful runs before
filtering, so it may contain fewer entries or none. Use **Next** when available.
Artifact metadata may take up to a minute to refresh. A workflow must already
have uploaded its artifacts; MeshCentral does not start or approve GitHub runs.

Source details record where the files were obtained, including the workflow or
release and its commit. They do not prove which source code the executable
contains. In particular, a pull-request workflow can compile a merge commit.

### Optional GitHub token

**Skip this configuration if you only download public releases.** A token is
needed to download GitHub Actions artifacts, including pull-request builds,
nightly builds and other workflow builds. Configure it once for each MeshCentral
domain that needs those downloads.

Private repositories, including their release assets, also require a token.
Browsing public builds and downloading public releases work without one, subject
to GitHub API rate limits.

Merge the following into the existing `domains` configuration in `config.json`,
replace the placeholder token, and restart MeshCentral. The empty domain name
selects the default domain; use the domain's configured name for other domains.

```json
{
  "domains": {
    "": {
      "agentBuilds": {
        "github": {
          "token": "YOUR_GITHUB_TOKEN",
          "artifactNames": ["meshagent*", "meshservice*"]
        }
      }
    }
  }
}
```

`artifactNames` is optional. Forks with different artifact names can supply up to
16 patterns, each at most 128 characters. This filter applies to Actions
artifacts, not release assets. An inactive example is also included in
[sample-config-advanced.json](../sample-config-advanced.json); remove the leading
underscore from `_agentBuilds` when enabling it.

The token needs access to the repository. For fine-grained tokens, the required
repository permissions are:

| Operation | Permission |
| --- | --- |
| Browse private workflows and download Actions artifacts | Actions: read |
| Import private release assets | Contents: read |
| Look up private pull requests | Pull requests: read, plus Actions: read for their builds |

See GitHub's documentation for
[artifact downloads](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact)
and [release assets](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).

All full administrators in the domain use the configured token. The import
dialog reports whether it is configured without returning its value. It remains
a secret in `config.json` and its backups, subject to the same access controls
as other server credentials. It is sent only to `api.github.com`, not to download
storage redirects or ordinary URL imports. GitHub sign-in settings for
MeshCentral users are separate from import credentials.

### Import limits

A review can contain up to 16 binaries, at most 64 MiB each and 128 MiB in total.
URL and GitHub imports also have a combined 128 MiB download limit and a maximum
of 512 ZIP entries. Two imports can run at once, with one per administrator.
Downloads time out after five minutes; review drafts expire after 30 minutes.

Closing the import dialog cancels an unfinished download or discards an
unpublished review. A server restart interrupts downloads; start them again
from the import dialog. Builds become available to other administrators only
after **Add build** succeeds.

## Choose a device's build

Open the device's **General** page and select the edit icon beside **Mesh Agent**.
Choose an update policy:

| Policy | Behavior |
| --- | --- |
| Follow server default | Uses the server's normal agent selection and domain overrides. Switching back to this policy can replace a pinned file with an older one. |
| Keep the installed agent file | Stops server-managed agent updates for this device. It does not save a copy of the installed file or stop agent core updates. |
| Pin a build | Keeps the device on the exact file selected from the catalog, including across reconnects and server restarts. |

For a pin, select both the **Build** and **Agent file**. Only files with the
same MeshAgent type ID are offered. Review the compatibility result, acknowledge
that you can recover the device locally, and select **Install and pin**.
Use **Apply** for the other two policies.

Compatibility checks query the connected device without executing the candidate
binary. They can check Linux libc, executable loaders and required libraries,
ARM CPU features, macOS versions and FreeBSD ABI requirements. The dialog shows
**Requirements met**, **Not checked**, or **Not compatible**. Confirmed
incompatibilities block installation; failed checks identify the requirement
that needs attention. Missing facts and unsupported checks remain unknown.

Requirements met means the checked requirements passed. It does not guarantee
a successful installation or override local update protection. Keep a way to
recover the machine if the new agent cannot start or reconnect. There is no
automatic rollback after a failed launch.

### Follow installation progress

Saving a policy can disconnect the agent and interrupt active sessions. The
binary update may restart its service. Offline devices apply a saved policy on
their next connection.

While a change is in flight the dialog reports policy saving, file transfer,
reconnect and verification as numbered steps. **Build installed and verified**
means the agent reported the expected update hash. A saved policy alone does not
establish that the build is installed. Keeping the installed agent file completes
as soon as its policy is saved, because it requests no replacement.

Closing the device dialog does not cancel a saved policy. Reopen it to check
progress. The **Installed** row identifies matching catalog files using the last
reported hash, and **Build details** holds the source links, the reported
revision and the hashes. An unidentified file can still report its compiled
version, but version metadata is not independent proof of publisher identity.

## Deploy to several devices

1. Select devices in the desktop device list and choose
   **Group Action > Deploy agent build**. Mobile offers the same action for the
   current device through **Actions**.
2. Choose the policy and, for a pin, one exact file for each agent type.
3. Set a batch size from 1 to 20. The default is 5.
4. Generate the preview and review eligible devices and skip reasons.
5. Acknowledge local recovery access and select **Start deployment**.

A job can include up to 10,000 selected devices. Preview does not change their
policies. Binary deployments skip offline devices, disabled updates, missing
files and confirmed incompatibilities. Unknown compatibility is excluded unless
you explicitly include it. Eligibility is checked again before each policy change.

Open **Agent builds > Deployments** to monitor saved jobs. Each batch waits for
its devices to report the expected hash before the next starts. A failure or
five minutes without confirmation pauses further dispatches. Hold is confirmed
by its saved policy. Server restarts leave unfinished jobs paused for review.

**Pause** and **Cancel remaining** stop new dispatches. Policies already applied
remain in effect. Closing a dialog does not stop a job. The owner can resume
remaining eligible targets; failed targets are not silently retried. Other full
administrators can pause or cancel a job. Bulk deployments are not supported
on peered servers.

## View usage and manage builds

Select an installed or pinned count to see the matching devices. Usage lists
are searchable and paged. Installed counts include offline devices whose last
reported binary matches; devices without a reported hash are not counted.
Identical files in more than one build can share an installed count. Pinned
counts refer to the selected catalog entry.

Use **Manage build** to archive or restore a build. Archiving hides it from new
selections and keeps existing pins working. Uploaded or imported builds can be
removed only when no registered device reports their bytes, pins them or awaits
them, and no unfinished deployment references them. Bundled builds can be
archived but cannot be removed through the interface.

## Storage and backup

Files are stored beneath `agentbuilds` in the server's data directory, normally
`meshcentral-data`:

| Relative path | Contents |
| --- | --- |
| `agentbuilds/staging/<owner-hash>/<review-id>/` | Temporary files awaiting review. |
| `agentbuilds/catalog/<domain-hash>/custom-<build-id>/` | Published uploads and imports, with binaries and `manifest.json`. |
| `agentbuilds/catalog/<domain-hash>/.state/` | Archive state for catalog entries. |
| `agentbuilds/<sha256>` | Binary copies retained for pinned deployments. |
| `agentbuilds/defaults/<sha384>/<filename>` | Verified default release files, retained across server upgrades. |
| `agentbuilds/<filename>` | Manually supplied default files for offline installation. |

Device policies, deployment jobs and reported build identities are stored in the
database. Back up the database and `agentbuilds` directory together. Container
installations need persistent storage for the server's data directory.

Pinned binaries are retained independently of their catalog entries and are
not automatically cleaned up when policies change. Missing or damaged pinned
files block updates instead of silently reverting to the default binary.

Before reverting to server code without build-policy support, disable server
binary updates or intentionally return devices to the default policy. An older
server cannot honor pins or holds.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Requirements pass but Install and pin is disabled | Read the installation blocker. Agent or server update restrictions are separate from compatibility checks; another update may also be in progress. |
| The agent reports binary updates disabled | Apply Hold first, enable updates locally, reconnect, and refresh the dialog before choosing a build. Removing a line from `.msh` may leave an imported setting in the agent database; `disableUpdate=0` still disables updates. |
| A build is missing from workflow results | Check the run succeeded, the artifact has not expired, its size is within the import limit, and its name matches `artifactNames`. Check later result pages as well. |
| GitHub denies a request | For public releases, check asset availability and API rate limits; a token is not normally required. For Actions or private imports, check the configured token, repository access and permissions. Restart MeshCentral after changing the configuration. |
| A device is waiting for reconnect or verification | Check whether it is online and inspect the progress details. Lack of confirmation is not proof of failure; recover the device locally if its new agent cannot start. |
| A build cannot be removed | Check its usage and unfinished deployments. Archive it if it must remain available to existing pins. |

Device policy changes are not supported on peered servers. Catalog pins do not
change installer downloads or replace server-wide defaults. Agent-side update
restrictions still apply; the interface does not clear them automatically.
