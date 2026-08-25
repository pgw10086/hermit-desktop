# Runtime Agent Contract

This document governs product AI Sessions. It does not grant Coding Agents
repository or external authority.

## Session Truth

The append-only durable Session ledger is the source of model-visible history.
Facts, instructions, Tool calls, and Tool results visible to the model must be
reconstructable from durable events. Event sequence is monotonic; turns/steps
are enclosed; logical Tool call/result pairs use callId.

## Tool Dispatch And Recovery

Before dispatch, Core durably records intent including callId, plugin principal,
capability, canonical arguments digest, side-effect class, idempotency support,
and Approval requirement.

Checkpoint failure prevents dispatch. After crash:

- not dispatched -> `TOOL_NOT_STARTED`;
- durable call with unknown outcome -> `TOOL_OUTCOME_UNKNOWN`;
- read-only/proven-idempotent work may retry;
- possible side effects require external reconciliation or a human decision.

callId is a correlation/idempotency key when supported; it is not an
exactly-once guarantee.

## Approval

Approval fails closed. Only one `allowed-once` decision releases the matching
Session/call/tool/argument digest/provider operation. Rejected, cancelled,
timed-out, missing, throwing, malformed, or unavailable answerers deny. Asked
and decided audit events are durable before execution.

## Capabilities, Secrets, And Logs

Runtime Agent and Product Plugin receive narrow capability handles from Core.
Filesystem, network, process, credential, model, and native authority are
separate dimensions.

Configuration and Session state contain credential references, not plaintext.
The Core-owned provider resolves a credential per operation and does not expose
it to Product Plugins.

Logs use structured logical identifiers and record decisions/outcomes without
Secret, browser state, unnecessary absolute user paths, or raw user content.

Provider identity is unique, atomically registered, lifecycle-owned, and fails
loudly on duplicates.
