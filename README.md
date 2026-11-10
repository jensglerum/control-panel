# Control Panel

A personal workspace for coding agents and AI research. Built on [T3 Code](https://github.com/pingdotgg/t3code).

Control Panel keeps T3's familiar interface and adds easier account setup, a clearer view of connected apps, simpler usage analytics and an optional Auto model selector. This is an early fork, shared to learn what people find useful and what needs work.

## What has changed

- **Accounts:** connect multiple OpenAI/ChatGPT and Claude accounts through browser sign-in, then choose an account in the model picker. Claude Code must already be installed.
- **Apps:** recognizable logos and separate states for saved configuration, authentication and a checked working connection. Connection checks are available for supported Codex profiles.
- **Analytics:** a simpler usage overview with model breakdowns and suggestions tied to the available data. API estimates are not subscription bills or productivity scores.
- **Auto model:** optional local rules choose a model and reasoning effort within the selected account. You can override the choice. This is a heuristic, with no guarantee of the best answer or lower total usage.
- **Research:** a public-source library with collection health, retained evidence, passage search and cited briefing helpers. The source is included under [tools/ai-research](tools/ai-research); collection and briefing schedules require setup.
- **Appearance:** a mountain background behind conversations, simpler Settings navigation and no product name in the app interface.

Existing T3 capabilities remain in the codebase. Most fork-specific verification has focused on local web use with Codex and Claude. Other providers, mobile, hosted services and packaged desktop use have not received the same verification.

## Try it from source

There is no signed public Control Panel Mac download yet. A local Apple Silicon preview can be built from source. Installing the official T3 release installs upstream T3 without these changes.

For now, a developer can run the fork locally. Install [Vite+](https://viteplus.dev/guide/), Git and at least one supported agent such as [Codex CLI](https://developers.openai.com/codex/cli) or [Claude Code](https://code.claude.com/docs/en/setup). The repository pins its Node and package-manager versions.

```bash
git clone https://github.com/jensglerum/control-panel.git
cd control-panel
vp i
vp run dev --home-dir "$PWD/.t3" --no-seed
```

Open the local address printed by the dev runner. The explicit data directory keeps this checkout separate from an existing T3 installation. Open **Accounts** to connect your own accounts; no accounts, conversations, API keys or research archive are shipped with the source.

For the research helper, start with [its setup guide](tools/ai-research/README.md). It needs Python 3.10 or later and does not install a background collector automatically. Direct authenticated X and LinkedIn collection is not implemented; indexed social snippets are labeled as discovery leads.

## Give feedback

[Open an issue](https://github.com/jensglerum/control-panel/issues/new/choose). Tell me what you tried, what happened and what you expected. Screenshots help, after removing private information.

Feedback is especially useful on account switching, connection states, analytics and Auto model choices. Include the prompt and selected model only when you can safely share them.

Please keep feedback about this fork in this repository. [Contributing](CONTRIBUTING.md) explains how to propose a change.

## Desktop app

The local Apple Silicon preview uses T3's Electron foundation with its own app identity, storage and command. Standalone launch and the Accounts page have been checked on the development Mac. Preview updates are disabled, and usage analytics are off by default.

A signed public installer, clean-Mac provider installation and built-in research setup still need work. Existing browser accounts and history are not imported automatically.

The [desktop distribution guide](docs/operations/control-panel-desktop.md) describes what can be reused and what remains. There is no release date promised.

Inherited workflows depend on upstream services and runners. GitHub Actions are disabled for the initial feedback repository until a fork-specific CI and release workflow is ready.

## Credit and license

Control Panel is an independent fork of T3 Code, not an official T3 release. The core application, desktop infrastructure and most of this codebase come from the T3 team and contributors. The upstream [MIT license](LICENSE), source notices and [third-party license configuration](third-party-licenses.config.json) are retained.

Provider and app names and logos belong to their respective owners. See the [app logo sources](apps/web/src/assets/apps/SOURCES.md). The maintainer has approved including the supplied mountain wallpaper in this repository.
