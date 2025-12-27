# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.9.3] - 2025-12-27

### Added
- Iterate Agent: iteration result handoff between sessions with `--resume` option
- Climpt Agent: LLM-based option resolution with intent parameter support

## [1.8.1] - 2025-12-07

### Changed
- Refactored registry generation to use `@aidevtool/frontmatter-to-schema` package
- Standardized all prompt descriptions to English

### Added
- `climpt-meta build frontmatter` command for generating C3L v0.5 compliant frontmatter
- `climpt-meta create instruction` command for creating new instruction files
- Registry generation script (`scripts/generate-registry.ts`)
- Frontmatter-to-schema configuration files

### Removed
- `climpt-code` domain (moved to separate project)

## [1.8.0] - 2025-11-26

### Changed
- **Breaking**: Changed `-i/--input` option to `-e/--edition` (Breakdown 1.6.0 compatibility)
