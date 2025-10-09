# Custom Agent Definitions

Gemini CLI supports defining custom agents that the main orchestrator can autonomously invoke for specialized tasks. This enables powerful delegation patterns where complex, multi-step work can be handed off to focused sub-agents.

## Overview

Agents are specialized AI assistants with:

- **Specific expertise**: Focused on particular tasks (testing, code review, research, etc.)
- **Defined scope**: Limited tool access and clear boundaries
- **Structured output**: Returns results in predictable formats
- **Autonomous operation**: Works independently without main agent intervention

When enabled, agents are registered as tools that the main orchestrator can call based on their descriptions.

## Enabling Agents

Add to `.gemini/config.yaml`:

```yaml
enableSubagents: true
```

Or set via environment:

```bash
export GEMINI_ENABLE_SUBAGENTS=true
```

## Two Ways to Define Agents

### 1. Markdown-Based Agents (Recommended for Most Use Cases)

Create markdown files in your project's `.gemini/agents/` directory. These are automatically discovered and registered at startup.

**Location**: `.gemini/agents/your-agent-name.md`

#### Markdown Format

```markdown
# Agent Display Name

A concise description that tells the orchestrator WHEN to invoke this agent.
This description is critical - it appears in the tool list and determines when
the main agent will delegate work to this agent.

## Core Responsibilities

1. **Primary Task**: What this agent specializes in
2. **Scope**: What it should and shouldn't do
3. **Output**: What format it returns results in

## Additional sections...

You can include any additional instructions, examples, constraints, or
guidance here. The entire markdown content becomes the agent's system prompt.
```

#### Key Requirements

1. **First heading (`#`)**: Becomes the agent's display name
2. **First paragraph**: Used as the agent description (shown to orchestrator)
3. **Entire file**: Becomes the system prompt
4. **Filename**: Converted to agent name (e.g., `code-reviewer.md` → `code_reviewer`)
5. **Tools (Optional)**: Specify allowed tools using `**Tools:** tool1, tool2, tool3`

#### Restricting Agent Tools

By default, markdown agents get access to all standard tools. To restrict an agent to specific tools (for security or focus), add a **Tools:** line after the description:

```markdown
# Read-Only Analyzer

Analyzes code without making changes.

**Tools:** read_file, glob, search_file_content, list_directory

## Instructions
...
```

**Available tools:**
- `read_file` - Read file contents
- `write_file` - Write/create files
- `list_directory` - List directory contents (ls)
- `glob` - Find files by pattern
- `search_file_content` - Search within files (grep)
- `run_shell_command` - Execute bash commands
- `web_fetch` - Fetch web pages
- `google_web_search` - Search the web
- `task` - Delegate to sub-agents
- `memory` - Store/retrieve memory
- `replace` - Find/replace in files
- `read_many_files` - Read multiple files at once
- `write_todos_list` - Manage todo lists

Omit the **Tools:** line to give the agent access to all tools.

#### Example: Code Review Agent

`.gemini/agents/code-reviewer.md`:

```markdown
# Code Review Agent

Reviews code changes for bugs, security issues, and adherence to best practices.
Use this agent when code needs review before committing or when investigating
potential issues in existing code.

## Core Responsibilities

1. **Identify Issues**: Find bugs, security vulnerabilities, and anti-patterns
2. **Check Standards**: Verify adherence to project coding standards
3. **Suggest Improvements**: Provide actionable feedback
4. **Prioritize Findings**: Categorize issues by severity

## Review Process

1. Read the specified files or changes
2. Analyze code for:
   - Syntax and logical errors
   - Security vulnerabilities (SQL injection, XSS, etc.)
   - Performance issues
   - Code style violations
   - Missing error handling
3. Check against project standards from `.project-standards/`
4. Return structured findings

## Output Format

### Critical Issues (Must Fix)

- [Issue description]
- **Location**: `file.js:line`
- **Fix**: [Specific suggestion]

### Warnings (Should Address)

- [Issue description]
- **Location**: `file.js:line`
- **Suggestion**: [Recommended approach]

### Improvements (Nice to Have)

- [Suggestion for better approach]

## Constraints

- Never modify files directly
- Focus on actionable feedback
- Provide specific line numbers
- Suggest concrete fixes, not vague advice
```

