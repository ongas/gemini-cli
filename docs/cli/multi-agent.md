# Multi-Agent & Local LLM Support

Gemini CLI supports multi-agent workflows and local LLM integration via Ollama, allowing you to create specialized agents for different tasks and run them using either cloud-based Gemini models or local Ollama models.

## Overview

Multi-agent support enables you to:

- **Create specialized agents** for specific tasks (code review, testing, documentation, etc.)
- **Use local models** via Ollama for privacy and cost savings
- **Mix providers** - use Gemini for complex tasks, Ollama for routine work
- **Automatic orchestration** - Gemini intelligently delegates to specialist agents
- **Full transparency** - see which agents are selected and why

## Quick Start

### 1. Initialize Project

```bash
gemini --init
```

This creates:

- `.gemini/agents/` - Directory for custom agent definitions
- `.gemini/standards/` - Directory for project coding standards

### 2. List Available Agents

```bash
gemini --list-agents
```

Shows all built-in and custom agents with their metadata (provider, model, temperature, tools).

### 3. Create a Custom Agent

Create `.gemini/agents/code-reviewer.md`:

```markdown
# Code Reviewer

Reviews code for bugs, style issues, and best practices.

**Provider:** gemini
**Model:** gemini-2.5-pro
**Temperature:** 0.3
**Tools:** read_file, write_file

## Instructions

You are a code review specialist.
Analyze code for:

- Bugs and potential issues
- Code style and best practices
- Performance concerns
- Security vulnerabilities

Provide constructive feedback with specific suggestions.
```

### 4. Use the Agent

Gemini will automatically delegate to appropriate agents:

```bash
gemini
> Review the authentication module for security issues
```

Or invoke directly:

```bash
gemini --agent code_reviewer "Review src/auth.js"
```

## Local LLM Support (Ollama)

### Setup Ollama

1. Install Ollama from https://ollama.ai
2. Start Ollama server:
   ```bash
   ollama serve
   ```
3. Pull a model:
   ```bash
   ollama pull llama3
   # or
   ollama pull codellama
   ```

### Create an Ollama Agent

Create `.gemini/agents/local-helper.md`:

```markdown
# Local Helper

Fast local coding assistant using CodeLlama.

**Provider:** ollama
**Model:** codellama
**Temperature:** 0.5

## Instructions

You are a fast, local coding assistant.
Help with code generation, refactoring, and explanations.
Be concise and practical.
```

### Environment Variables

- `OLLAMA_BASE_URL` - Override default Ollama URL (default: `http://localhost:11434`)

```bash
export OLLAMA_BASE_URL=http://192.168.1.100:11434
```

## Agent Definition Format

Agent definitions use markdown with metadata in bold key-value format:

```markdown
# Agent Display Name

Agent description (first non-metadata line).

**Provider:** gemini | ollama (default: gemini)
**Model:** model-name (default: gemini-2.0-flash-exp)
**Temperature:** 0.0-1.0 (default: 0.2)
**Tools:** comma,separated,tool,names (default: all tools)

## Instructions

Your system instructions here.
These instructions define the agent's behavior and capabilities.
```

### Supported Metadata

- **Provider**: Which LLM provider to use
  - `gemini` - Google Gemini API (cloud)
  - `ollama` - Local Ollama server

- **Model**: Specific model name
  - Gemini: `gemini-2.5-pro`, `gemini-2.0-flash-exp`, etc.
  - Ollama: `llama3`, `codellama`, `mistral`, etc.

- **Temperature**: Creativity/randomness (0.0 = deterministic, 1.0 = creative)

- **Tools**: Which tools the agent can use
  - Comma-separated list: `read_file, write_file, bash`
  - `all` for all available tools

### Agent Naming

- **File**: `my-agent.md` (kebab-case with hyphens)
- **Agent name**: `my_agent` (snake_case, automatically converted)
- **Usage**: `--agent my_agent`

Example:

- File: `code-reviewer.md`
- Name: `code_reviewer`
- Command: `gemini --agent code_reviewer "Review this code"`

## Agent Selection Logs

Agent logs provide transparency into multi-agent orchestration.

### Automatic Logs (Always Shown)

When Gemini delegates to an agent, you'll see:

```
🤖 Agent Selected: Code Reviewer
   Provider: gemini
   Model: gemini-2.5-pro
   Task: Review the authentication module for security issues

Starting agent execution...

[Agent works...]

✅ Agent Completed: Code Reviewer
   Status: GOAL
```

### Startup Message (Interactive Mode)

```bash
gemini
🤖 2 specialized agents available (use --list-agents to see all)

Ready to chat!
```

### Debug Mode

See detailed agent registry initialization:

