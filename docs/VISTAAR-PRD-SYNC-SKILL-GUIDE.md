# Guide — build a Claude skill that keeps your PRDs in sync

*Written 22 October 2026, from the `kb-prd-sync` skill built for Vistaar 2.0. For any developer who wants
their project's PRDs (or any code-derived docs) to stay current with the code and land in this knowledge
base automatically.*

Docs drift the moment code merges. This guide shows how to build a Claude Code **skill** plus a few
**hooks** that notice when your watched branches move, refresh only the parts of the docs the new code
touches, verify everything against the code, and publish the result to the knowledge base on your own
branch. It is written so you can rebuild it for your project without seeing the original files.

## Contents

1. What you get
2. How it fits together
3. Before you start
4. Step 1 — skill folder and SKILL.md
5. Step 2 — project registry and state
6. Step 3 — the staleness check (and the hooks)
7. Step 4 — prepare a refresh
8. Step 5 — update the sections (agents)
9. Step 6 — function reference (TypeScript)
10. Step 7 — assemble, stamp, scan
11. Step 8 — publish to the knowledge base
12. Step 9 — test it dry, then switch it on
13. Lessons learned
14. Adapting it

---

## 1. What you get

| Piece | What it does |
|---|---|
| **Skill** (`SKILL.md` + scripts) | The procedure Claude follows: check, prepare, update, assemble, publish, report |
| **Hooks** | Tell Claude "your docs are behind" right after a push / merge / pull, at session start, and every 30 minutes on a prompt |
| **Registry** (`projects.json`) | One entry per project: repo, source branch, watched branches, doc names, KB folder |
| **State** (`state.json`) | The commit each project's docs were last published from — what the hooks compare against |

Results on Vistaar: the first full build took an afternoon. A refresh across 33 merges and 133 changed files
took about an hour with 13 small parallel agents, and kept 1,880 of 2,101 function descriptions without
rewriting them. A branch that moved without code changes needs no agents at all.

## 2. How it fits together

```
git push / merge / pull ──┐
session start ────────────┼──► hook: check_stale ──(only if a watched branch moved)──► "docs are behind"
prompt (≤ every 30 min) ──┘                                                                  │
                                                                                             ▼
                          Claude runs the skill:  status → prepare → update sections → function reference
                                                  → assemble + stamp + sensitive scan → publish to KB → state
```

Three modes, picked from the status:

| Situation | Mode |
|---|---|
| nothing moved | stop |
| only `main` / prod / deploy branch moved, source branch unchanged | **stamp**: refresh the "watched branches" line, publish |
| source branch moved | **incremental**: refresh only the sections the diff touches (inline for small diffs, agents for big ones) |
| project has no docs yet | **bootstrap**: write them once from scratch, then the same loop |

## 3. Before you start

- Claude Code, with the Agent tool (subagents) available.
- Local clones of your project repo and of `knowlegde-base`, with push access to your own KB branch.
- `python3` (plus `pyyaml` for the KB validator) and `git`. For a TypeScript project: `node`, and the
  project's own `node_modules/typescript` (the function list is read with the compiler).
- Your docs, built once. The skill refreshes existing docs; it does not invent a document structure. Each
  doc must be organised as `## N. Title` sections, and its header must name the commit it describes as
  ``latest `<branch>` (`<hash>`)``. The scripts rely on both.
- Read the KB's `AUTHORING-STANDARD.md` and `CONTRIBUTING.md`. Your publish step must produce notes that
  pass them.

## 4. Step 1 — skill folder and SKILL.md

A skill is a folder with a `SKILL.md`. Put it under your user's Claude folder (`~/.claude/skills/<name>/`)
so it works in every repo. A skill inside one repo's `.claude/` only works there, and is shared with
everyone who clones it.

```
<skill-name>/
├── SKILL.md                 frontmatter (name, description) + the procedure
├── projects.json            registry
├── scripts/                 check_stale · prepare · fnlist (TS) · build_function_reference
│                            assemble · scan_sensitive · publish_kb · shared helpers
└── references/              agent rules template · refresh method · KB conventions · new project
```