#### Example: Research Agent

`.gemini/agents/codebase-researcher.md`:

````markdown
# Codebase Research Agent

Performs deep investigation of codebases to find relevant files, understand
architecture, and locate specific implementations. Use when you need to
understand how something works across multiple files or find where specific
functionality is implemented.

## Core Responsibilities

1. **Multi-File Search**: Find related code across entire codebase
2. **Architecture Mapping**: Understand how components interact
3. **Symbol Tracing**: Track definitions, usages, and dependencies
4. **Context Building**: Gather all relevant context for a task

## Investigation Process

1. Start with high-level search (glob patterns, file structure)
2. Use grep to find relevant symbols and keywords
3. Read key files to understand implementation
4. Trace dependencies and relationships
5. Build mental model of relevant subsystem
6. Return comprehensive report

## Output Format

```json
{
  "summary": "Brief overview of findings",
  "relevant_files": [
    {
      "path": "src/auth/login.ts",
      "purpose": "Handles user authentication",
      "key_symbols": ["login()", "validateCredentials()"],
      "dependencies": ["src/db/users.ts", "src/utils/hash.ts"]
    }
  ],
  "architecture_notes": "How the components fit together",
  "recommendations": "Suggestions based on findings"
}
```
````

## Constraints

- Read-only operations
- Maximum 15 tool calls to stay efficient
- Prioritize breadth over depth initially
- Focus on answering the specific question

````

### 2. TypeScript-Based Agents (Advanced)

For more control over agent behavior, define agents programmatically in TypeScript.

**Location**: `packages/core/src/agents/your-agent.ts`

#### TypeScript Format

```typescript
import type { AgentDefinition } from './types.js';
import { z } from 'zod';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';

// Define output schema for structured results
const MyAgentOutputSchema = z.object({
  result: z.string(),
  confidence: z.number(),
  findings: z.array(z.string()),
});

export const MyCustomAgent: AgentDefinition<typeof MyAgentOutputSchema> = {
  // Agent identifier (use snake_case)
  name: 'my_custom_agent',

  // Display name shown in tool list
  displayName: 'My Custom Agent',

  // Description shown to orchestrator - determines when agent is invoked
  description: `Specialized agent for [specific task]. Use when you need to
    [describe the use case clearly so orchestrator knows when to delegate].`,

  // Input parameters the agent accepts
  inputConfig: {
    inputs: {
      task: {
        description: 'The specific task or question to address',
        type: 'string',
        required: true,
      },
      context: {
        description: 'Additional context or constraints',
        type: 'string',
        required: false,
      },
    },
  },

  // Output configuration
  outputConfig: {
    outputName: 'report',
    description: 'Structured investigation results',
    schema: MyAgentOutputSchema,
  },

  // Optional: Transform output for display
  processOutput: (output) => {
    return `## Results (${output.confidence}% confidence)\n\n` +
           `${output.result}\n\n` +
           `### Findings:\n${output.findings.map(f => `- ${f}`).join('\n')}`;
  },

  // Model configuration
  modelConfig: {
    model: DEFAULT_GEMINI_MODEL,
    temp: 0.2,        // Lower for focused tasks
    top_p: 0.95,
    thinkingBudget: -1,
  },

  // Execution constraints
  runConfig: {
    max_time_minutes: 5,
    max_turns: 10,
  },

  // Tool access (optional - defaults to all tools)
  toolConfig: {
    tools: ['read_file', 'grep', 'glob', 'ls'],
  },

  // Prompt configuration
  promptConfig: {
    // System prompt defines agent behavior
    systemPrompt: `You are a specialized agent focused on [task].

Your responsibilities:
- [Responsibility 1]
- [Responsibility 2]

Constraints:
- [Constraint 1]
- [Constraint 2]

Always provide structured, actionable results.`,

    // Query template using input parameters
    query: `Task: \${task}

\${context ? 'Context: ' + context : ''}

Investigate thoroughly and provide a comprehensive report.`,
  },
};
````

