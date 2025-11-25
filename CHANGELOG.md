# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.8.0] - 2025-11-26

### Changed
- **Breaking**: Changed `-i/--input` option to `-e/--edition` (Breakdown 1.6.0 compatibility)

## [1.6.1] - 2025-01-22

### Added
- Multiple registry support for MCP with config-based management
- New configuration file `.agent/climpt/mcp/config.json` for managing agent registries
- Optional `agent` parameter to search and describe tools for registry selection
- Registry caching system for improved performance
- Auto-creation of default MCP config on first startup
- Comprehensive test suite for multi-registry functionality

### Changed
- Enhanced MCP server initialization with dynamic registry loading
- Improved registry loading to support multiple agent configurations

## [1.6.0] - 2025-01-22

### Added
- C3L (Claude Code CLI) specification v0.5 documentation
- Enhanced MCP execute tool to follow C3L v0.5 specification

### Changed
- Improved execute tool documentation with clearer option format requirements
- Simplified execute tool options description for better usability

### Removed
- STDIN support from MCP execute tool (breaking change - follows C3L v0.5 specification)

## [1.5.1] - 2025-01-17

### Fixed
- Fixed registry.json template structure to match actual implementation

## [1.5.0] - 2025-01-17

### Added
- MCP (Model Context Protocol) server implementation for AI assistant integration
- Dynamic tool loading from `.agent/climpt/registry.json` configuration
- Registry configuration templates and documentation
- Comprehensive MCP documentation in README (EN/JA)
- Specialized prompts for registry generation and Claude Code usage

### Changed
- Enhanced module documentation for better JSR compliance
- Improved documentation structure with clear MCP section

## [1.4.1] - Previous Release

### Changed
- Various bug fixes and improvements

## [1.4.0] - Previous Release

### Changed
- Various feature additions and improvements