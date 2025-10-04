# Gemini-AOS Quickstart

Get up and running with Gemini-AOS in 5 minutes.

## Prerequisites

- Node.js installed
- Gemini API key configured

## Installation

```bash
# Clone the repository
git clone https://github.com/ongas/gemini-cli.git
cd gemini-cli

# Install and build
npm install
npm run bundle

# Create wrapper script
mkdir -p ~/bin
cat > ~/bin/gemini-aos << 'EOF'
#!/bin/bash
NODE_NO_WARNINGS=1 node /path/to/gemini-cli/bundle/gemini.js "$@"
EOF

# Update the path in the script above, then:
chmod +x ~/bin/gemini-aos

# Add to PATH (if not already)
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Test It Works

### 1. Create a Test Project

```bash
cd /tmp
mkdir test-gemini-aos
cd test-gemini-aos
```

### 2. Initialize Agent-OS

```bash
gemini-aos --init-agent-os
```

You should see:

```
✓ Initialized .agent-os in current directory
✓ Installed subagents to ~/.gemini/agents/
```

### 3. Test File Creation (Approval Prompt)

```bash
echo "Create a hello.py file that prints 'Hello World'" | gemini-aos --model gemini-2.0-flash-exp --prompt-interactive
```

**What you'll see:**

- Approval prompt with `=` border
- Diff preview showing file changes
- Options: `y` (proceed), `a` (auto-approve), `n` (reject)

Type `y` and press Enter.

### 4. Verify It Worked

```bash
cat hello.py
python hello.py
```

Should output: `Hello World`

### 5. Test Agent-OS Instructions

```bash
echo "@.agent-os/instructions/core/plan-product.md Plan a simple calculator app with add and subtract functions" | gemini-aos --model gemini-2.0-flash-exp --prompt-interactive
```

Gemini will follow the structured planning workflow from Agent-OS.

### 6. Test Subagents

```bash
echo "List all the subagents you have access to" | gemini-aos --model gemini-2.0-flash-exp --prompt-interactive
```

You should see 6 agents:

- context-fetcher
- date-checker
- file-creator
- git-workflow
- project-manager
- test-runner

## What Makes Gemini-AOS Different?

| Feature                | Test It                                            |
| ---------------------- | -------------------------------------------------- |
| **Approval Prompts**   | Create any file - you'll be asked for approval     |
| **Agent-OS Workflows** | Use `@.agent-os/instructions/core/plan-product.md` |
| **Subagents**          | Reference with `@~/.gemini/agents/test-runner.md`  |
| **Init Command**       | Run `gemini-aos --init-agent-os` in any project    |

## Quick Workflow Example

```bash
# Initialize new project
mkdir my-app && cd my-app
gemini-aos --init-agent-os

# Plan feature
echo "@.agent-os/instructions/core/plan-product.md Add user authentication" | gemini-aos --prompt-interactive

# Create implementation
echo "Implement the authentication feature" | gemini-aos --prompt-interactive
# Approve each file change when prompted

# Verify files were created
ls -la
```

## Common Commands

```bash
# Start interactive chat
gemini-aos

# One-shot command
gemini-aos --prompt "Explain this codebase"

# Use specific model
gemini-aos --model gemini-2.0-flash-exp

# Initialize Agent-OS
gemini-aos --init-agent-os

# Check version
gemini-aos --version
```

## Troubleshooting

**"gemini-aos: command not found"**

```bash
# Check if ~/bin is in PATH
echo $PATH

# Add if missing
export PATH="$HOME/bin:$PATH"

# Verify script location
which gemini-aos
```

**"Template not found"**

```bash
# Rebuild with assets
cd /path/to/gemini-cli
npm run bundle
```

**Approval prompts not showing**

- Check `~/.gemini/settings.json` has message bus integration enabled
- Try with `--prompt-interactive` flag

## Next Steps

- Read [AGENT-OS-GUIDE.md](./AGENT-OS-GUIDE.md) for complete documentation
- Explore `.agent-os/instructions/` in your initialized project
- Check out subagents in `~/.gemini/agents/`
- Try planning a real feature with Agent-OS workflows

## Need Help?

Issues: https://github.com/ongas/gemini-cli/issues