```bash
gemini --debug
[AgentRegistry] Initialized with 2 agents:
  - Code Reviewer (gemini/gemini-2.5-pro)
  - Local Helper (ollama/codellama)

🤖 2 specialized agents available (use --list-agents to see all)
```

### Log Details

**🤖 Agent Selected**

- Which specialist agent was chosen
- Provider (Gemini vs Ollama)
- Model being used
- Task description

**✅ Agent Completed**

- Confirmation of completion
- Termination status:
  - `GOAL` - Successfully completed
  - `MAX_TURNS` - Reached turn limit
  - `TIMEOUT` - Execution timeout
  - `ERROR` - Encountered error

## Complete Example

### Scenario: Local Development with Cost Control

**1. Setup**

```bash
# Install and start Ollama
ollama serve
ollama pull codellama

# Initialize project
cd my-project
gemini --init
```

**2. Create Local Agent**

`.gemini/agents/code-helper.md`:

```markdown
# Code Helper

Fast local coding assistant.

**Provider:** ollama
**Model:** codellama
**Temperature:** 0.5

## Instructions

You are a fast, local coding assistant.
Help with code generation, refactoring, and explanations.
```

**3. Create Cloud Agent for Complex Work**

`.gemini/agents/architect.md`:

```markdown
# System Architect

Analyzes and designs system architecture.

**Provider:** gemini
**Model:** gemini-2.5-pro
**Temperature:** 0.3

## Instructions

You are a system architecture specialist.
Design scalable, maintainable systems.
Consider performance, security, and best practices.
```

**4. Verify Setup**

```bash
gemini --list-agents

📋 Available Agents:

  Code Helper
    Name: code_helper
    Provider: ollama
    Model: codellama
    Temperature: 0.5
    Tools: all

  System Architect
    Name: architect
    Provider: gemini
    Model: gemini-2.5-pro
    Temperature: 0.3
    Tools: all
```

**5. Use Agents**

```bash
# Gemini automatically delegates based on task
gemini "Help me refactor this module"  # Uses code_helper (local, free)
gemini "Design the architecture for a new microservice"  # Uses architect (cloud, powerful)

# Or invoke directly
gemini --agent code_helper "Write a function to validate emails"
gemini --agent architect "Review the overall system design"
```

## Benefits

### Cost Savings

- Use free local models (Ollama) for routine tasks
- Use powerful cloud models (Gemini) for complex analysis
- Fine-grained control over provider selection

### Privacy

- Keep sensitive code on local machines
- Use local models for proprietary projects
- No data leaves your network with Ollama

### Flexibility

- Mix and match providers per agent
- Choose models based on task requirements
- Scale up or down as needed

### Transparency

- See which agent handles each task
- Understand provider/model selection
- Track agent execution status

## Troubleshooting

### Ollama Connection Issues

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Set custom URL if needed
export OLLAMA_BASE_URL=http://192.168.1.100:11434

# Check Ollama logs
ollama logs
```

### Agent Not Found

```bash
# List all agents to verify name
gemini --list-agents

# Check file name matches usage
# File: my-agent.md → Usage: gemini --agent my_agent

# Verify file is in .gemini/agents/
ls -la .gemini/agents/
```

### Agent Not Loading

```bash
# Use debug mode to see loading process
gemini --debug

# Check for syntax errors in agent definition
cat .gemini/agents/my-agent.md
```

### Ollama Model Not Found

```bash
# List available models
ollama list

# Pull the model if missing
ollama pull llama3
```

## Technical Details

### Implementation Files

- `packages/core/src/core/ollamaContentGenerator.ts` - Ollama API integration
- `packages/core/src/agents/executor.ts` - Provider-specific config creation
- `packages/core/src/agents/markdown-agent-loader.ts` - Agent definition parsing
- `packages/core/src/agents/registry.ts` - Agent discovery and loading
- `packages/core/src/agents/invocation.ts` - Agent execution and logging
- `packages/cli/src/gemini.tsx` - CLI commands (--list-agents, --agent)

### Ollama API Integration

- Uses `/api/chat` endpoint for streaming responses
- Converts between Gemini Content format and Ollama message format
- Supports system instructions, temperature, and other parameters
- Handles streaming with newline-delimited JSON

### Agent Orchestration

- Gemini acts as implicit orchestrator
- Automatically selects appropriate agent based on task
- Falls back to direct Gemini response if no agent matches
- Supports explicit agent invocation with `--agent` flag

## See Also

- [Custom Commands](./custom-commands.md) - Create reusable slash commands
- [Context Files (GEMINI.md)](./gemini-md.md) - Provide persistent context
- [Configuration Guide](../get-started/configuration.md) - Settings and customization
