/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolInvocation } from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
} from './tools.js';

// Inspired by langchain/deepagents.
export const WRITE_TODOS_DESCRIPTION = `⚠️ **CRITICAL TOOL - USE FREQUENTLY** ⚠️

This tool is MANDATORY for managing complex multi-step tasks. You MUST create and update a todo list to show the user your progress. Failure to use this tool makes it impossible for users to track what you're doing.

## WHEN TO USE (Read This FIRST Before Every Response!)

**YOU MUST IMMEDIATELY create a todo list if ANY of these apply:**
- User says "debug", "fix", "troubleshoot", "investigate", "error", "failing"
- User says "test", "pytest", "run tests", "check tests"
- User says "implement", "create", "build", "add feature"
- User says "refactor", "restructure", "reorganize"
- User says "optimize", "improve", "enhance", "performance"
- User says "setup", "configure", "install", "initialize"
- User request requires 3+ steps (even if they don't mention it)
- You're planning to read multiple files, then make changes
- You're going to run a command, analyze output, then act on it
- **ANY debugging task** (this is the #1 use case - always create todos for debugging!)
- **ANY test-related task** (always create todos when working with tests!)

## DEFAULT TO CREATING TODOS

**When in doubt, CREATE A TODO LIST.** It's better to create a todo list for a simple task than to skip it for a complex one. Users WANT to see your thought process and progress.

## Common Task Templates

### For "Debug failing pytest tests":
1. Run pytest to capture the exact failures
2. Read the failing test file(s)
3. Understand what behavior is being tested
4. Identify the root cause in the implementation
5. Make the necessary fix
6. Re-run pytest to verify all tests pass
7. Check for any related tests that might be affected

### For "Debug X" or "Fix bug in Y":
1. Reproduce the issue
2. Identify the root cause
3. Implement the fix
4. Verify the fix works
5. Check for edge cases or regressions

### For "Implement feature X":
1. Understand the requirements
2. Design the solution approach
3. Implement core functionality
4. Add error handling
5. Write tests
6. Document the changes

## General Guidelines

Use this tool for complex queries requiring multiple steps. If you find a request is more complex than initially expected, create a todo list immediately.

DO NOT use for simple tasks completable in 1-2 steps or single-turn Q&A.

## Task state definitions

- pending: Work has not begun on a given subtask.
- in_progress: Marked just prior to beginning work on a given subtask. You should only have one subtask as in_progress at a time.
- completed: Subtask was succesfully completed with no errors or issues. If the subtask required more steps to complete, update the todo list with the subtasks. All steps should be identified as completed only when they are completed.
- cancelled: As you update the todo list, some tasks are not required anymore due to the dynamic nature of the task. In this case, mark the subtasks as cancelled.


## Methodology for using this tool (FOLLOW STRICTLY!)

1. **CREATE IMMEDIATELY** - Use this tool in your FIRST response if the task matches the criteria above. Don't wait.
2. **UPDATE FREQUENTLY** - Call this tool every time you start, complete, or cancel a task. The user needs real-time updates.
3. **ONE IN-PROGRESS ONLY** - Mark exactly ONE subtask as in_progress before working on it. Never have zero or multiple in-progress tasks.
4. **BE SPECIFIC** - Tasks like "Fix the bug" are too vague. Use "Read failing test output", "Identify root cause in auth.py", etc.
5. **EVOLVE THE LIST** - Add new tasks as you discover them. Remove tasks that are no longer needed.
6. **MARK COMPLETED IMMEDIATELY** - As soon as a task succeeds, update the list. Don't batch updates.
7. **FOR DEBUGGING: ALWAYS CREATE TODOS** - Debugging tasks are complex by nature. Every debugging request needs a todo list.


## Examples of When to Use the Todo List

<example>
User request: Create a website with a React for creating fancy logos using gemini-2.5-flash-image

ToDo list created by the agent:
1. Initialize a new React project environment (e.g., using Vite).
2. Design and build the core UI components: a text input (prompt field) for the logo description, selection controls for style parameters (if the API supports them), and an image preview area.
3. Implement state management (e.g., React Context or Zustand) to manage the user's input prompt, the API loading status (pending, success, error), and the resulting image data.
4. Create an API service module within the React app (using "fetch" or "axios") to securely format and send the prompt data via an HTTP POST request to the specified "gemini-2.5-flash-image" (Gemini model) endpoint.
5. Implement asynchronous logic to handle the API call: show a loading indicator while the request is pending, retrieve the generated image (e.g., as a URL or base64 string) upon success, and display any errors.
6. Display the returned "fancy logo" from the API response in the preview area component.
7. Add functionality (e.g., a "Download" button) to allow the user to save the generated image file.
8. Deploy the application to a web server or hosting platform.

<reasoning>
The agent used the todo list to break the task into distinct, manageable steps:
1. Building an entire interactive web application from scratch is a highly complex, multi-stage process involving setup, UI development, logic integration, and deployment.
2. The agent inferred the core functionality required for a "logo creator," such as UI controls for customization (Task 3) and an export feature (Task 7), which must be tracked as distinct goals.
3. The agent rightly inferred the requirement of an API service model for interacting with the image model endpoint.
</reasoning>
</example>


## Examples of When NOT to Use the Todo List

<example>
User request: Ensure that the test <test file> passes.

Agent:
<Goes into a loop of running the test, identifying errors, and updating the code until the test passes.>

<reasoning>
The agent did not use the todo list because this task could be completed by a tight loop of execute test->edit->execute test.
</reasoning>
</example>
`;

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Todo {
  description: string;
  status: TodoStatus;
}

