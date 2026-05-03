# Step: closure.recheck (default)

Single closure step. Observe CI, mutate state, emit verdict.

## Inputs

- `prNumber` — GitHub PR number to recheck.

## Procedure

1. Run `gh pr checks ${prNumber} --json name,state,bucket` (read-only) and
   summarize the required-check states.
2. Decide verdict:
   - all required checks `bucket=pass` → `green`
   - any required check `bucket=fail` → `red`
   - any required check `bucket=pending` and you have observed this PR
     pending across multiple cycles beyond an acceptable budget → `timeout`
   - any required check `bucket=pending` otherwise → `still-running`
3. **Post one comment** to the PR (state mutation, R5):

   ```
   gh pr comment ${prNumber} --body "$(cat <<'EOF'
   ## CI Recheck (ci-recheck agent)
   - observed_at: <UTC ISO 8601>
   - verdict: <green|red|timeout|still-running>
   - summary: <one line>
   EOF
   )"
   ```

4. Emit closure structured output matching
   `ci-recheck.schema.json#closure.recheck`. `comment_body` MUST equal the
   body posted in step 3.

## Routing

- `green` → `merge-ready` (re-dispatch merger)
- `red` / `timeout` → `merge-blocked`
- `still-running` → orchestrator drops to `fallbackPhase=ci-pending`, which
  re-dispatches this agent next cycle (Retry Loop, 07_flow_design.md §3.2).
  Bounded by `rules.maxCycles` (and `rules.maxConsecutivePhases` once Step 3
  lands).

## Constraints

- Do NOT call `gh pr merge`, `gh issue close`, or label edits.
- Do NOT skip the comment post; the recovery hop's R5 invariant depends on
  it being emitted on every dispatch, including the `still-running` leg.
