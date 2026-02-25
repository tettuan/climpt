# 26a: Run Facilitator Agent (no --issue)

**What:** Runs the facilitator agent without `--issue` to verify agents with
`parameters.issue.required: false` work without it. **Why:** Demonstrates that
`--issue` is only required when `parameters.issue.required` is `true`.

## Verifies

- `facilitate-agent` deno task exists
- Facilitator agent starts without `--issue` and without crash
- Output contains agent-related content
