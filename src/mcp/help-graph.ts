/**
 * @fileoverview Static help graph for the Help protocol
 * @module mcp/help-graph
 *
 * Defines the construction guide graph: root → capabilities → components.
 * Each node's edges constrain valid next queries (anti-hallucination).
 *
 * @see docs/internal/unified-help-concept.md
 */

import type { HelpConstraint, HelpNode, HelpProtocol } from "./help-types.ts";

/**
 * Agent construction constraints (Blueprint integrity rules).
 * Formalized with JSONPath field paths.
 */
const AGENT_CONSTRAINTS: HelpConstraint[] = [
  {
    rule: "R-A1",
    from: { file: "agent.json", field: "$.name" },
    to: { file: "steps_registry.json", field: "$.agentId" },
    operator: "equals",
  },
  {
    rule: "R-A2",
    from: { file: "agent.json", field: "$.parameters | keys" },
    to: {
      file: "steps_registry.json",
      field: "$.steps.*.uvVariables | flatten | unique",
    },
    operator: "subset_of",
    _note:
      "Every declared parameter must be consumed by at least one step. uvVariables may include runtime-injected values not in parameters.",
  },
  {
    rule: "R-A3",
    from: { file: "agent.json", field: "$.runner.verdict.type" },
    to: { file: "steps_registry.json", field: "$.entryStepMapping" },
    operator: "maps_to",
  },
  {
    rule: "R-B1",
    from: { file: "steps_registry.json", field: "$.steps.@key" },
    to: { file: "steps_registry.json", field: "$.steps.*.stepId" },
    operator: "equals",
  },
  {
    rule: "R-B5",
    from: {
      file: "steps_registry.json",
      field: "$.steps.*.transitions.*.target",
    },
    to: { file: "steps_registry.json", field: "$.steps" },
    operator: "maps_to",
    _note:
      "target: null is a valid terminal transition and is excluded from maps_to check",
  },
  {
    rule: "R-D1",
    from: {
      file: "steps_registry.json",
      field: "$.steps.*.outputSchemaRef.file",
    },
    to: { file: "{schemasBase}/{outputSchemaRef.file}", field: "(file)" },
    operator: "exists",
  },
  {
    rule: "R-D2",
    from: {
      file: "steps_registry.json",
      field: "$.steps.*.outputSchemaRef.schema",
    },
    to: { file: "{schemasBase}/{outputSchemaRef.file}", field: "$" },
    operator: "references",
  },
  {
    rule: "R-D3",
    from: {
      file: "steps_registry.json",
      field: "$.steps.*.structuredGate.allowedIntents",
    },
    to: {
      file: "{schemasBase}/{outputSchemaRef.file}",
      field:
        "$[{outputSchemaRef.schema}].properties.next_action.properties.action.enum",
    },
    operator: "equals",
  },
  {
    rule: "PATH-1",
    from: { file: "agent.json", field: "$.runner.flow.systemPromptPath" },
    to: { file: "prompts/system.md", field: "(file)" },
    operator: "exists",
  },
  {
    rule: "TEMPLATE-1",
    from: {
      file: "prompts/steps/{c2}/{c3}/f_{edition}_{adaptation}.md",
      field: "<uv-*>",
    },
    to: { file: "steps_registry.json", field: "$.steps.*.uvVariables" },
    operator: "contains",
    _note:
      "Per-step: c2, c3, edition, adaptation resolved from step definition. pathTemplate defines naming.",
  },
  {
    rule: "TEMPLATE-2",
    from: { file: "steps_registry.json", field: "$.steps.*.uvVariables" },
    to: {
      file: "prompts/steps/{c2}/{c3}/f_{edition}_{adaptation}.md",
      field: "<uv-*>",
    },
    operator: "contains",
    _note:
      "Per-step: each step's c2, c3, edition, adaptation resolve the prompt file path.",
  },
];

