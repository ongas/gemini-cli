# Technology Stack

This project is a Node.js CLI tool for interacting with Google's Gemini API.

## Core Technologies

- **Runtime**: Node.js 18+ LTS
- **Language**: TypeScript 5+
- **Package Manager**: npm
- **Build Tool**: TypeScript Compiler (tsc)

## Key Dependencies

- **CLI Framework**: Ink (React for CLI)
- **API Client**: @google/generative-ai
- **Configuration**: Custom YAML-based config
- **File Operations**: Node.js native `fs` and `path` modules

## Architecture

- **Monorepo Structure**: Packages organized in `packages/`
  - `packages/cli`: Main CLI application
  - `packages/core`: Core functionality and utilities
- **Agent System**: Markdown-based agent definitions in `.gemini/agents/`
- **Project Standards**: Auto-injection from `.project-standards/`
