# Deferred Decisions

Investigated but intentionally deferred. Each entry records the decision,
evidence, and conditions under which to revisit.

## Agent Runner: Signal Handler in run-agent.ts

**Status**: Deferred (2026-03-18) **Priority**: Low **Investigation**:
`tmp/signal-handler-assessment/`

### Context

Agent processes that complete their work are sometimes killed by a parent
process (Claude Code's process monitor) before the Runner framework records
completion. The parent sees exit code -1 (signal) and logs `[ERROR]`.

### Evidence (168 sessions, March 2026)

| Classification                              | Count | Signal handler helps? |
| ------------------------------------------- | ----: | :-------------------: |
| A: Work completed, Runner never recorded it |    11 |          Yes          |
| B: Killed mid-work                          |    22 |          No           |
| C: Killed during initialization             |     8 |          No           |

- Category A: All deliverables (commits, label transitions, Issue comments) were
  persisted. Only the Runner's "Agent completed" log was lost.
- The `[ERROR] ... 終了` log originates from Claude Code internals, not from
  climpt.

### Why deferred

1. **Low real impact** — Category A sessions completed their work; only the
   completion log is missing (6.5% of all sessions)
2. **Symptom, not cause** — The root issue is the parent process killing before
   the Runner's completion loop finishes. A signal handler is a workaround.
3. **Uncertain effectiveness** — If the parent sends SIGKILL (not SIGTERM), no
   handler can intercept it

### Better alternatives (when prioritized)

1. Speed up the Runner's completion loop (verdict → SDK result → log)
2. Parent process: SIGTERM → wait N seconds → SIGKILL sequence
3. Then add a SIGTERM handler as defense-in-depth

### Revisit when

- Category A incidents exceed 15% of sessions
- A downstream system depends on the Runner's completion log for correctness
  (not just observability)
