---
c1: test
c2: echo
c3: input
title: Echo Stdin Input
description: Echo stdin content back to output for testing stdin forwarding functionality
usage: climpt-test echo input
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
  file: false
  stdin: true
  destination: false
---

# Echo Stdin Input

## Purpose

This is a test command that receives content via stdin and echoes it back unchanged.
Used to verify stdin forwarding functionality in climpt-agent.

## Input

Content is received via stdin.

## Received Input

{input_text}

## Output

Echo the received input above exactly as-is.
