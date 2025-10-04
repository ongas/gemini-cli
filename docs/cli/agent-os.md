# Agent-OS Integration

Agent-OS is a project management and workflow system that provides structured instructions, coding standards, and workflow automation for AI-powered development. Gemini CLI includes full Agent-OS support with automatic context injection and sub-agent capabilities.

## Overview

Agent-OS provides two key capabilities:

1. **Automatic Standards Injection**: Project-specific coding standards and best practices are automatically loaded and applied to every coding task without explicit references
2. **Structured Workflows**: Predefined workflows for planning, specification creation, task execution, and project management

## Quick Start

Initialize Agent-OS in your project:

```bash
gemini-aos --init-agent-os
```

This command creates:

- `.agent-os/` directory structure in your current project
- Agent definitions in `~/.gemini/agents/` (shared across projects)

### What Gets Created

**In your project directory (`.agent-os/`):**

```
.agent-os/
├── instructions/
│   ├── core/           # Core workflow instructions
│   └── meta/           # Pre/post-flight checks
└── standards/
    ├── code-style.md   # General coding standards
    ├── best-practices.md
    ├── tech-stack.md
    └── code-style/     # Language-specific standards
        ├── javascript-style.md
        ├── python-style.md
        └── ...
```

**In your home directory (`~/.gemini/agents/`):**

```
~/.gemini/agents/
├── context-fetcher.md    # Retrieves specific doc sections
├── file-creator.md       # Creates files/directories
├── test-runner.md        # Runs test suites
├── git-workflow.md       # Git operations
├── project-manager.md    # Updates roadmaps/tasks
└── date-checker.md       # Date utilities
```

## Automatic Standards Injection

The most powerful feature of Agent-OS integration is automatic standards injection. When you're working in a project with `.agent-os/standards/`, these standards are automatically applied to all coding tasks.

### How It Works

1. **Task Detection**: When you send a prompt, Gemini CLI automatically detects the task type:
   - `coding` - Creating/modifying code
   - `planning` - Design and architecture
   - `testing` - Writing or running tests
   - `git` - Git operations
   - `general` - Other tasks

2. **Language Detection**: Identifies programming languages mentioned in your prompt

3. **Standards Loading**: Automatically loads relevant standards from `.agent-os/standards/`:
   - General code style rules
   - Language-specific standards
   - Best practices
   - Tech stack guidelines

4. **Context Injection**: Injects the relevant standards into your prompt before sending to the model

### Example

**Your prompt:**

```
Write a JavaScript function to validate an email address
```

**What Gemini CLI does automatically:**

```
[Loads .agent-os/standards/code-style.md]
[Loads .agent-os/standards/code-style/javascript-style.md]
[Detects: coding task, JavaScript language]
[Injects standards into prompt]
```

**Console output:**

```
[Agent-OS] Starting context injection...
[Agent-OS] Detected task context: { taskType: 'coding', languages: [ 'javascript' ], needsStandards: true }
[Agent-OS] Found .agent-os directory: /path/to/project/.agent-os
[Agent-OS] Loaded standards: [ 'languageSpecific', 'codeStyle', 'bestPractices' ]
[Agent-OS] Injecting Agent-OS context (5065 characters) into prompt
```

**Result**: Generated code automatically follows your project's standards (e.g., single quotes, snake_case naming, etc.)

### Testing Standards Injection

To verify automatic standards injection is working:

1. **Check for console output** when running a coding task:

```bash
echo "Write a Python function to calculate factorial" | gemini-aos --prompt-interactive
```

Look for `[Agent-OS]` messages in the output.

2. **Verify code style** matches your standards:

- If `.agent-os/standards/code-style.md` says "use single quotes", generated code should use single quotes
- If it says "use snake_case for variables", variables should be snake_case

3. **Compare with/without Agent-OS**:

```bash
# Without Agent-OS (no standards)
cd /tmp
echo "Write code..." | gemini-aos --prompt-interactive

# With Agent-OS (standards applied)
cd /path/to/your/project
echo "Write code..." | gemini-aos --prompt-interactive
```

## Customizing Standards

Standards are defined in markdown files under `.agent-os/standards/`. You can edit these files to define your project's coding conventions.

### General Code Style

Edit `.agent-os/standards/code-style.md`:

```markdown
# Code Style Guide

## General Formatting

### Indentation

- Use 2 spaces for indentation (never tabs)

### Naming Conventions

- **Methods and Variables**: Use snake_case (e.g., `user_profile`)
- **Classes**: Use PascalCase (e.g., `UserProfile`)
- **Constants**: Use UPPER_SNAKE_CASE (e.g., `MAX_RETRY_COUNT`)

### String Formatting

- Use single quotes for strings: 'Hello World'
- Use double quotes only when interpolation is needed
```

### Language-Specific Standards

Create or edit `.agent-os/standards/code-style/javascript-style.md`:

```markdown
# JavaScript Style Guide

## Function Documentation

- ALL functions MUST have JSDoc comments with @param and @returns
- Include a brief description of what the function does

## Function Style

- Always use arrow functions for single-expression functions
- Use async/await instead of raw promises
```

Changes take effect immediately - no rebuild or restart needed!

## Agent-OS Workflows

Agent-OS includes structured workflows for common development tasks. These workflows use sub-agents to perform specific operations.

### Available Workflows

Located in `.agent-os/instructions/core/`:

- `plan-product.md` - Initial product planning and setup
- `create-spec.md` - Create detailed specifications
- `create-tasks.md` - Break specs into actionable tasks
- `execute-task.md` - Execute individual tasks with TDD
- `execute-tasks.md` - Execute all tasks in a spec
- `post-execution-tasks.md` - Post-completion cleanup and verification

### Using Workflows

