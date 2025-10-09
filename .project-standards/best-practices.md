# Development Best Practices

## Error Handling

- Use try-catch blocks for async operations
- Provide meaningful error messages
- Log errors with context
- Fail gracefully with user-friendly messages

## Type Safety

- Avoid `any` types - use `unknown` or proper types
- Define interfaces for complex objects
- Use type guards when needed
- Enable strict TypeScript compiler options

## Testing

- Write unit tests for core logic
- Test error conditions and edge cases
- Keep tests focused and readable
- Mock external dependencies

## Performance

- Avoid unnecessary file system operations
- Cache frequently accessed data
- Use async/await for I/O operations
- Consider memory usage for large files

## Security

- Validate user input
- Sanitize file paths to prevent directory traversal
- Never log sensitive data (API keys, tokens)
- Use secure defaults
