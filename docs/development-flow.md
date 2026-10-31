# Development flow

The flow for mmd-gltf is: Issue → implementation → PR → review → revision as
needed → merge. Perform post-merge verification only when the Issue requires it.
The default branch is `main`.

## Collaboration language

Use **English** for newly authored templates, development/review/merge
documentation, AI instructions, Issue and PR titles and bodies, review comments,
and commit messages. This collaboration convention does not require translating
historical content or changing product localization.

## 1. Start with an Issue

Use the [Issue template](../.github/ISSUE_TEMPLATE/issue.md) to describe the problem,
expected outcome, relevant context, reproduction steps where applicable, and
concrete completion criteria. No assignee or owner field is required.

Use the source Issue to determine scope. Clarify genuinely blocking ambiguity
before dependent implementation; do not invent requirements. Choose the smallest
coherent change that fully addresses the Issue. Preserve justified existing
conventions and useful content. Avoid unrelated refactoring, speculative
abstractions, frameworks, or extra policies/configuration without a demonstrated
need tied to the Issue. Simplicity does not excuse missing requirements or
necessary validation.

Default to criteria an AI agent can execute and verify. Require human confirmation,
physical-device testing, subjective evaluation, or external approval only when
necessary for the actual Issue, explaining why and what result is expected.

Separate these categories:

- **Pre-merge acceptance:** mandatory implementation requirements and checks that
  can be achieved and verified before merge.
- **Optional validation:** useful additional checks that are not completion gates.
- **Required post-merge verification:** genuinely necessary checks possible only
  after merge. State "None required" when none are needed; do not add them routinely.

Checks possible only after merge must not be prerequisites for pre-merge approval.
For example, if a future change uses a merge-triggered deployment, validate the
relevant files and available local checks before merge; verify publication after
merge. This separation does not waive implementation requirements or applicable
pre-merge checks.

## 2. Implement and validate

Inspect the current repository and its instructions before editing. Keep changes
within the Issue's scope and choose validation appropriate to the changed files
and actual repository tooling.

The repository has a TypeScript converter, Three.js plugin, browser example and
Pages CI. Use the setup and relevant check commands in [README](../README.md).
Do not add scaffolding, dependencies or tooling merely to document a process.

Apply the [test and CI principles](browser-ci.md#test-and-ci-principles) when
choosing validation and changing tests or CI. They relate the configured checks,
coverage allocation and measured browser baseline to the change's needs.

For templates/documentation changes, inspect template metadata and Markdown syntax,
verify relative links and heading anchors, and check consistency across the
templates, README, and guidance. Use available tooling without adding dependencies
solely for these checks. Check whitespace with `git diff --check` (or
`git diff --cached --check` for staged changes). Review the complete diff, including
new files. No unrelated runtime suites, hardware/device checks, or deployed-site
verification are required for a templates/documentation-only change.

## 3. Open a PR for the Issue

Target `main` unless the task specifies another branch. Use the
[PR template](../.github/pull_request_template.md) to explain the problem, resulting
behavior, focused changes, related Issues, and validation actually performed.
Report failures, skipped checks, and unperformed checks accurately, with reasons.
Separate mandatory checks, optional validation, and pending post-merge verification.

Claim to close an Issue only when the implementation fully addresses it. If the
change intentionally addresses part of the Issue, state the remaining scope and
leave the Issue open. Required checks possible only after merge can remain pending
without making an otherwise complete implementation partial.

## 4. Review and revise

Apply the [review guidelines](review-guidelines.md). The central question is:
**Does the PR completely solve the source Issue, without unnecessary scope or
complexity?** Check for both missing requirements and unjustified additions.

Fix agent-fixable findings and review the updated PR again. If genuinely necessary
human input is missing, record the specific question and expected result, then use
the workflow's wait path until the answer arrives. Do not repeatedly request code
fixes for a decision that requires human input.

## 5. Merge and follow up

Approve and merge when the implementation is complete, mandatory pre-merge checks
are sufficient and pass, and no blocking review findings or necessary human
questions remain. Follow the workflow's merge authorization.

Record required post-merge checks separately as pending until performed, then
report actual results, failures, and follow-up work. Pre-merge validation does not
prove deployment or publication succeeded. No post-merge verification is required
for the collaboration templates and guidance introduced by Issue #1.
