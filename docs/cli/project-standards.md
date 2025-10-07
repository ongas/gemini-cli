# Project Standards

Gemini CLI includes automatic project standards injection that loads and applies your coding standards, best practices, and tech stack guidelines to every relevant prompt automatically.

## Quick Start

Initialize project standards in your project:

```bash
gemini --init-standards
```

This creates a `.project-standards/` directory structure with template standards files that you can customize for your project.

### What Gets Created

```
.project-standards/
└── standards/
    ├── code-style.md         # General coding standards
    ├── best-practices.md     # Project best practices
    ├── tech-stack.md         # Technology stack guidelines
    └── code-style/           # Language-specific standards
        ├── javascript-style.md
        ├── html-style.md
        └── css-style.md
```

## How It Works

### Automatic Standards Injection

The most powerful feature is automatic standards injection. When you're working in a project with `.project-standards/standards/`, these standards are automatically applied to relevant tasks.

1. **Task Detection**: When you send a prompt, Gemini CLI automatically detects the task type:
   - `coding` - Creating/modifying code
   - `planning` - Design and architecture
   - `testing` - Writing or running tests
   - `git` - Git operations (standards not injected)
   - `general` - Other tasks (standards not injected)

2. **Language Detection**: Identifies programming languages mentioned in your prompt

3. **Standards Loading**: Automatically loads relevant standards from `.project-standards/standards/`:
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
[Loads .project-standards/standards/code-style.md]
[Loads .project-standards/standards/code-style/javascript-style.md]
[Detects: coding task, JavaScript language]
[Injects standards into prompt]
```

**Console output:**

```
[ProjectStandards] Starting context injection...
[ProjectStandards] Detected task context: { taskType: 'coding', languages: [ 'javascript' ], needsStandards: true }
[ProjectStandards] Found .project-standards directory: /path/to/your/project/.project-standards
[ProjectStandards] Loaded standards: [ 'languageSpecific', 'codeStyle', 'bestPractices', 'techStack' ]
[ProjectStandards] Injecting project standards context (2847 characters) into prompt
```

**Result**: The model receives your coding standards automatically and produces code that follows them.

## Customizing Standards

Edit the files in `.project-standards/standards/` to match your project's needs:

### code-style.md

General coding standards that apply to all languages:

```markdown
# Code Style Standards

- Use meaningful variable names
- Functions should be small and focused
- Maximum line length: 100 characters
- Always include error handling
```

### best-practices.md

Project-specific best practices:

```markdown
# Best Practices

- Write unit tests for all new functions
- Document public APIs
- Use async/await instead of raw promises
- Validate all user inputs
```

### tech-stack.md

Your technology stack and architectural decisions:

```markdown
# Technology Stack

## Backend

- Node.js v20+
- Express.js for API routes
- PostgreSQL for database

## Frontend

- React 18
- TypeScript
- Tailwind CSS
```

### Language-Specific Standards

Create files in `.project-standards/standards/code-style/` for language-specific rules:

**javascript-style.md:**

```markdown
# JavaScript Style Guide

- Use ES6+ syntax
- Prefer const over let, avoid var
- Use camelCase for variables and functions
- Use PascalCase for classes
- Always use semicolons
```

**python-style.md:**

```markdown
# Python Style Guide

- Follow PEP 8
- Use snake_case for functions and variables
- Use type hints
- Maximum line length: 88 characters (Black formatter)
```

## When Standards Are Applied

Standards are automatically applied for these task types:

- **Coding tasks** (`write`, `create`, `implement`, `add`, `build`, `code`, `function`, `class`, `method`)
  - Applies: `code-style.md` + language-specific standards

- **Planning tasks** (`plan`, `design`, `architect`, `spec`, `roadmap`, `feature`)
  - Applies: `best-practices.md` + `tech-stack.md`

- **Testing tasks** (`test`, `pytest`, `jest`, `mocha`, `spec`, `unit test`)
  - Applies: `best-practices.md` + language-specific standards

Standards are NOT applied for git operations or general questions.

## Benefits

### Consistency

- All code follows the same style automatically
- No need to repeatedly explain your preferences
- New team members' code matches existing patterns

### Productivity

- No manual copying/pasting of standards
- No remembering to include guidelines
- Focus on the task, not the formatting

### Quality

- Best practices always applied
- Architectural patterns enforced
- Technology choices aligned with stack

## Advanced Usage

### Sub-Agent Standards

When using the `task` tool to create sub-agents, they automatically inherit the same standards from your project's `.project-standards/` directory. This ensures consistency across all levels of task delegation.

### Multi-Project Standards

Each project can have its own `.project-standards/` directory. Gemini CLI searches up the directory tree from your current working directory to find the nearest `.project-standards/` directory.

### Disabling Standards Injection

If you need to temporarily work without standards injection, work in a directory that doesn't have a `.project-standards/` parent directory.

## Troubleshooting

### Standards Not Being Applied

Check that:

1. You have a `.project-standards/standards/` directory in your project or a parent directory
2. The standard files contain content (not empty)
3. Your prompt includes keywords that trigger task detection (like "write", "create", "implement")
4. You see `[ProjectStandards]` log messages indicating detection

### Too Much Context

If standards files are very large, they consume more tokens. Keep standards concise and focused on the most important rules.

### Standards Not Found

The console will show:

```
[ProjectStandards] No .project-standards directory found, skipping context injection
```

This means you need to run `gemini --init-standards` or you're not in a directory that has access to a `.project-standards/` directory.