Reference workflows using the `@` syntax:

```bash
# Start product planning
echo "@.agent-os/instructions/core/plan-product.md" | gemini-aos --prompt-interactive

# Create a specification
echo "@.agent-os/instructions/core/create-spec.md" | gemini-aos --prompt-interactive
```

### Sub-Agents

Workflows use specialized sub-agents defined in `~/.gemini/agents/`. When a workflow specifies a sub-agent, Gemini CLI automatically uses those instructions.

Example from `execute-task.md`:

```markdown
<step number="3" subagent="context-fetcher" name="best_practices_review">
Use the context-fetcher subagent to retrieve relevant sections from
@.agent-os/standards/best-practices.md
</step>
```

## Creating Custom Agents

You can create custom agents for your specific needs.

### Step 1: Create Agent Definition

Create a new file in the source repository:

```bash
nano /mnt/e/source/repos/gemini-cli/agents/my-custom-agent.md
```

### Step 2: Define Agent Behavior

```markdown
# My Custom Agent

A specialized agent for [specific purpose].

## Core Responsibilities

1. **Primary Task**: What this agent does
2. **Context Awareness**: How it uses context
3. **Output Format**: What it returns

## Workflow

1. Validate input
2. Perform specialized operation
3. Return structured result

## Output Format

For success:
```

✓ [Agent Name]: [success message]
[Details]

```

For errors:
```

✗ [Agent Name]: [error message]
[Details]

```

## Examples

Example usage:
- "Use my-custom-agent to do X"
- "Run my-custom-agent on Y"
```

### Step 3: Rebuild Bundle

```bash
cd /mnt/e/source/repos/gemini-cli
npm run bundle
```

This copies your agent definition to `bundle/agents/`.

### Step 4: Deploy to Users

When users run `gemini-aos --init-agent-os`, the new agent is automatically copied to their `~/.gemini/agents/` directory.

### Step 5: Use in Workflows

Reference your agent in workflow instructions:

```markdown
<step number="1" subagent="my-custom-agent" name="do_something">

### Step 1: Custom Operation

Use the my-custom-agent subagent to perform specialized operation.

<instructions>
  ACTION: Use my-custom-agent subagent
  REQUEST: "Perform operation with [parameters]"
  WAIT: For completion
  PROCESS: Returned results
</instructions>

</step>
```

## Updating Agent-OS

### Updating Templates for New Projects

To update the Agent-OS templates that new projects receive:

1. **Edit template files**:

```bash
# Edit standards templates
nano /mnt/e/source/repos/gemini-cli/.agent-os-template/standards/code-style.md

# Edit workflow instructions
nano /mnt/e/source/repos/gemini-cli/.agent-os-template/instructions/core/plan-product.md
```

2. **Edit agent definitions**:

```bash
nano /mnt/e/source/repos/gemini-cli/agents/context-fetcher.md
```

3. **Rebuild bundle**:

```bash
cd /mnt/e/source/repos/gemini-cli
npm run bundle
```

This copies files from source to bundle:

```
Source → Bundle
├── .agent-os-template/ → bundle/.agent-os-template/
└── agents/ → bundle/agents/
```

4. **New projects get updates automatically**:

```bash
# Users running this get the new templates
gemini-aos --init-agent-os
```

### Update Flow

```
Developer updates templates
  ↓
npm run bundle (runs copy_bundle_assets.js)
  ↓
Files copied to bundle/
  ↓
npm publish (for official releases)
  ↓
Users run --init-agent-os
  ↓
New projects get updated templates
```

### Important Notes

- **Existing projects are NOT auto-updated** - they keep their `.agent-os/` directory as-is
- **Agents in `~/.gemini/agents/` ARE updated** when running `--init-agent-os` again
- **Automatic standards injection works immediately** - no restart needed after editing standards files

## Troubleshooting

### Standards Not Being Applied

**Check console output:**

```bash
echo "Write a function..." | gemini-aos --prompt-interactive
```

Look for `[Agent-OS]` messages. If you don't see them:

1. Verify `.agent-os/` directory exists in current directory or parent
2. Check standards files exist in `.agent-os/standards/`
3. Ensure your prompt triggers task detection (use words like "write", "create", "implement")

### Agent Not Found

If a workflow references an agent that doesn't exist:

1. Check `~/.gemini/agents/` for the agent file
2. Run `gemini-aos --init-agent-os` to install agents
3. Verify the agent name in the workflow matches the filename (without `.md`)

### Template Not Found

If `--init-agent-os` fails with "Template not found":

1. Verify bundle directory contains `.agent-os-template/` and `agents/`
2. Rebuild with `npm run bundle`
3. Check `scripts/copy_bundle_assets.js` ran successfully

## Best Practices

### For Project Standards

1. **Keep standards concise** - Focus on key conventions that matter
2. **Be specific** - "Use single quotes" not "Use consistent quotes"
3. **Update as you go** - Add standards when you notice patterns
4. **Test changes** - Verify standards are applied with a quick test prompt

### For Custom Agents

1. **Single responsibility** - Each agent should do one thing well
2. **Clear output format** - Use consistent formatting for success/error states
3. **Context awareness** - Check if information is already in context before fetching
4. **Document examples** - Include clear usage examples in the agent definition

### For Workflows

1. **Use sub-agents** - Delegate specialized tasks to agents
2. **Minimal context** - Load only what's needed for each step
3. **Error handling** - Document blocking conditions and failure paths
4. **Verify completion** - Always verify tasks completed successfully

## See Also

- [GEMINI.md Context Files](./gemini-md.md) - Project-specific instructions
- [Custom Commands](./custom-commands.md) - Create custom CLI commands
- [MCP Servers](../mcp/index.md) - Extend with Model Context Protocol