#### Register TypeScript Agent

In `packages/core/src/agents/registry.ts`:

```typescript
import { MyCustomAgent } from './my-agent.js';

private loadBuiltInAgents(): void {
  this.registerAgent(CodebaseInvestigatorAgent);
  this.registerAgent(MyCustomAgent);  // Add your agent here
}
```

## How It Works

### Discovery and Registration

1. **Startup**: When Gemini CLI initializes with `enableSubagents: true`
2. **Discovery**: `AgentRegistry` scans:
   - Built-in agents (TypeScript definitions)
   - `.gemini/agents/*.md` (markdown files in project directory)
3. **Conversion**: Markdown files are parsed into `AgentDefinition` objects
4. **Wrapping**: Each agent is wrapped as a tool via `SubagentToolWrapper`
5. **Registration**: Tools are added to the `ToolRegistry`
6. **Availability**: Main orchestrator sees agents as callable tools

### Invocation Flow

```
User: "Review the authentication code for security issues"
  ↓
Main Agent: Sees 'code_reviewer' tool in available tools
  ↓
Main Agent: Decides to invoke based on description
  ↓
Tool Call: code_reviewer(task="Review auth code for security")
  ↓
SubagentToolWrapper: Creates isolated sub-agent instance
  ↓
Sub-Agent: Runs independently with limited tools
  ↓
Sub-Agent: Returns structured results
  ↓
Main Agent: Receives results and continues
```

## Built-In Agents

### Codebase Investigator

Pre-installed TypeScript agent for multi-file codebase exploration.

**Name**: `codebase_investigator`
**Tools**: `ls`, `read_file`, `glob`, `grep` (read-only)
**Use Case**: Finding features, understanding architecture, tracing implementations

**Example invocation**:

```
Use codebase_investigator to find where user authentication is implemented
and identify all files involved in the login flow.
```

## Agent Templates

Use existing agents as templates:

### Available Templates (in your fork)

1. **`.gemini/agents/test-runner.md`**: Runs tests and analyzes failures
2. **`.gemini/agents/git-workflow.md`**: Git operations and workflows
3. **`.gemini/agents/context-fetcher.md`**: Retrieves specific document sections
4. **`.gemini/agents/file-creator.md`**: Creates files following templates
5. **`.gemini/agents/project-manager.md`**: Updates roadmaps and task lists
6. **`.gemini/agents/date-checker.md`**: Date validation utilities

Copy and customize these for your needs.

## Best Practices

### Writing Good Descriptions

The agent description is **critical** - it determines when the orchestrator will invoke your agent.

**Good description**:

```markdown
Reviews code for security vulnerabilities, bugs, and style violations.
Use when code needs review before committing, when investigating issues,
or when validating changes against project standards.
```

**Bad description**:

```markdown
A code review agent.
```

**Why**: The good description clearly states:

- What it does (reviews code)
- What it looks for (security, bugs, style)
- When to use it (before commit, investigating issues, validating)

### Scoping Agent Responsibilities

**Do**:

- Focus on a specific domain (testing, review, research)
- Define clear input/output contracts
- Limit tool access to what's needed
- Set reasonable time/turn limits

**Don't**:

- Create agents that do everything
- Give write access unless absolutely necessary
- Allow unlimited turns (can get stuck)
- Overlap functionality with other agents

### Agent vs Task Tool

**Use Agent** when:

- Task requires specialized expertise
- Work is repetitive and reusable
- You want orchestrator to delegate autonomously
- Structured output format is needed

**Use Task Tool** when:

- One-off delegation
- No reusable pattern
- Ad-hoc problem solving
- No need for structured output

## Debugging Agents

### Enable Debug Mode

```bash
gemini --debug
```

Output shows:

```
[AgentRegistry] Initialized with 7 agents.
[AgentRegistry] Loaded 6 markdown agents from .gemini/agents
[Config] Registering agent 'code_reviewer' as tool
```

### Common Issues

#### Agent Not Found

**Symptom**: Orchestrator doesn't invoke your agent

**Checks**:

