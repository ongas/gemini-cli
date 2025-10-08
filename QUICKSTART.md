# Gemini CLI Quickstart

Get up and running with Gemini CLI in 5 minutes.

## Prerequisites

- Node.js installed
- Gemini API key configured

## Installation

```bash
# Clone the repository
git clone https://github.com/google/gemini-cli.git
cd gemini-cli

# Install and build
npm install
npm run bundle

# Create wrapper script
mkdir -p ~/bin
cat > ~/bin/gemini << 'EOF'
#!/bin/bash
NODE_NO_WARNINGS=1 node /path/to/gemini-cli/bundle/gemini.js "$@"
EOF

# Update the path in the script above, then:
chmod +x ~/bin/gemini

# Add to PATH (if not already)
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Test It Works

### 1. Create a Test Project

```bash
cd /tmp
mkdir test-gemini
cd test-gemini
```

### 2. Initialize Project Standards

```bash
gemini --init-standards
```

You should see:

```
✓ Initialized .project-standards in current directory
Project standards initialized successfully!
You can customize the standards in .project-standards/
These will be automatically injected into coding prompts.
```

### 3. Test File Creation

```bash
echo "Create a hello.py file that prints 'Hello World'" | gemini --model gemini-2.0-flash-exp --prompt-interactive
```

### 4. Verify It Worked

```bash
cat hello.py
python hello.py
```

Should output: `Hello World`

### 5. Test Automatic Standards Injection

```bash
echo "Write a JavaScript function to validate an email address" | gemini --model gemini-2.0-flash-exp --prompt-interactive
```

You'll see console output showing standards being automatically loaded:

```
[ProjectStandards] Starting context injection...
[ProjectStandards] Detected task context: { taskType: 'coding', languages: [ 'javascript' ], needsStandards: true }
[ProjectStandards] Found .project-standards directory: /tmp/test-gemini/.project-standards
[ProjectStandards] Loaded standards: [ 'languageSpecific', 'codeStyle', 'bestPractices' ]
[ProjectStandards] Injecting project standards context (2847 characters) into prompt
```

The generated code will follow the standards in `.project-standards/`.

### 6. Test Sub-Agent Delegation

```bash
echo "Use the task tool to analyze all TypeScript files in this directory and create a summary report" | gemini --model gemini-2.0-flash-exp --prompt-interactive
```

Gemini will autonomously decide to use the `task` tool to delegate this work to a sub-agent.

## What Makes Gemini CLI Special?

| Feature               | Description                                       |
| --------------------- | ------------------------------------------------- |
| **Project Standards** | Automatic injection of coding standards           |
| **Task Tool**         | Autonomous sub-agent delegation for complex tasks |
| **Approval Prompts**  | Review changes before they're applied             |
| **Init Command**      | Quick setup with `gemini --init-standards`        |

## Quick Workflow Example

```bash
# Initialize new project
mkdir my-app && cd my-app
gemini --init-standards

# Customize standards
nano .project-standards/code-style.md
nano .project-standards/best-practices.md

# Start coding - standards will be automatically applied
echo "Create a REST API endpoint for user registration" | gemini --prompt-interactive

# For complex tasks, the model will autonomously use the task tool
echo "Analyze the entire codebase, identify technical debt, and create a refactoring plan" | gemini --prompt-interactive
```

## Common Commands

```bash
# Start interactive chat
gemini

# One-shot command
gemini --prompt "Explain this codebase"

# Use specific model
gemini --model gemini-2.0-flash-exp

# Initialize project standards
gemini --init-standards

# Check version
gemini --version
```

## Troubleshooting

**"gemini: command not found"**

```bash
# Check if ~/bin is in PATH
echo $PATH

# Add if missing
export PATH="$HOME/bin:$PATH"

# Verify script location
which gemini
```

**"Template not found"**

```bash
# Rebuild with assets
cd /path/to/gemini-cli
npm run bundle
```

**Standards not being injected**

Check console output for `[ProjectStandards]` messages. If you see "No .project-standards directory found", run `gemini --init-standards` in your project.

## Next Steps

- Read [docs/cli/project-standards.md](./docs/cli/project-standards.md) for complete documentation on project standards
- Customize `.project-standards/` files for your project
- Explore the `task` tool for delegating complex work to sub-agents
- Read about other features in the [docs](./docs/) directory

## Need Help?

Issues: https://github.com/google/gemini-cli/issues