**The description decides when Claude uses the skill.** Claude tends to under-use skills, so make it
specific and a little pushy. Name the docs, the KB branch, the trigger phrases ("out of date", "push to the
knowledge base"), and the situations: a push or merge into beta, main, a prod or deploy branch, or a big
feature landing. Add "even if they do not name the skill".

**Keep the body short and explain why.** Aim for under 500 lines, and move detail into `references/`. Spell
out the rules a model would otherwise get wrong, with their reason:
- read the source branch from a `git archive`, never the local checkout;
- never commit the docs in the project repo;
- push only your KB branch, never `master`;
- nothing sensitive goes into the docs;
- finish the user's current request before refreshing.

Then list the workflow steps, each naming its script and the command to run.

## 5. Step 2 — project registry and state

```json
{
  "kb": { "repo": "<path to your knowlegde-base clone>", "remote": "origin",
          "branch": "<your-docs-branch>", "base": "master" },
  "default_watch_branches": ["beta", "main", "master", "prod", "production", "release", "aws-deployed", "aws-deploy"],
  "projects": {
    "<project>": {
      "title": "<Human name>",
      "repo": "<path to the project clone>",
      "source_branch": "beta",
      "watch_branches": null,
      "language": "typescript",
      "src_dir": "src",
      "export_paths": ["src", "docs", "CLAUDE.md", "package.json"],
      "docs_dir": "docs",
      "docs": { "overall": "<PREFIX>-PRD-OVERALL-FLOW.md", "technical": "<PREFIX>-PRD-TECHNICAL.md",
                "database": "<PREFIX>-PRD-DATABASE.md" },
      "kb_folder": "projects/<project>", "kb_hub": "<project>._index.md",
      "kb_tags": ["project/<project>", "prd"]
    }
  }
}
```

- **Prefix the file names** with the project (`VISTAAR-PRD-…`). Copies get shared on Slack, and a bare
  `PRD-TECHNICAL.md` does not say which portal it is about.
- **`watch_branches: null`** means the default list. Only the branches that exist on the remote are
  watched (for Vistaar: `beta`, `main`, `aws-deployed`).
- **State** lives outside the skill, in `~/.claude/<skill>/state.json`:
  `{ built_from: {branch, hash}, branches: {name: hash}, published, kb_commit }` per project. The
  publish step writes it.

## 6. Step 3 — the staleness check (and the hooks)

`check_stale.py` has a manual mode (prints JSON) and a hook mode (reads the hook's JSON on stdin). It:

1. finds the project from the hook's `cwd`, or from a repo path named in the command (`git -C <repo> …`);
2. runs `git fetch` (short timeout; offline means "compare with what we have");
3. compares each watched branch's remote hash with the state: the source branch with `built_from`, and the
   others with `branches`;
4. prints a `hookSpecificOutput.additionalContext` message only when something moved, naming the
   branches, `old -> new`, the commit count, and stamp vs full refresh.

```python
GIT_CHANGE = re.compile(r"\bgit\b[^|;&]*\b(push|merge|pull)\b|\bgh\s+pr\s+merge\b")
# post-tool: return at once unless the Bash command matches GIT_CHANGE
# prompt:    at most once per 30 minutes per project, and only for a new set of heads
# any error: swallow it — a hook must never break the session
```

The hooks go into your **user** settings (`~/.claude/settings.json`). Add them yourself or through
`/hooks`: Claude's auto mode will not edit that file for you, and that is intended.

```json
"hooks": {
  "PostToolUse":      [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "python3 ~/.claude/skills/<skill>/scripts/check_stale.py --hook post-tool", "timeout": 30 } ] } ],
  "SessionStart":     [ { "hooks": [ { "type": "command", "command": "python3 ~/.claude/skills/<skill>/scripts/check_stale.py --hook session-start", "timeout": 30 } ] } ],
  "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "python3 ~/.claude/skills/<skill>/scripts/check_stale.py --hook prompt", "timeout": 30 } ] } ]
}
```

Why three hooks? `PostToolUse` only sees pushes and merges you make inside Claude. A PR merged on GitHub
by a teammate is caught at the next session start, or by the throttled prompt check.

## 7. Step 4 — prepare a refresh

`prepare.py --project <p>` builds a work folder, `…/<old>..<new>/`:

| Output | How |
|---|---|
| `b-old/`, `b-new/` | `git archive <hash> <export_paths>`: exact snapshots of the two commits, independent of the checkout |
| `commits.txt` | `git log --oneline --first-parent old..new` — the merged PRs, to brief agents |
| `docs.diff` | `git diff old new -- docs CLAUDE.md`, excluding the PRDs themselves |
| `changes.json` | changed source files grouped by module, with add / modify / delete counts |
| `sec/<kind>/NN-ID.md` | the current docs split at `## ` headings (`NN` keeps the order, `ID` is the section number) |
| `fn-*.json`, `todo-B<n>.json` | the function list (next step) and the descriptions still to write, ~60 per batch |
| `RULES.md` | the agent rules with this run's folder, hashes and date filled in |

The old commit comes from the state, else from the doc header. The new commit is the source branch's
remote head.

## 8. Step 5 — update the sections (agents)

**Section ownership is what keeps parallel agents from clashing.** Each agent owns a fixed list of section
files and writes only `sec-new/<kind>/<same name>`. A brand-new section gets a name that sorts after its
neighbour (`15a-13A.md`). Anything not rewritten falls back to the old text when assembled, so the header
and contents must always be rewritten.

Map each change to sections:

| Change | Sections |
|---|---|
| a module's services / controllers / domain | technical: that module's section · overall: the flow that uses it |
| a module's schemas | database: that collection + collection map + index list |
| error codes file | technical: error catalogue |
| env schema | technical: production / env |
| prod checklist | technical: go-live gates · database: index list |
| a new module | a new technical section + overview + contents · its collections · its place in the overall flow |
| anything | headers, contents, the code-vs-docs discrepancy sections |

The rules file every agent reads first (the full template is in the skill's `references/`):
- the source of truth is `b-new`: its code, its docs and its `CLAUDE.md`;
- ignore any `CLAUDE.md` in the agent's own context, because it comes from your checked-out branch;
- zero assumptions — anything that can't be verified stays as it was or is marked "not on beta";
- keep each document's style; technical has no schema, database is schema only, overall is non-technical;
- no personal data, credentials, local paths or DB hosts;
- write only the assigned files, and send back a short report.

Practical sizing:
- **Small diff** (one or two modules): no agents. Edit the section files yourself.
- **Big diff:** about one agent per area — onboarding, orders, earnings, payments, cross-cutting technical,
  cross-cutting database, overall flow — plus one agent per function batch.
- **Effort:** set the function-description agents to low effort; extraction does not need deep reasoning.
- **Briefs:** give each agent the merge titles that concern it, and tell it the code wins over your brief.
  On Vistaar an agent caught a brief that was out of date: a profile place edit had started moving the
  earning cohort straight away.
- **Findings:** when an agent finds a cross-section fact (a doc contradicting the code, a new error code),
  relay it to the agent that owns the discrepancy or error-catalogue section. Re-check it yourself before
  it goes in. One that held up on Vistaar: an attendance streak capped at 31 days by a read limit, while
  the docs promise 60.

## 9. Step 6 — function reference (TypeScript)

A list of every function (file, line, route / guard, kind, one-line purpose) is the part developers use
most. Do not let a model list functions: it misses some. Use the compiler.

`fnlist.js` walks `src/` (no specs) with the project's own `typescript` package and records:
- top-level function declarations, and `const x = () =>` / `function` expressions;
- class methods, getters, and arrow-function properties (constructors are left out);
- each one's `@Get/@Post/…` route (with the `@Controller` prefix) and its `@Public` / `@Can(...)` guard;
- a **hash of the function's text**.

```js
const ts = require(argOf('--ts'));            // <repo>/node_modules/typescript
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
// FunctionDeclaration · VariableStatement(arrow/function) · ClassDeclaration → MethodDeclaration,
// GetAccessor, PropertyDeclaration(arrow); route from decorators; h = sha1(node text, whitespace-folded)
```

**Purpose reuse is what makes refreshes cheap.** A function whose `(file, name)` and body hash are unchanged
keeps its old purpose line. Only new or changed functions go to the batch agents.

**Check the extractor** by running it on the commit your docs were built from: its count must equal the
number of rows in your existing reference. On Vistaar both were 1,955.

`build_function_reference.py` rebuilds the section:
- same intro, group order and file order as before, with counts and hash refreshed;
- new files slot in alphabetically, and a new module group goes after the group that sorts before it;
- routes in backticks, `@Can(cap)` without quotes, modifiers as `private async`;
- it refuses while any purpose or file role is missing.

Other languages: write an equivalent extractor (Python `ast`, Go `go/parser`), or leave the function
reference out.

## 10. Step 7 — assemble, stamp, scan

- **Assemble:** for each doc, take the `sec-new` version of a section if one was written, else the old one,
  and join them in file-name order.
- **Stamp:** one header line listing the watched branches, e.g. ``*Watched branches, checked 22 October
  2026: `beta` `57e758d` (what this document describes) · `main` `7c6f027` · `aws-deployed` `5113b6c`.*``
  Stamp the commit the content describes, not the branch head. If you stamp the head on a stamp-only
  run, a stale document claims to be current. Rewrite the line on later runs rather than adding a second
  one.
- **Scan:** refuse the run on local machine paths, connection strings, private keys, tokens
  (GitHub / AWS / Slack / Razorpay key shapes), real email addresses and database host names. Plant one
  of each in a test file once, to prove the scan catches it.
- Write the docs to the project's `docs/` and leave them **untracked**. They are for the developer's own
  copies; the KB is the published home.

## 11. Step 8 — publish to the knowledge base

`publish_kb.py` does this in a **detached git worktree**, so your own KB checkout is never touched:

1. Start from `origin/<your branch>`, or from `origin/master` the first time. **Merge** `origin/master`
   into it rather than rebasing, so you never need a force-push. On a conflict, abort and report; nothing
   is pushed.
2. Read the hash the docs describe from their headers. If the docs disagree, stop. Recording the branch
   head instead would mark outdated docs as current and silence the hooks.
3. Write each note as: KB frontmatter (`type: reference`, `status`, `owner`, `last_verified`, `tags`,
   `aliases`) + the doc + `## Related` (links to the hub and the sibling docs) + `## Changelog` (keep the
   old dated lines, add one).
4. Make sure the folder hub (`<folder>._index.md`, `type: index`) links every note.
5. Add an `AGENTS.md` bullet under today's date, stating the before → after commit.
6. Run `python3 scripts/kb_check.py <paths>` and `--hub <folder>`; both must be clean. `--changed` does
   not see files that are not committed yet, so always pass the paths.
7. Commit (`docs(<area>): …`), then `git push origin HEAD:refs/heads/<your branch>`. Never push to
   `master`; PRs are opened by a person.
8. Record the new hashes in the state.

## 12. Step 9 — test it dry, then switch it on

Before the first real run, check that:

- [ ] `check_stale` in manual mode shows the right heads for your repo;
- [ ] simulated hook input (pipe JSON into `--hook post-tool`) behaves:
  - speaks for a `git push` in the repo;
  - stays silent for `ls`;
  - stays silent for a push in another repo;
  - speaks for `git -C <repo> merge …`;
  - speaks at session start in a sub-folder;
  - throttles the second prompt;
  - exits 0 on garbage input;
- [ ] `prepare` runs on the real pending diff, and its batches and section list look right;
- [ ] the function extractor reproduces your existing reference's count;
- [ ] `scan_sensitive` is clean on your docs and catches planted secrets;
- [ ] `publish --dry-run` gives a clean validator and hub result, and leaves no worktree behind.

Then add the hooks. The next push or merge into a watched branch starts the loop.

## 13. Lessons learned

| Lesson | Why it matters |
|---|---|
| Build from `git archive <source branch>`, never the checkout | The PRDs once went out built from a feature branch; the reader needed current beta |
| Agents receive the checked-out branch's `CLAUDE.md` | Their "CLAUDE.md says…" claims must be checked against the snapshot's file |
| The code wins over your brief | Briefs written from memory go stale; tell agents to say so when they disagree |
| Stamp and record the *described* commit, not the head | Otherwise a stale doc looks current and the hook goes quiet |
| Merge, don't rebase, the KB branch | No force-push to a shared remote |
| `kb_check --changed` ignores uncommitted files | Pass the paths explicitly |
| Shell heredocs expand backticks | Write markdown containing `` `code` `` with a file-edit tool or a quoted heredoc (`<<'EOF'`) |
| Claude cannot edit your settings file in auto mode | Install the hooks yourself — by design |
| The KB's default branch is `master` (there is no `main`) | Cut your docs branch from `origin/master` |
| Production facts in docs come from read-only checks, and say so | The docs are trusted by other teams; production is read-only |

## 14. Adapting it

- **Another project:** add a registry entry; the hooks find it by repo path. Build its docs once, then the
  loop takes over.
- **Your own branch:** set `kb.branch` (e.g. `<name>-dev-docs`). The KB's `CONTRIBUTING.md` suggests
  `docs/<area>-…`, but a personal long-lived docs branch with PRs into `master` works too.
- **Different docs:** any doc set that is split by `## ` sections and names its commit in the header works.
  The function reference is optional.
- **No KB:** stop after assemble; the hooks and refresh still keep the repo's untracked docs current.

---

## Related
- [[vistaar-2.0._index|Vistaar 2.0 — Map of Content]]
- [[VISTAAR-PRD-TECHNICAL|Vistaar Technical PRD]] — the kind of document this skill maintains
- [[CONTRIBUTING|CONTRIBUTING]] — how changes reach `master`
- [[AUTHORING-STANDARD|AUTHORING-STANDARD]] — what a note must contain

## Changelog
- 2026-10-22 — First version, from the `kb-prd-sync` skill built and dry-run tested for Vistaar 2.0.
