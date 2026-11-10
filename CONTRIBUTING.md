# Contributing to Control Panel

This is an early, independent T3 Code fork. Feedback is welcome in [this repository's issues](https://github.com/jensglerum/control-panel/issues/new/choose).

## Start with the problem

Describe what you were trying to do, what happened and what you expected. Include a short reproduction and your operating system, provider and model when relevant. Remove account details, access tokens and private conversations from logs and screenshots.

<a id="prior-approval"></a>

For a larger feature, discuss the approach in an issue before building it. A small, focused bug fix can go straight to a pull request. There is no promised review time.

<a id="one-problem"></a>

## Keep changes focused

Solve one underlying problem per pull request. Keep T3's existing interface and shared abstractions where they fit. Read [AGENTS.md](AGENTS.md) and the [development runbook](docs/operations/development.md) before changing code. The runbook describes upstream tooling; the root README's isolated data directory is the recommended way to run this fork.

<a id="verification"></a>

## Verify the behavior

Run focused tests while developing, then `vp run check:changed` before proposing the change. Explain what you tested and what remains unverified. UI changes should include before and after screenshots. Do not commit private runtime data or test evidence containing real conversations.

GitHub Actions is not yet configured for this fork. The inherited workflows require upstream infrastructure and should stay disabled until replaced deliberately.

<a id="models"></a>

AI-assisted contributions are welcome. Review the result yourself and describe its behavior and validation clearly.
