# Agent release format

Agent releases are published in their own repositories, independently of
MeshCentral. Each release contains the binaries and a manifest describing them.
MeshCentral selects its default files through `agents/agent-defaults.json`.
Publishing an agent release does not change those defaults or deploy agents.

## Tags and prereleases

Use version tags such as `1.2.0` for stable releases and `1.2.0-beta.1` for
testing builds. Agent and MeshCentral version numbers do not need to match.
The release tag is separate from the agent's embedded build date and commit hash.

Mark beta releases as prereleases in GitHub. MeshCentral's scheduled update
checks exclude them, but administrators can import them through **Agent builds**
and install them on selected devices. Keep beta files out of the default manifest
until they are approved for general use.

Do not replace published assets or move published tags. Changed binaries,
including signing changes, need a new release.

## Release assets

Publish each unconfigured binary as a separate raw asset, using its established
filename, such as `meshagent_x86-64` or `MeshService64.exe`. Preserve names that
distinguish libc, CPU architecture and KVM support. Default downloads require
raw files; archives can be imported separately through **Agent builds**.

Publish `agent-release.json` alongside the binaries. It records the repository,
tag, filename, asset name, byte length and SHA384 of each complete file. Generate
these hashes after signing and any other changes to the files. Use the full-file
hash, which can differ from MeshCentral's native update hash.

The JSON format is:

```text
{
  "schemaVersion": 1,
  "releases": [
    {
      "repository": "owner/repository",
      "tag": "exact-release-tag",
      "files": [
        {
          "filename": "meshagent_x86-64",
          "asset": "meshagent_x86-64",
          "size": <byte length>,
          "sha384": "<96 lowercase hexadecimal characters>"
        }
      ]
    }
  ]
}
```

`filename` is the name MeshCentral expects. `asset` is the name attached to the
GitHub release; the two names can differ. Each filename must be supported by
MeshCentral and appear only once in a default manifest.

The release workflows generate this manifest automatically. For manually
prepared files, run the following from the MeshCentral repository root, using
the release's repository, tag and complete file list:

```sh
node agents/release-manifest.js --repository Ylianst/MeshAgent --tag 1.2.0 \
  staging/meshagent_x86-64 staging/meshagent_x86 > staging/agent-release.json
```

## Publishing workflow

In MeshAgent:

1. Push a version tag at the commit to release. This starts **Agent Release**.
   Manual runs must also select a version tag.
2. Wait for the Linux, Windows, macOS and FreeBSD builds to finish. All must
   succeed before the workflow creates a draft with the binaries and manifest.
3. Review the assets and release notes, then publish the draft. Tags with a
   suffix, such as `1.2.0-beta.1`, create prerelease drafts.

MeshCentralAndroidAgent's **Android Release** workflow requires a tag matching
the app version and the existing Android signing secrets. It creates a draft
with `meshagent_android.apk` and `agent-release.json`, retaining the versioned
APK and AAB downloads. Do not change the signing key for an existing Android
application.

Neither workflow overwrites an existing release. These workflows use their
repository's `GITHUB_TOKEN` to create the draft.

Public release downloads in MeshCentral do not require a GitHub token.
Downloading PR builds or other Actions artifacts requires a token; access to
private repositories also requires authentication.

## Selecting MeshCentral defaults

After publishing and checking compatibility, copy the approved release entries
into `agents/agent-defaults.json`. The manifest can combine files from different
repositories and versions, so older platforms can keep their existing builds.

Default downloads use the exact tags and hashes in this manifest. Scheduled
checks report new stable releases without changing the selected files. Changing
defaults affects installers and devices that follow the server default;
per-device pins and holds still apply.

Before publishing MeshCentral, its release workflow checks package contents
and downloads every pinned asset to verify its size and SHA384. Missing assets,
failed downloads or checksum mismatches stop the release. Agent releases can be
published and imported without a MeshCentral release.

## Migrating the bundled files

The migration workflows preserve the binaries previously bundled with
MeshCentral 1.2.6, including the September testing builds. They verify the
original files against recorded hashes without rebuilding or signing them.

1. Run **Migrate bundled agents** in MeshAgent with the `legacy` profile, and
   **Migrate bundled Android agent** in MeshCentralAndroidAgent. Each workflow
   creates a draft `legacy-1.2.6` release.
2. Review and publish both drafts before publishing a MeshCentral package that
   uses them as defaults. Keep migration releases excluded from GitHub's
   latest-release selection.
3. To publish the September files for testing, run the native workflow with the
   `september` profile. Publish its `testing-sep2026` draft as a prerelease and
   leave these files out of the default manifest.

Migration tags identify the packaging commit. The release manifest records the
source repository, archive commit and original paths for the preserved files.

For forks, publish in the fork repositories and update the repository fields in
MeshCentral's default manifest before distribution.

See [Agent builds](agent-builds.md#default-agent-downloads) for server
configuration, offline installation and download recovery.
