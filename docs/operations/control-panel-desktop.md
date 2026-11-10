# Distributing Control Panel for macOS

Control Panel has a locally verified, unsigned Apple Silicon preview: `0.1.0-preview.20261111.2`. The `.app`, DMG and ZIP build from this repository. This is an early local beta; no signed public installer has been released.

The preview launches its bundled server and web client through Electron. It does not need the browser development server or a separate Node installation to run its backend. Agent runtimes remain separate requirements.

## Identity and local data

The desktop app uses these independent defaults:

| Item                        | Control Panel value                                                |
| --------------------------- | ------------------------------------------------------------------ |
| App name                    | Control Panel (Beta)                                               |
| Bundle ID                   | `com.jensglerum.controlpanel`                                      |
| Server data                 | `~/.control-panel/userdata`                                        |
| Electron profile            | `control-panel` under the platform's application-support directory |
| URL schemes                 | `controlpanel` and `controlpanel-dev`                              |
| Optional command            | `control-panel`                                                    |
| New Claude account profiles | `~/.control-panel/account-profiles`                                |
| Release repository          | `jensglerum/control-panel`                                         |

Explicit `T3CODE_HOME` overrides remain supported for isolated development and tests. The fork does not automatically import an upstream Electron profile, project history or saved accounts. Previously configured account paths are preserved. The optional command has its own ownership marker and does not replace an existing `t3` command.

Preview builds omit the update feed, so update checking, downloading and installation are disabled. Default release discovery, download, recovery and feedback links target this fork. Stock `t3` npm update offers and boot-error triage commands are disabled. Provider updates continue to use their official vendor channels. The upstream model manifest remains a deliberate source of model metadata.

Product usage analytics and relay tracing default off. An explicit telemetry environment opt-in remains possible, while managed-policy denial takes precedence. Disabling delivery does not imply that all local identity metadata reads stop.

## Build the local preview

Install repository dependencies and the platform prerequisites described in [release.md](release.md). This Mac build needs Apple Silicon, the Rust target/toolchain, Xcode command-line tools and the pinned repository Node/package-manager tools.

From the repository root:

```bash
T3CODE_DESKTOP_SIGNED=false T3CODE_TELEMETRY_ENABLED=false \
vp run dist:desktop:artifact \
  --platform mac --target dmg --arch arm64 \
  --build-version 0.1.0-preview.20261111.2 \
  --output-dir release/mac-beta
```

The build produces a DMG and companion ZIP. It forces electron-builder's `--publish never`, and unsigned mode disables certificate discovery. `--target dir` produces an unpacked app for local checks. Use preview versions for local testing so they have no update feed. Build output is ignored by Git.

`--skip-build` is appropriate only when the web/server/desktop bundles are already current. `T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true` is appropriate only after the native monitor has been built for the target. Neither was used for the initial compile.

For packaging tests, use a canonical, nonhidden temporary directory outside the checkout and put `vp` on `PATH`. ASAR unpack globs do not match a hidden `.t3` ancestor, and the self-containment probe correctly rejects test bundles beneath a checkout's `node_modules` ancestor. Do not weaken these checks to make an unsuitable temporary path pass.

## What has been verified

The Apple Silicon preview built successfully and passed the packaged-payload validation. A normal native launch opened the welcome screen and workspace through `controlpanel://app`; quit and reopen preserved the new environment. The Accounts page detected the existing global Codex login. No projects or chat history were imported, and no model request was sent.

The installed preview has its own data and Electron profile, with no update-feed file. Source verification passed 352 tests in 31 affected files, type checks across 41 packages, seven targeted compiler checks, formatting, lint and unused-code checks. Focused regressions cover identity, storage boundaries, URL/OAuth/CORS wiring, updates, recovery and telemetry defaults.

This is evidence from the development Mac, not a clean-machine certification. Claude browser sign-in in the packaged app, agent inference, a fresh provider install and migration of existing browser accounts/history have not been verified in this preview. The app still uses upstream icon artwork.

## Finish first-run setup

The current managed installation path covers Codex and Antigravity. Claude account sign-in assumes Claude Code is already installed. Add in-app Claude installation, detection and retry before promising a terminal-free setup on a clean Mac.

The research helper in `tools/ai-research` is portable source, not a bundled desktop feature. It needs Python 3.10 or later, and its host collector schedule is not included. Move collection and retrieval into the packaged backend, or ship a managed helper runtime, then connect setup to the existing native task system. Do not require users to reproduce a developer's directory paths or LaunchAgents.

Local schedules need an awake computer and running process. Collection and synthesis while a Mac is asleep or switched off need an explicitly configured always-on host; a desktop download does not provide that host.

Before public release, test a clean user account or Mac: provider installation and sign-in, a second account, a real task, history after restart, research setup from an empty library, OAuth returns, missing-provider recovery, sleep/wake and permission prompts.

## Sign and distribute a public Mac beta

Configure the project's own Apple Developer ID signing and Apple notarization, and staple the notarization ticket. This is direct distribution, separate from the Mac App Store. See [Apple's notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and [Electron's signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing).

Use a small macOS-only release workflow for this fork. The inherited main release workflow is restricted to upstream and includes unrelated mobile, npm and hosted deployments. GitHub Actions remains disabled until a fork-specific workflow is configured.

Publish the signed DMG, companion ZIP, update metadata and checksums under this repository's Releases. The pinned electron-builder v26 Mac updater needs the ZIP as well as the DMG; see its [macOS documentation](https://www.electron.build/v26/docs/mac/). Test an update between two signed betas before enabling the feed. A **Download for macOS** link can then point to that release.

Apple account/certificate availability, signing, notarization and end-to-end updates have not been checked or configured. Keep credentials out of source control and public build logs.
