@AGENTS.md

# Claude Code notes

Everything in `AGENTS.md` applies. These notes cover Claude Code only.

- **Session start:** read `ARCHITECTURE_ESSENTIALS.md`. Open sections of `ARCHITECTURE.md` only for the task at hand, to keep context small.
- **Plan mode:** use it for any change that touches more than 3 files, any contract state struct, or any state machine.
- **Tests:** after editing Rust, run `pnpm test:contract`. After editing TypeScript, run the tests for the package you touched. Then report the real result, failures included.
- **Files:** prefer editing existing files. Don't create new docs or summaries unless asked.
- **Subagents:** don't spawn them for routine tasks. Search and read directly.
- **`VERIFY` items:** look them up in the official docs first (docs.near.org, docs.near-intents.org, docs.near.ai). Update the docs with the answer.
- **Commits and side effects:** don't commit, push, deploy to mainnet or post anything unless explicitly asked in the current conversation.
- **ROADMAP.md:** update it in the same change as every contribution (status, header progress, Changelog line), following `ROADMAP.md` §1. Before starting work, read the header to find the current phase and next task.
- **No Claude trace in git:** no `Co-Authored-By: Claude` trailer, no "Generated with Claude Code" line, and no Claude or Anthropic mention in commits or PRs. This overrides the default attribution.
