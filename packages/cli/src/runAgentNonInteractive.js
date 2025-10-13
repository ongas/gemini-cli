/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { MarkdownAgentLoader, AgentExecutor } from '@google/gemini-cli-core';
/**
 * Runs an agent non-interactively using the AgentExecutor.
 * This provides proper agent execution with complete_task tool and multi-turn support.
 *
 * @param config The runtime configuration
 * @param settings The loaded settings
 * @param agentFilePath Path to the agent markdown file
 * @param userTask The task to give to the agent
 */
export async function runAgentNonInteractive(
  config,
  _settings,
  agentFilePath,
  userTask,
) {
  try {
    // Load the agent definition from markdown file
    const agentDefinition = await MarkdownAgentLoader.loadFromFile(
      agentFilePath,
      config.getDebugMode(),
    );
    if (!agentDefinition) {
      console.error(`Failed to load agent from ${agentFilePath}`);
      process.exit(1);
    }
    const provider = agentDefinition.modelConfig.provider || 'gemini';
    const model = agentDefinition.modelConfig.model;
    console.log(`\n🤖 Running ${agentDefinition.displayName} agent`);
    console.log(`   Provider: ${provider}`);
    console.log(`   Model: ${model}`);
    console.log(
      `   Task: ${userTask.slice(0, 100)}${userTask.length > 100 ? '...' : ''}\n`,
    );
    // Validate tools if specified
    if (agentDefinition.toolConfig?.tools) {
      const toolRegistry = await config.getToolRegistry();
      const availableTools = toolRegistry.getAllToolNames();
      const requestedTools = agentDefinition.toolConfig.tools.filter(
        (t) => typeof t === 'string',
      );
      const invalidTools = requestedTools.filter(
        (t) => !availableTools.includes(t),
      );
      if (invalidTools.length > 0) {
        console.error(`\n❌ Agent definition error: Invalid tools specified\n`);
        console.error(`The following tools are not registered:`);
        invalidTools.forEach((tool) => console.error(`  - ${tool}`));
        console.error(`\nAvailable tools are:`);
        availableTools.forEach((tool) => console.error(`  - ${tool}`));
        console.error(
          `\nPlease update your agent definition in: ${agentFilePath}\n`,
        );
        process.exit(1);
      }
      if (config.getDebugMode()) {
        console.log(
          `[Agent Tools] Validated ${requestedTools.length} tools: ${requestedTools.join(', ')}`,
        );
      }
    }
    // Create an activity callback to show agent progress
    const onActivity = (activity) => {
      if (config.getDebugMode()) {
        console.log(`[Agent Activity] ${activity.type}:`, activity.data);
      }
      // Show tool calls
      if (activity.type === 'TOOL_CALL_START') {
        console.log(`🔧 Calling tool: ${activity.data.name}`);
      } else if (activity.type === 'TOOL_CALL_END') {
        console.log(`✓ Tool completed: ${activity.data.name}`);
      } else if (activity.type === 'ERROR') {
        console.error(
          `❌ Error: ${activity.data.error || JSON.stringify(activity.data)}`,
        );
      }
    };
    // Create the agent executor
    const executor = await AgentExecutor.create(
      agentDefinition,
      config,
      onActivity,
    );
    // Create abort controller for cancellation
    const abortController = new AbortController();
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\n\n⚠️  Cancelling agent execution...\n');
      abortController.abort();
    });
    // Run the agent
    const result = await executor.run(
      { task: userTask },
      abortController.signal,
    );
    // Display results
    console.log('\n' + '='.repeat(70));
    console.log('AGENT RESULT');
    console.log('='.repeat(70));
    console.log(`\nStatus: ${result.terminate_reason}\n`);
    console.log(result.result);
    console.log('\n' + '='.repeat(70) + '\n');
    // Exit with appropriate code
    if (result.terminate_reason === 'GOAL') {
      process.exit(0);
    } else {
      console.error(
        `\nAgent did not complete successfully: ${result.terminate_reason}`,
      );
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Agent execution failed:');
    console.error(error instanceof Error ? error.message : String(error));
    if (config.getDebugMode() && error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}
//# sourceMappingURL=runAgentNonInteractive.js.map