1. File exists in `.gemini/agents/`
2. `enableSubagents: true` in config
3. File starts with `#` heading
4. File has non-empty content
5. Description clearly indicates when to use agent

#### Agent Invoked But Fails

**Symptom**: Agent starts but produces errors

**Checks**:

1. Tool access includes required tools
2. `max_turns` is sufficient for task
3. System prompt has clear instructions
4. Output format matches `outputConfig.schema`

#### Markdown Parsing Fails

**Symptom**: Agent not registered despite file existing

**Checks**:

1. First line is `# Heading` (with space after #)
2. File is UTF-8 encoded
3. No syntax errors in markdown

## Configuration Reference

### Agent Definition Fields

| Field           | Required | Description                                                       |
| --------------- | -------- | ----------------------------------------------------------------- |
| `name`          | Yes      | Snake_case identifier (auto-generated from filename for markdown) |
| `displayName`   | No       | Human-readable name shown in logs                                 |
| `description`   | Yes      | When to invoke this agent (shown to orchestrator)                 |
| `inputConfig`   | Yes      | Parameters the agent accepts                                      |
| `outputConfig`  | No       | Expected output structure (defaults to string)                    |
| `modelConfig`   | Yes      | Model settings (model, temperature, top_p)                        |
| `runConfig`     | Yes      | Execution limits (max_time_minutes, max_turns)                    |
| `toolConfig`    | No       | Tool access (defaults to all tools except `task`)                 |
| `promptConfig`  | Yes      | System prompt and query template                                  |
| `processOutput` | No       | Function to format output for display                             |

### Input Types

Supported parameter types:

- `string`: Text input
- `number`: Numeric value
- `boolean`: True/false
- `integer`: Whole numbers only
- `string[]`: Array of strings
- `number[]`: Array of numbers

### Tool Access

Common tool configurations:

**Read-only** (for research/investigation):

```typescript
toolConfig: {
  tools: ['read_file', 'grep', 'glob', 'ls'];
}
```

**Read + Shell** (for testing):

```typescript
toolConfig: {
  tools: ['read_file', 'shell'];
}
```

**Read + Write** (for code generation):

```typescript
toolConfig: {
  tools: ['read_file', 'write_file', 'edit'];
}
```

**All tools** (default):

```typescript
// Omit toolConfig or:
toolConfig: undefined;
```

## Advanced Patterns

### Chaining Agents

Agents can invoke other agents (if they have the `task` tool):

```markdown
# Orchestrator Agent

Coordinates multiple specialized agents to complete complex workflows.

## Workflow

1. Invoke `codebase_investigator` to find relevant files
2. Invoke `code_reviewer` to analyze findings
3. Invoke `test_runner` to verify fixes
4. Compile comprehensive report
```

### Conditional Tool Access

Adjust tools based on trust level:

```typescript
toolConfig: {
  tools: config.isTrustedFolder()
    ? ['read_file', 'write_file', 'shell']
    : ['read_file', 'grep', 'glob'];
}
```

### Output Schemas

Use Zod for structured output validation:

```typescript
const TestResultsSchema = z.object({
  passed: z.number(),
  failed: z.number(),
  failures: z.array(
    z.object({
      test: z.string(),
      error: z.string(),
      location: z.string(),
    }),
  ),
  coverage: z.number().optional(),
});
```

## Migration from Old System

If you have agents in the old root `agents/` directory:

```bash
# Move to project-specific location
mkdir -p .gemini/agents
mv agents/*.md .gemini/agents/

# Or use as templates for new agents
cp agents/test-runner.md .gemini/agents/my-test-agent.md
nano .gemini/agents/my-test-agent.md  # Customize
```

## Examples Repository

See the gemini-cli project's own `.gemini/agents/` directory for working examples:

- Test runner
- Git workflow automation
- Context fetching
- File creation
- Project management

These can be copied and adapted for your projects.

## Further Reading

- [Task Tool Documentation](./commands.md#task) - Basic task delegation
- [Project Standards](./project-standards.md) - Automatic standards injection
- [Tool Development](../core/tools-api.md) - Creating custom tools
- [Architecture Overview](../architecture.md) - How agents fit into Gemini CLI
