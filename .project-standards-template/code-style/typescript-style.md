# TypeScript Style Guide

Language-specific standards for TypeScript.

## Type Safety

- Avoid `any` - use proper types or `unknown`
- Define interfaces for complex objects
- Enable strict compiler options
- Use type guards when narrowing types

## Modern TypeScript

- Use ES6+ features (const/let, arrow functions, destructuring)
- Prefer `const` over `let`
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Use async/await over raw Promises

## Imports/Exports

- Use named imports when possible
- Group imports by category
- Export types used in public APIs
- Avoid circular dependencies

## Functions

- Annotate parameter types
- Annotate return types for public functions
- Use arrow functions for callbacks
- Keep functions focused (single responsibility)
