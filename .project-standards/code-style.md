# Code Style Guide

General coding standards for this project.

## Formatting

- **Indentation**: 2 spaces (no tabs)
- **Line Length**: 100 characters max
- **Semicolons**: Required
- **Quotes**: Single quotes for strings, backticks for templates

## Naming Conventions

- **Files**: kebab-case (e.g., `project-standards-injector.ts`)
- **Variables/Functions**: camelCase (e.g., `loadProjectStandards`)
- **Classes/Interfaces**: PascalCase (e.g., `ProjectStandards`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_TOKENS`)
- **Type Parameters**: Single uppercase letter or PascalCase (e.g., `T`, `TResult`)

## Code Organization

- Keep functions focused and small (< 50 lines ideally)
- Extract complex logic into helper functions
- Group related functionality in modules
- Use descriptive variable names

## Comments

- Add JSDoc comments for public APIs
- Explain "why" not "what" in inline comments
- Keep comments up-to-date with code changes
- Use `TODO:` for future improvements
