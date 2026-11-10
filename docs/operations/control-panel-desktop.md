# Distributing Control Panel for macOS

Control Panel currently runs from source. A Control Panel installer has not been built or tested. T3 already supplies the Electron shell, bundled server, DMG packaging and updater; reuse those instead of building another wrapper.

The target experience is: download the DMG, drag Control Panel into Applications, open it, connect an AI account and start working. Everyday use should not require a terminal or a separately running development server.

## First, make the fork independent

Before distributing a build, set the following consistently. A new name in the package file alone is insufficient.

| Area            | Current upstream behavior                                     | Control Panel requirement                                                                 |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Name            | T3 Code / T3 Code (Beta)                                      | Control Panel in Finder, Dock, menus and About; keep the existing nameless chat interface |
| App ID          | `com.t3tools.t3code`                                          | A unique, stable Control Panel bundle ID                                                  |
| Local state     | Packaged app defaults to `~/.t3`                              | Separate Control Panel data, with an explicit import option                               |
| Links and CLI   | `t3code://` schemes and a `t3` command                        | Separate schemes and command, or omit CLI installation in the first beta                  |
| Desktop updates | Upstream repository by default, configurable during packaging | This fork's releases only; disabled until its own release channel works                   |
| Server updates  | Upstream release URLs                                         | This fork's server releases, or a disabled self-update path                               |
| Hosted services | Upstream authentication, relay and web configuration          | Deliberate supported configuration; start with a local-only Mac beta                      |
| Model metadata  | Fetches the upstream model manifest                           | A deliberate choice to track upstream metadata or maintain a fork manifest                |

Key source locations are `apps/desktop/src/app/DesktopEnvironment.ts`, `DesktopStatePaths.ts`, `DesktopCliShim.ts`, `scripts/build-desktop-artifact.ts`, `packages/shared/src/cliRelease.ts` and `apps/server/src/provider/ModelManifest.ts`.

Keep an installed T3 app and the running web development environment separate. Do not point a test desktop build at another app's live database. An import should preserve the original and explain which accounts and settings it copies.

## Make first launch work on a clean Mac

The Electron package can run the bundled server through its own executable. Launching the packaged app does not need a separate Node installation.

Provider installation is a separate requirement. The current managed installation path covers Codex and Antigravity, while the added Claude account flow assumes Claude Code is already installed. Add an in-app Claude install, detection and retry flow before promising a terminal-free setup.

The research helper in `tools/ai-research` is portable source, not yet a bundled desktop feature. It needs Python 3.10 or later; its host collector schedule is not included. For a self-contained app, move collection and retrieval into the packaged backend, or ship a deliberately managed helper runtime. Connect briefing setup to the existing native task system. Do not require a new user to reproduce a developer's directory paths or LaunchAgents.

Local schedules need the computer to be awake and the relevant process running. For a briefing to arrive while a Mac is asleep or switched off, collection and synthesis need an explicitly configured always-on host. A desktop download alone does not provide that host.

## Build a local beta, then verify it

After the identity, state and update changes, use the existing packaging scripts. Inspect [release.md](release.md) for prerequisites and supported flags. The following existing task produces an ARM64 DMG from source; it is not a verified Control Panel release procedure yet:

```bash
vp run dist:desktop:dmg:arm64
```

The packager defaults to signing off and calls electron-builder with `--publish never`. Building locally does not publish a release. Begin with Apple Silicon for a local test, then add Intel if needed.

Before sharing a beta, verify on a clean user account or Mac:

- Launch from Applications without the original checkout, Node, Python or localhost development server.
- Install or detect the chosen provider, complete browser sign-in and connect a second account.
- Start a task, review the result, quit and reopen with history intact.
- Confirm storage and updates are separate from upstream T3.
- Set up research with an empty library; show actual source health and collection gaps.
- Check browser OAuth returns, missing-provider recovery, sleep/wake and permission prompts.

Use existing packaged-launch smoke tests alongside this real first-run check. No clean-Mac launch or Control Panel DMG has been verified at this stage.

## Sign and distribute the public Mac beta

For the normal download-and-open experience, configure the project's own Apple Developer ID signing and Apple notarization. Staple the notarization ticket to the distributed artifact. This is direct distribution, separate from a Mac App Store release. See [Apple's notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and [Electron's signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing).

Use a small macOS-only GitHub release workflow for this fork. The inherited main release workflow is restricted to the upstream repository and includes unrelated mobile, npm and hosted deployments. It is not ready to publish Control Panel unchanged. Keep inherited Actions disabled for the initial source-feedback repository.

Publish the signed DMG, companion ZIP, update metadata and checksums under this repository's Releases. The pinned electron-builder v26 Mac updater expects the ZIP as well as the DMG. See the [v26 macOS documentation](https://www.electron.build/v26/docs/mac/).

Test an update from one signed beta to the next before enabling automatic updates. Then a **Download for macOS** link can point to the Control Panel release rather than an upstream T3 download.

The Apple developer account, signing certificates, notarization credentials and end-to-end update path have not been checked or configured. Keep credentials out of source control and public build logs.
