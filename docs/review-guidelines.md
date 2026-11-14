# Review and merge guidelines

Use these guidelines for human and AI review alongside the
[development flow](development-flow.md), including its English collaboration
convention.

## Review against the Issue

Read the source Issue, relevant discussion, the complete PR diff, and validation
results. Treat the Issue as the reference for scope and expected outcome. Ask:

**Does the PR completely solve the source Issue, without unnecessary scope or complexity?**

Check both directions:

- **No missing work:** verify every requirement and pre-merge acceptance criterion
  the PR claims to resolve is implemented and appropriately validated. Do not
  approve it as closing the Issue while implementation or mandatory pre-merge
  acceptance remains incomplete. An intentionally partial PR must identify
  remaining work and leave the Issue open. Pending post-merge-only verification
  does not make an otherwise complete implementation partial.
- **No unnecessary work:** reject unnecessary abstractions, speculative
  extensibility, unrelated refactoring, frameworks/subsystems, or extra policies
  and configuration without a demonstrated need tied to the Issue.

Prefer the smallest coherent design that fully satisfies the Issue. Added
complexity is not automatically beneficial. Preserve justified existing conventions;
do not use simplicity to excuse omitted requirements or necessary validation.

## Check quality and validation

Verify that the result matches the expected outcome, fits the repository, and
updates affected documentation. Review evidence for the changed files and actual
available tooling. Check that validation claims match checks actually performed,
including failures, skipped checks, and unperformed checks with reasons.

Use the configured checks in [README](../README.md) for converter, plugin and
example changes. For templates/documentation changes, check template metadata,
Markdown syntax, links, anchors, whitespace, and consistency. Do not require
unrelated runtime suites or introduce tooling solely to review documentation.
Follow the [validation guidance](development-flow.md#2-implement-and-validate).

Apply the [test and CI principles](browser-ci.md#test-and-ci-principles). For new
or expanded tests, review the additional defects detected, existing or duplicate
coverage, and execution/maintenance cost together. Ask:

> Does this change provide sufficient confidence with the lightest appropriate
> validation, without redundant execution?

Require mandatory pre-merge acceptance to be achievable and verifiable before
merge. Keep optional validation separate. Human confirmation, physical-device
testing, subjective evaluation, and external approval are mandatory only when
necessary for the actual Issue, with a reason and expected result.

Record genuinely necessary checks possible only after merge separately as pending;
they must not block pre-merge approval. For example, publication from a
merge-triggered deployment is verified after merge. Pre-merge validation does not
prove deployment/publication succeeded. This distinction does not waive required
implementation, mandatory pre-merge tests, required protections, or genuinely
necessary pre-merge human acceptance. Do not add post-merge work routinely;
documentation/template work needs no unrelated manual approval, physical-device
checks, heavyweight model downloads, or deployment gates. None is required for the
collaboration templates and guidance in Issues #1 and #93.

## Choose the review outcome

- **Agent-fixable findings:** request changes with the affected requirement or
  location, the concrete problem, and the expected correction. Review the updated
  PR and relevant validation again after revision.
- **Necessary human input:** identify the specific unanswered question, why a human
  answer is necessary, and the expected decision or evidence. Record the review
  state as waiting for human input and enter the workflow's wait path. Resume
  review when the answer arrives; do not repeatedly request code fixes or treat
  silence as confirmation. Keep this state distinct from agent-fixable findings.
- **Ready to merge:** approve when the implementation fully meets the Issue it
  claims to resolve, mandatory pre-merge checks are sufficient and pass, no
  unjustified scope or complexity remains, and no blocking findings or necessary
  human questions remain. Merge according to the workflow's authorization.

Pending required post-merge checks do not prevent approval when these conditions
hold. Preserve `Closes #N`; do not request its removal, keep the source Issue open,
or withhold approval solely for pending post-merge-only verification. ProjectWeave
publication adds that reference and its merge/close stages close the source Issue;
requesting the opposite creates repeated Review → Fix → Publish → Review loops.

After successful merge, close the original Issue and follow the
[merge and follow-up lifecycle](development-flow.md#5-merge-and-follow-up): perform
required checks, record accurate evidence in the merged PR, closed Issue, or linked
validation report, and use a new linked Issue for an actual defect after checking
for an existing equivalent Issue. Do not reopen the original solely for follow-up.
Keep unperformed or environment-blocked checks pending; closure does not mean they
passed, and an unavailable environment alone does not establish a product defect.
This lifecycle supersedes older keep-open instructions for implemented Issues
awaiting post-merge verification; preserve historical results and evidence.

## Browser CI changes (Issue #81)

Preserve the [four-runner coverage and publishing gates](browser-ci.md#four-runner-validation-and-publishing-gates-issue-81).
For CI changes, verify unfiltered test IDs occur exactly once across required
shards, all failures/missing artifacts block aggregation, and deployment needs
build plus every required validation job. New browser suites need an explicit
measured assignment in `tools/browser-shards.json`; cases in existing suites
inherit that assignment. Review comparable unchanged-commit timings, both elapsed
feedback and total runner-minutes, before claiming performance improvements.
Keep optional matrix diagnostics separate; record pending hosted/merged-main
verification honestly when remote actions are outside the authorized scope.
