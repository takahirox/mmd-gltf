---
name: Issue
about: Report a problem or propose a change
title: ""
labels: ""
---

<!-- Write the title and body in English. See:
https://github.com/takahirox/mmd-gltf/blob/main/docs/development-flow.md
-->

## Problem

Describe the problem and who or what it affects.

## Expected outcome

Describe what should be true when the Issue is resolved.

## Context and reproduction

Add relevant context, examples, logs, or related Issues. For reproducible problems,
include steps, expected results, and actual results. State when reproduction does
not apply. For a defect found after merge, check for an equivalent Issue first;
use it or file a new Issue with the affected revision and links to the original
Issue/PR, following the lifecycle below.

## Pre-merge acceptance criteria

List concrete, mandatory criteria that can be achieved and verified before merge.
Default to criteria an AI agent can execute and verify. Require human confirmation,
physical-device testing, subjective evaluation, or external approval only when
necessary for this Issue; explain why and what result is expected.

- [ ] Replace with a verifiable completion criterion.

Checks possible only after merge must not be pre-merge approval conditions. Keep
all implementation requirements and applicable pre-merge checks here.

## Optional validation

List useful additional checks separately from mandatory completion criteria, or
state that none are needed.

## Required post-merge verification

Record genuinely necessary checks possible only after merge, or state that none
are required. Do not add post-merge work routinely. Report these checks as pending
until performed; pre-merge validation does not prove deployment or publication
succeeded. Close a fully implemented Issue after successful merge and pre-merge
acceptance; pending post-merge-only verification does not make it partial.
Follow the [merge and follow-up lifecycle](https://github.com/takahirox/mmd-gltf/blob/main/docs/development-flow.md#5-merge-and-follow-up)
for honest evidence recording and linked defect Issues without reopening the
original solely for follow-up.
