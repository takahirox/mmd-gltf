<!-- Write the title and body in English. See:
https://github.com/takahirox/mmd-gltf/blob/main/docs/development-flow.md
-->

## Summary

Explain the source Issue's problem and the focused changes made to solve it.

## Outcome

Describe the resulting behavior, including before/after examples when useful.
State any intentionally unresolved requirements; claim to close an Issue only
when the implementation fully addresses it.

## Validation

Describe checks actually performed and their results, mapped to the Issue's
pre-merge acceptance criteria. Accurately report failures, skipped checks, and
unperformed checks, with reasons. Separate optional validation from required checks.
Choose checks for the changed files and available repository tooling.

Use the configured checks in [README](../README.md) and the
[test and CI principles](../docs/browser-ci.md#test-and-ci-principles). For
templates/documentation changes, check Markdown/template syntax, links, anchors,
whitespace, and consistency; unrelated runtime tests or new tooling are not required.

## Required post-merge verification

List genuinely required checks possible only after merge and mark them pending
until performed, or state "None required." Do not treat these as pre-merge approval
conditions or infer deployment/publication success from pre-merge checks.

## Related Issues

Link the source Issue and other relevant Issues. Use `Closes #<number>` only when
the implementation fully resolves that Issue; describe partial scope explicitly.
