# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Repository

Infer the repository from `git remote -v`; verify the target before any write.
The requirements document names `CaiYan12/overthecocoons`; the actual remote is authoritative.
A configured tracker is not blanket authorization to publish issues, comments, or other external messages.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <path>`.
- **Read an issue**: `gh issue view <number> --comments`; fetch labels when needed with `--json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`, with appropriate label and state filters.
- **Comment**: `gh issue comment <number> --body-file <path>`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number>`; publish a comment separately if required and authorized.

Write multi-line bodies to a UTF-8 file and pass `--body-file`. Do not use Bash heredoc syntax in PowerShell. Never include secrets.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If this flag is explicitly changed to yes, use the `gh pr` equivalents for reading, listing, commenting, labelling and closing PRs. Keep external request authors distinct from owners and collaborators. Verify supported JSON fields before relying on them.

GitHub shares a number space across issues and PRs. Resolve whether a bare `#<number>` is an issue or PR before acting.

## When a skill says "publish to the issue tracker"

Create a GitHub issue within the authorized scope.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`: one map issue and child issues as tickets.

- **Map**: one issue labelled `wayfinder:map`, holding Notes / Decisions-so-far / Fog.
- **Child ticket**: link as a GitHub sub-issue when available. Otherwise use a task list in the map and `Part of #<map>` at the top of the child body. Type labels are `wayfinder:<type>` (`research`, `prototype`, `grilling`, `task`).
- **Blocking**: prefer native GitHub issue dependencies when available. Verify current API documentation and actual availability before using them. Dependency identifiers are numeric issue database IDs, not issue numbers or node IDs. Otherwise use `Blocked by: #<number>` in the child body.
- **Frontier**: inspect the map's open children, exclude assigned issues and issues with open blockers; choose the first eligible child in map order.
- **Claim**: `gh issue edit <number> --add-assignee @me` when authorized.
- **Resolve**: post the answer, close the issue, and add the result/context pointer to the map within the authorized scope.

Only provision extra wayfinder labels when that workflow is actually used.
