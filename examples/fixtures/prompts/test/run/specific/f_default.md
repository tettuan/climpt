---
c1: test
c2: run
c3: specific
title: Run Specific Test
description: Run a specific test file identified by the target variable
usage: climpt-test run specific --uv-target=<path>
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default"]
  file: false
  stdin: true
  destination: false
uv:
  - target: Target test file path to execute
---

# Run Specific Test

Execute the test file specified by the target parameter.

## Target

{uv-target}

## Input

{input_text}