export interface WriteTodosToolParams {
  /**
   * The full list of todos. This will overwrite any existing list.
   */
  todos: Todo[];
}

class WriteTodosToolInvocation extends BaseToolInvocation<
  WriteTodosToolParams,
  ToolResult
> {
  getDescription(): string {
    const count = this.params.todos?.length ?? 0;
    if (count === 0) {
      return 'Cleared todo list';
    }
    return `Set ${count} todo(s)`;
  }

  async execute(
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const todos = this.params.todos ?? [];
    const todoListString = todos
      .map(
        (todo, index) => `${index + 1}. [${todo.status}] ${todo.description}`,
      )
      .join('\n');

    const llmContent =
      todos.length > 0
        ? `Successfully updated the todo list. The current list is now:\n${todoListString}`
        : 'Successfully cleared the todo list.';

    return {
      llmContent,
      returnDisplay: llmContent,
    };
  }
}

export class WriteTodosTool extends BaseDeclarativeTool<
  WriteTodosToolParams,
  ToolResult
> {
  static readonly Name: string = 'write_todos_list';

  constructor() {
    super(
      WriteTodosTool.Name,
      'Write Todos',
      WRITE_TODOS_DESCRIPTION,
      Kind.Other,
      {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description:
              'The complete list of todo items. This will replace the existing list.',
            items: {
              type: 'object',
              description: 'A single todo item.',
              properties: {
                description: {
                  type: 'string',
                  description: 'The description of the task.',
                },
                status: {
                  type: 'string',
                  description: 'The current status of the task.',
                  enum: ['pending', 'in_progress', 'completed'],
                },
              },
              required: ['description', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    );
  }

  protected override validateToolParamValues(
    params: WriteTodosToolParams,
  ): string | null {
    const todos = params?.todos;
    if (!params || !Array.isArray(todos)) {
      return '`todos` parameter must be an array';
    }

    for (const todo of todos) {
      if (typeof todo !== 'object' || todo === null) {
        return 'Each todo item must be an object';
      }
      if (typeof todo.description !== 'string' || !todo.description.trim()) {
        return 'Each todo must have a non-empty description string';
      }
      if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
        return 'Each todo must have a valid status (pending, in_progress, or completed)';
      }
    }

    const inProgressCount = todos.filter(
      (todo: Todo) => todo.status === 'in_progress',
    ).length;

    if (inProgressCount > 1) {
      return 'Invalid parameters: Only one task can be "in_progress" at a time.';
    }

    return null;
  }

  protected createInvocation(
    params: WriteTodosToolParams,
  ): ToolInvocation<WriteTodosToolParams, ToolResult> {
    return new WriteTodosToolInvocation(params);
  }
}
