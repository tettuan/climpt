# Step Registry Fixtures

Fixtures for the Step ADT migration (design
`agents/docs/design/realistic/14-step-registry.md` §B).

- `new-shape/` — minimal valid `StepRegistry` JSON files in the **goal** on-disk
  shape: each step has an explicit `kind` discriminator and a
  `address: C3LAddress` aggregate (no flat `c2`/`c3`/`edition`/`adaptation`
  siblings, no `stepKind`). One file per `StepKind` variant (`work-only.json`,
  `verification-only.json`, `closure-only.json`). Used by validator/loader
  conformance tests as the canonical accepted shape.
- `legacy-shape/` — a single `StepRegistry` JSON file (`legacy-step.json`) in
  the **legacy** disk shape (`stepKind` + flat 5-tuple) that the previous
  disk-shape translator consumed. Used as a **reject** fixture: the validator
  must refuse this shape rather than translate it, ensuring the on-disk format
  is the in-memory ADT directly.