/** Root node returned by describe({}) */
export const ROOT_NODE: HelpNode = {
  id: "climpt",
  kind: "capability",
  description:
    "CLI + Prompt. Build prompts, agents, and orchestrators under .agent/ directory.",
  constructionTree: [
    ".agent/",
    "├── {domain}/                  — Prompt domain",
    "│   ├── prompts/{c2}/{c3}/     — Prompt files",
    "│   ├── config/{domain}-steps-app.yml",
    "│   ├── config/{domain}-steps-user.yml",
    "│   └── registry.json",
    "├── {agent-name}/              — Agent definition",
    "│   ├── agent.json",
    "│   ├── steps_registry.json",
    "│   ├── schemas/step_outputs.schema.json",
    "│   ├── prompts/system.md",
    "│   └── prompts/steps/{phase}/{c3}/f_*.md",
    "└── workflow.json              — Orchestrator definition",
  ].join("\n"),
  edges: [
    {
      rel: "composes",
      target: "prompt",
      label: "Prompt construction",
      when:
        "You want to define reusable prompts that transform input text into structured output",
    },
    {
      rel: "composes",
      target: "agent",
      label: "Agent construction",
      when:
        "You want to build an autonomous step-flow agent that processes GitHub Issues",
    },
    {
      rel: "composes",
      target: "orchestrator",
      label: "Orchestrator construction",
      when:
        "You want to coordinate multiple agents via a workflow state machine on GitHub Issues",
    },
  ],
  children: [
    {
      id: "prompt",
      kind: "capability",
      description:
        "Define prompts using C3L (Category-Classification-Criteria) addressing: c1/c2/c3.",
      build: {
        files: [
          ".agent/{name}/prompts/{c2}/{c3}/f_default.md",
          ".agent/{name}/config/{name}-steps-app.yml",
          ".agent/{name}/config/{name}-steps-user.yml",
        ],
        params: {
          name: "Domain name (c1 category)",
          c2: "Action verb",
          c3: "Target noun",
        },
      },
      edges: [
        {
          rel: "requires",
          target: "component:frontmatter",
          label: "C3L frontmatter defines c1/c2/c3/title + options",
          when: "You need to define the prompt's input/output specification",
        },
        {
          rel: "requires",
          target: "component:prompt-file",
          label: "Prompt file: f_{edition}_{adaptation}.md",
          when: "You need to write or edit the prompt body text",
        },
        {
          rel: "validates",
          target: "config:command-schema",
          label: "command.schema.json validates frontmatter",
          when: "You want to verify frontmatter correctness",
        },
      ],
      next: {
        action: "scaffold",
        target: "prompt",
        params: { name: "{name}" },
      },
    },
    {
      id: "agent",
      kind: "capability",
      description:
        "Build step-flow driven agents. Agents autonomously execute tasks against GitHub Issues using structured step transitions and output schemas.",
      build: {
        files: [
          ".agent/{name}/agent.json",
          ".agent/{name}/steps_registry.json",
          ".agent/{name}/schemas/step_outputs.schema.json",
          ".agent/{name}/prompts/system.md",
          ".agent/{name}/prompts/steps/{phase}/{c3}/f_default.md",
        ],
        params: { name: "Agent name (used as directory name under .agent/)" },
        context: {
          schemasBase: ".agent/{name}/schemas",
          promptsBase: ".agent/{name}/prompts",
          pathTemplate: "{c2}/{c3}/f_{edition}_{adaptation}.md",
        },
      },
      edges: [
        {
          rel: "requires",
          target: "component:agent-definition",
          label:
            "agent.json defines name, parameters, execution flow, verdict type",
          when:
            "You need to design or modify the agent's behavior and identity",
        },
        {
          rel: "requires",
          target: "component:step-registry",
          label:
            "steps_registry.json defines step transitions, structured output gates, schema references",
          when: "You need to design or modify the step-flow transition logic",
        },
        {
          rel: "requires",
          target: "component:step-schema",
          label:
            "step_outputs.schema.json defines JSON schema for each step's output",
          when: "You need to define or modify what each step produces",
        },
        {
          rel: "requires",
          target: "component:prompts",
          label: "prompts/ contains system.md + steps/{phase}/{c3}/f_*.md",
          when: "You need to write or edit the agent's instruction prompts",
        },
        {
          rel: "validates",
          target: "blueprint:agent",
          label: "Blueprint validates with 52 integrity rules",
          when: "After building or editing, verify cross-file consistency",
        },
      ],
      next: {
        action: "scaffold",
        target: "agent",
        params: { name: "{name}" },
      },
    },
    {
      id: "orchestrator",
      kind: "capability",
      description:
        "Coordinate multiple agents via workflow. Uses GitHub Issue labels as state machine.",
      build: {
        files: [".agent/workflow.json"],
        params: {
          phases: "State machine: actionable / terminal / blocking",
          labelMapping: "GitHub label → phase name",
          agents: "transformer (outputPhase) / validator (outputPhases)",
          rules: "maxCycles (default 5), cycleDelayMs (default 5000)",
        },
      },
      edges: [
        {
          rel: "composes",
          target: "agent",
          label: "Dispatches agents declared in workflow",
          when: "You need to build or verify the agents that participate",
        },
        {
          rel: "requires",
          target: "component:workflow-config",
          label: "workflow.json defines phases, labelMapping, agents, rules",
          when: "You need to design the workflow state machine",
        },
        {
          rel: "validates",
          target: "config:workflow-schema",
          label: "workflow-schema.json validates structure",
          when: "You want to verify the workflow definition",
        },
      ],
      next: {
        action: "describe",
        target: "component:workflow-config",
      },
    },
  ],
};

