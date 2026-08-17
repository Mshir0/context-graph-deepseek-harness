---
name: context-firewall
description: Validate, enforce, and audit the Context Graph boundary around a DeepSeek Harness model request. Use when checking whether compiled context is within budget, applying Force Include or Force Exclude overrides, diagnosing a blocked context injection, or proving that unselected conversation and workspace data did not enter the final request.
---

# Context Firewall

Treat a compiler preview and a final request audit as different evidence. A valid preview proves selection; only the post-step firewall audit proves placement at the Harness request boundary.

## Workflow

1. Read the graph and identify the current Task or Functional entry.
2. Call `context_compile` with the entry, task, and token budget.
3. Inspect `manifest.included`, `manifest.excluded`, `manifest.validation`, and the Raw/Candidate/Selected/Excluded token totals. Final remains pending until `llm/stream` assembles the real request.
4. Resolve validation failures before proceeding:
   - Reduce Soft or Optional context when over budget.
   - Never remove the current Task, active hard requirements, hard constraints, or required interfaces merely to fit the budget.
   - Remove duplicate, superseded, stale, raw-conversation, or whole-workspace entries.
   - Honor Force Exclude. If it conflicts with required context, report the conflict and ask for an explicit decision.
5. Apply session-only overrides with `context_select` or `context_session_config`, then compile again.
6. After the model step, call `context_audit`. Confirm an allowed decision, valid validation result, `Selected <= tokenBudget`, `finalEstimatedTotalTokens <= requestTokenBudget`, a reported full-payload fingerprint, and a successful Surface placement action.

## Audit Rules

- Require `validation.valid = true` before treating compiled context as sendable.
- Treat `tokenBudget` as the hard limit for selected Context Graph entries. Treat `requestTokenBudget` as the final input estimate plus output reserve limit; the final estimate includes the static system prompt, exact current request messages, and tool schemas.
- Treat any included Force Exclude node, unauthorized Raw Conversation, duplicate entry, invalid token estimate, or budget overflow as blocking.
- Prefer structured Requirement, Constraint, Decision, Interface, and Task nodes over their raw source messages.
- Report why every included and excluded item was selected, including `policyClass`, `score`, `source`, `reason`, and `tokens`.
- Do not claim that history was removed merely because a plugin context message exists.
- In enforce mode, treat an unavailable or unknown Session Surface replacement as blocked. Do not silently fall back to appending context to existing history.
- Distinguish an empty-history `prepend` from a non-empty-history `surface-replace`; both must be visible in the audit.

## Expected Evidence

Return a concise audit containing:

```text
Status / validation
Target and budget
Raw / Candidate / Selected / Excluded / Final tokens
Final estimated total / request budget / output reserve
Final payload fingerprint
Surface action
Included and excluded node ids with reasons
Errors or warnings that require user action
```

If `context_audit` is unavailable, stale, blocked, or does not expose the final Surface action, state that the hard firewall has not been proven for that request.
