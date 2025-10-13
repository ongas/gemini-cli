/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import {
  SubAgentScope,
  ContextState,
  SubagentTerminateMode,
} from '../core/subagent.js';
import { ToolErrorType } from './tool-error.js';
const taskToolSchemaData = {
  name: 'task',
  description:
    'Launch an autonomous sub-agent to handle complex, multi-step tasks independently. The sub-agent will work with a separate context window and report back results when complete. Use this for tasks that require multiple steps, deep analysis, or extended problem-solving that would benefit from focused, independent execution.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description:
          'A concise (3-5 word) description of the task for tracking purposes (e.g., "Fix authentication bug", "Analyze performance bottleneck")',
      },
      prompt: {
        type: 'string',
        description:
          'The detailed task prompt for the sub-agent. Be specific about what needs to be accomplished, any constraints, and what information should be returned. The sub-agent will work autonomously based on this prompt.',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional array of tool names the sub-agent is allowed to use (e.g., ["read_file", "write_file", "run_shell_command"]). If not specified, the sub-agent will have access to all available tools.',
      },
      max_time_minutes: {
        type: 'number',
        description:
          'Optional maximum execution time in minutes (default: 10). The sub-agent will be terminated if it exceeds this duration.',
      },
      max_turns: {
        type: 'number',
        description:
          'Optional maximum number of conversation turns (default: 50). The sub-agent will be terminated if it exceeds this limit.',
      },
    },
    required: ['description', 'prompt'],
  },
};
const taskToolDescription = `
Launch an autonomous sub-agent to handle complex, multi-step tasks independently.

## When to Use This Tool

Use the task tool when you need to:
- Delegate a complex, multi-step task that requires focused attention
- Analyze or debug code across multiple files
- Perform extended research or investigation
- Execute a task that would benefit from a fresh context window
- Handle tasks that might require many iterations to complete

## How It Works

1. You provide a detailed prompt describing what the sub-agent should accomplish
2. The sub-agent works independently with its own context window
3. The sub-agent has access to the specified tools (or all tools if none specified)
4. When complete (or when time/turn limits are reached), the sub-agent returns results
5. Results are provided back to you for further action

## Parameters

- \`description\` (string, required): Brief description of the task (3-5 words)
- \`prompt\` (string, required): Detailed instructions for the sub-agent
- \`tools\` (array, optional): List of tool names the sub-agent can use
- \`max_time_minutes\` (number, optional): Maximum execution time (default: 10)
- \`max_turns\` (number, optional): Maximum conversation turns (default: 50)

## Example Usage

task({
  description: "Fix search bug",
  prompt: "Investigate why the search functionality is not working in the map viewer. Check location_mapper.py and main.py for issues with HTML injection. Fix any problems found and test the solution.",
  tools: ["read_file", "write_file", "run_shell_command"],
  max_time_minutes: 15
})

## Important Notes

- The sub-agent works independently and cannot ask you questions
- Provide clear, complete instructions in the prompt
- The sub-agent will stop when it completes its goal, runs out of time, or hits the turn limit
- Results include any variables the sub-agent emitted and the termination reason
`;
class TaskToolInvocation extends BaseToolInvocation {
  config;
  constructor(config, params) {
    super(params);
    this.config = config;
  }
  getDescription() {
    return this.params.description;
  }
  async execute(_signal) {
    const {
      description,
      prompt,
      tools,
      max_time_minutes = 10,
      max_turns = 50,
    } = this.params;
    try {
      // Build prompt configuration
      const promptConfig = {
        systemPrompt: prompt,
      };
      // Build model configuration
      const modelConfig = {
        model: this.config.getModel(),
        temp: 1.0,
        top_p: 0.95,
      };
      // Build run configuration
      const runConfig = {
        max_time_minutes,
        max_turns,
      };
      // Build tool configuration - if not specified, give access to all tools
      const toolConfig = tools
        ? { tools }
        : {
            tools: this.config
              .getToolRegistry()
              .getAllTools()
              .map((tool) => tool.name)
              .filter((name) => name !== 'task'), // Don't allow nested task tools
          };
      // Create message handler to collect sub-agent output
      const messages = [];
      const onMessage = (message) => {
        messages.push(message);
      };
      // Create sub-agent scope
      const scope = await SubAgentScope.create(
        description,
        this.config,
        promptConfig,
        modelConfig,
        runConfig,
        {
          toolConfig,
          onMessage,
        },
      );
      // Run sub-agent
      const context = new ContextState();
      await scope.runNonInteractive(context);
      // Format results
      const terminateReason = scope.output.terminate_reason;
      const emittedVars = scope.output.emitted_vars;
      let statusMessage;
      switch (terminateReason) {
        case SubagentTerminateMode.GOAL:
          statusMessage = 'Sub-agent completed successfully';
          break;
        case SubagentTerminateMode.TIMEOUT:
          statusMessage = `Sub-agent timed out after ${max_time_minutes} minutes`;
          break;
        case SubagentTerminateMode.MAX_TURNS:
          statusMessage = `Sub-agent reached maximum turns (${max_turns})`;
          break;
        case SubagentTerminateMode.ERROR:
          statusMessage = 'Sub-agent encountered an error';
          break;
        default:
          statusMessage = `Sub-agent terminated: ${terminateReason}`;
      }
      const resultSummary = {
        description,
        status: terminateReason,
        statusMessage,
        emittedVariables: emittedVars,
        messageCount: messages.length,
      };
      const displayOutput = [
        `## Sub-Agent Task: ${description}`,
        '',
        `**Status:** ${statusMessage}`,
        '',
        ...(Object.keys(emittedVars).length > 0
          ? [
              '**Emitted Variables:**',
              '```json',
              JSON.stringify(emittedVars, null, 2),
              '```',
              '',
            ]
          : []),
        ...(messages.length > 0
          ? ['**Sub-Agent Output:**', '', ...messages.map((m) => `> ${m}`), '']
          : []),
      ].join('\n');
      return {
        llmContent: JSON.stringify(resultSummary, null, 2),
        returnDisplay: displayOutput,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[TaskTool] Error executing task "${description}": ${errorMessage}`,
      );
      return {
        llmContent: JSON.stringify({
          success: false,
          error: `Failed to execute sub-agent task: ${errorMessage}`,
        }),
        returnDisplay: `Error executing sub-agent task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}
export class TaskTool extends BaseDeclarativeTool {
  config;
  static Name = taskToolSchemaData.name;
  constructor(config) {
    super(
      TaskTool.Name,
      'Task',
      taskToolDescription,
      Kind.Think,
      taskToolSchemaData.parametersJsonSchema,
    );
    this.config = config;
  }
  validateToolParamValues(params) {
    if (params.description.trim() === '') {
      return 'Parameter "description" must be a non-empty string.';
    }
    if (params.prompt.trim() === '') {
      return 'Parameter "prompt" must be a non-empty string.';
    }
    if (params.max_time_minutes !== undefined && params.max_time_minutes <= 0) {
      return 'Parameter "max_time_minutes" must be greater than 0.';
    }
    if (params.max_turns !== undefined && params.max_turns <= 0) {
      return 'Parameter "max_turns" must be greater than 0.';
    }
    return null;
  }
  createInvocation(params) {
    return new TaskToolInvocation(this.config, params);
  }
}
//# sourceMappingURL=task.js.map
