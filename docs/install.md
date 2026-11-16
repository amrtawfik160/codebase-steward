# Installation

## Recommended: choose your agent

```sh
npx skills add amrtawfik160/codebase-steward
```

The [Skills CLI](https://skills.sh/docs/cli) prompts for your agent and installation scope. Its current requirement is Node.js 22.20+. The core instructions do not require Node; only the installer and optional tools do

To install globally for Claude Code without prompts:

```sh
npx skills add amrtawfik160/codebase-steward --skill codebase-steward -a claude-code -g -y
```

For Codex, replace `claude-code` with `codex`. Omit `-g` for project-only installation. Set `DISABLE_TELEMETRY=1` if you want to disable the third-party installer's telemetry; the bundled inspector and guard make no network requests

Start a new agent session and ask it to use `codebase-steward`. Automatic selection depends on your agent, so naming it explicitly is the reliable path

## Manual: Claude Code

```sh
mkdir -p ~/.claude/skills
git clone https://github.com/amrtawfik160/codebase-steward.git ~/.claude/skills/codebase-steward
```

For a project-local installation, clone into `.claude/skills/codebase-steward` inside the project instead

If the destination already exists, review it before updating. Never overwrite local modifications blindly. To update a clean Git clone, run `git pull --ff-only` from that clone; for Skills CLI installations use `npx skills update`

## Other agents

Use the Skills CLI's supported agent option, or copy this folder into the agent's documented skill location. Keep `SKILL.md`, `references/`, and `scripts/` together, along with `LICENSE`, `NOTICE.md`, and `licenses/`

If your agent does not have a skill loader, give it the path to `SKILL.md` and ask it to read that file before starting

## Confirm it works

Ask: “Read the codebase-steward skill and review this repo without making changes”

The expected result is a scoped review with evidence and verification limits, not an unrequested refactor. If the agent cannot find the skill, check its supported installation directory and start a fresh session
