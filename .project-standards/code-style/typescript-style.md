# TypeScript Style Guide

## Type Definitions

- Prefer `interface` over `type` for object shapes
- Use `type` for unions, intersections, and primitives
- Export types that are part of public API
- Avoid type assertions unless necessary

## Async/Await

- Always use `async/await` over raw Promises
- Handle Promise rejections with try-catch
- Avoid mixing callbacks and Promises

## Imports

- Use absolute imports from package root when possible
- Group imports: Node.js built-ins, external packages, internal modules
- Use named imports over default imports when available

## Modern Features

- Use ES6+ features (const/let, arrow functions, destructuring)
- Prefer `const` over `let` when variable won't be reassigned
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Use template literals for string interpolation

## Functions

- Use arrow functions for callbacks and short functions
- Use function declarations for named top-level functions
- Provide type annotations for function parameters
- Annotate return types for public functions