/**
 * Detail nodes returned by describe({id}).
 * Contains full constraints and build.context not present in the 2-tier root.
 */
export const DETAIL_NODES: Record<string, HelpNode> = {
  agent: {
    id: "agent",
    kind: "capability",
    description:
      "Build step-flow driven agents. Agents autonomously execute tasks against GitHub Issues using structured step transitions and output schemas.",
    build: {
      files: [
        ".agent/{name}/agent.json",
        ".agent/{name}/steps_registry.json",
        ".agent/{name}/schemas/step_outputs.schema.json",
        ".agent/{name}/prompts/system.md",
        ".agent/{name}/prompts/steps/{phase}/{c3}/f_default.md",
      ],
      params: { name: "Agent name (used as directory name under .agent/)" },
      context: {
        schemasBase: ".agent/{name}/schemas",
        promptsBase: ".agent/{name}/prompts",
        pathTemplate: "{c2}/{c3}/f_{edition}_{adaptation}.md",
      },
    },
    edges: [
      {
        rel: "requires",
        target: "component:agent-definition",
        label:
          "agent.json defines name, parameters, execution flow, verdict type",
        when: "You need to design or modify the agent's behavior and identity",
      },
      {
        rel: "requires",
        target: "component:step-registry",
        label:
          "steps_registry.json defines step transitions, structured output gates, schema references",
        when: "You need to design or modify the step-flow transition logic",
      },
      {
        rel: "requires",
        target: "component:step-schema",
        label:
          "step_outputs.schema.json defines JSON schema for each step's output",
        when: "You need to define or modify what each step produces",
      },
      {
        rel: "requires",
        target: "component:prompts",
        label: "prompts/ contains system.md + steps/{phase}/{c3}/f_*.md",
        when: "You need to write or edit the agent's instruction prompts",
      },
      {
        rel: "validates",
        target: "blueprint:agent",
        label: "Blueprint validates with 52 integrity rules",
        when: "After building or editing, verify cross-file consistency",
      },
    ],
    constraints: AGENT_CONSTRAINTS,
    next: {
      action: "scaffold",
      target: "agent",
      params: { name: "{name}" },
    },
  },
};

/** Protocol metadata for root describe() response */
export const HELP_PROTOCOL: HelpProtocol = {
  verbs: ["describe", "scaffold", "validate", "run"],
  order: "describe -> scaffold -> validate -> run (strictly sequential)",
  scope:
    "Help guides CONSTRUCTION only. It does not serve 'run existing' use cases.",
  operators: {
    equals: "from.field value === to.field value (exact string match)",
    contains: "from.field set ⊇ to.field set (superset)",
    subset_of: "from.field set ⊆ to.field set (subset)",
    maps_to: "from.field value exists as a key in to.field",
    references: "from.field value resolves to a definition in to.file",
    exists: "from.field value points to a file path that exists on disk",
    matches: "from.field value matches to.field pattern",
  },
  fieldPath: {
    "$.prop": "Root property access",
    "$.a.b": "Nested property",
    "$.obj.*": "All keys/values in object",
    "$.obj.@key":
      "Object key at each position (vs $.obj.* which yields values)",
    "$[{ref}]":
      "Dynamic key resolved from sibling field in same iteration context (e.g., same step object)",
    "(file)": "File existence check",
    "<pattern>":
      "Content pattern match in file body (e.g., <uv-*> for template variables)",
    "{field} in file path":
      "Resolved from sibling field value in same iteration context OR from build.context",
  },
  rules: [
    "You may only query targets listed in edges",
    "describe shows WHAT to build (files, params, constraints). scaffold shows HOW (command, created, next)",
    "build first, run later: run appears only after validate passes",
    "All construction artifacts are created under .agent/ directory",
    "Every response includes a next field indicating the recommended next action",
  ],
  nextActions: [
    "To explore a capability in detail: describe({ id: edges[n].target })",
    "To scaffold: scaffold(id, params) — returns command, created files, and next action",
    "After scaffolding and customizing: validate({ target: id, params: {...} })",
    "run is revealed only in validate's passed response",
  ],
};
