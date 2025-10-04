# Gemini-AOS Quick Start Guide

## What is Gemini-AOS?

Gemini-AOS is a fork of Google's Gemini CLI that integrates Agent-OS - a structured workflow system for AI-assisted software development. It adds approval prompts for sensitive operations and includes specialized subagents.

## Installation

```bash
# Clone and build
git clone https://github.com/ongas/gemini-cli.git
cd gemini-cli
npm install
npm run bundle

# Add to PATH (add to ~/.bashrc or ~/.zshrc)
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
mkdir -p ~/bin
echo '#!/bin/bash' > ~/bin/gemini-aos
echo 'NODE_NO_WARNINGS=1 node /path/to/gemini-cli/bundle/gemini.js "$@"' >> ~/bin/gemini-aos
chmod +x ~/bin/gemini-aos
```

## Setup Agent-OS in a Project

```bash
cd your-project
gemini-aos --init-agent-os
```

This creates:

- `.agent-os/` - Project workflow instructions
- `~/.gemini/agents/` - Gemini-specific subagents

## Usage

### Basic Chat

```bash
gemini-aos
```

### Use Agent-OS Instructions

```bash
gemini-aos --prompt "@.agent-os/instructions/core/plan-product.md Create a login feature"
```

### Available Agent-OS Instructions

**Core Workflows:**

- `plan-product.md` - Plan features and architecture
- `analyze-product.md` - Analyze existing codebase
- `create-spec.md` - Generate detailed specifications
- `create-tasks.md` - Break specs into tasks
- `execute-tasks.md` - Execute task lists
- `post-execution-tasks.md` - Cleanup and verification

**Meta Checks:**

- `pre-flight.md` - Pre-work validation
- `post-flight.md` - Post-work verification

### Available Subagents

Reference in prompts with `@~/.gemini/agents/[agent-name].md`:

- `context-fetcher.md` - Gather project context
- `date-checker.md` - Validate dates and versions
- `file-creator.md` - Create files and directories
- `git-workflow.md` - Handle git operations
- `project-manager.md` - Track task completion
- `test-runner.md` - Run and analyze tests

## Key Features

### 1. Approval Prompts

Gemini-AOS asks for approval before executing sensitive operations like file changes or shell commands.

### 2. Workflow-Driven Development

Use structured instructions to guide complex development tasks:

```bash
# Plan a feature
gemini-aos --prompt "@.agent-os/instructions/core/plan-product.md Add user authentication"

# Create specification
gemini-aos --prompt "@.agent-os/instructions/core/create-spec.md auth-system"

# Execute tasks
gemini-aos --prompt "@.agent-os/instructions/core/execute-tasks.md"
```

### 3. Specialized Subagents

Delegate specific tasks to specialized agents:

```bash
gemini-aos --prompt "Use @~/.gemini/agents/test-runner.md to run all tests"
```

## Configuration

Gemini-AOS uses the same configuration as Gemini CLI:

```bash
~/.gemini/settings.json
```

## Differences from Gemini CLI

| Feature              | Gemini CLI | Gemini-AOS        |
| -------------------- | ---------- | ----------------- |
| Version              | v0.7.0     | v0.7.1            |
| Approval Prompts     | No         | Yes               |
| Agent-OS Integration | No         | Yes               |
| Subagents            | No         | 6 included        |
| Init Command         | No         | `--init-agent-os` |

## Example Workflow

```bash
# 1. Initialize Agent-OS
gemini-aos --init-agent-os

# 2. Plan feature
gemini-aos --prompt "@.agent-os/instructions/core/plan-product.md Add dark mode"

# 3. Create spec
gemini-aos --prompt "@.agent-os/instructions/core/create-spec.md dark-mode"

# 4. Execute implementation
gemini-aos --prompt "@.agent-os/instructions/core/execute-tasks.md"

# 5. Run tests
gemini-aos --prompt "Use @~/.gemini/agents/test-runner.md to verify changes"

# 6. Git workflow
gemini-aos --prompt "Use @~/.gemini/agents/git-workflow.md to commit and create PR"
```

## Troubleshooting

**Q: Command not found?**
A: Ensure `~/bin` is in your PATH and gemini-aos script points to correct bundle location

**Q: Approval prompts not showing?**
A: Check that message bus integration is enabled in settings

**Q: Agent-OS instructions not found?**
A: Run `gemini-aos --init-agent-os` in your project directory

**Q: Punycode deprecation warning?**
A: Suppress with `NODE_NO_WARNINGS=1` (already in wrapper script)

## Repository

https://github.com/ongas/gemini-cli
