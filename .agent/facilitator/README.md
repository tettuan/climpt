# Facilitator Agent

An autonomous facilitator agent focused on project health monitoring and smooth
progress facilitation.

## Overview

The facilitator agent is designed around the concept of "場の制御" (field
management) - creating conditions for productive work rather than directing the
work itself. It observes, identifies issues, and provides recommendations
without taking over the execution.

## Key Concepts

### Field Management (場の制御)

- Focus on environment and conditions
- Enable autonomous work by others
- Remove obstacles silently
- Support rather than direct

### Status Awareness

- Continuous project health monitoring
- Proactive issue identification
- Data-driven insights

### Smooth Progress Facilitation

- Identify blockers early
- Flag stale items
- Suggest priorities based on analysis
- Connect related work items

## Usage

```bash
# Basic project facilitation
deno task agents:run facilitator --project 5

# With label filter
deno task agents:run facilitator --project 5 --label "sprint-1"

# With owner specification
deno task agents:run facilitator --project 5 --project-owner "username"
```

## Actions

The facilitator outputs structured action blocks:

### facilitate-action

- `status` - Report project status
- `attention` - Flag issue needing attention
- `blocker` - Report identified blocker
- `suggest` - Suggest prioritization
- `stale` - Mark item as stale

### status-report

- `check` - Status check result
- `daily` - Daily status report
- `cycle-complete` - End of facilitation cycle

## Configuration

See `agent.json` for full configuration options including:

- `checkInterval` - How often to check status (minutes)
- `iterateMax` - Maximum facilitation iterations
- Label configurations for automated tagging

## Prompt Structure

```
prompts/
├── system.md                           # Agent system prompt
└── steps/
    ├── initial/
    │   ├── statuscheck/f_default.md   # Initial status check
    │   ├── blockercheck/f_default.md  # Blocker analysis
    │   ├── stalecheck/f_default.md    # Stale item detection
    │   ├── report/f_default.md        # Report generation
    │   └── facilitate/f_default.md    # Facilitation action
    └── continuation/
        ├── statuscheck/f_default.md   # Ongoing monitoring
        └── complete/f_default.md      # Cycle completion
```
