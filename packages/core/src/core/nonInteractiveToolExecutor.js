/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CoreToolScheduler } from './coreToolScheduler.js';
import { ToolConfirmationOutcome } from '../tools/tools.js';
import * as readline from 'node:readline';
/**
 * Prompts the user for approval of a tool call via stdin/stdout.
 */
async function promptForApproval(toolCall) {
  if (toolCall.status !== 'awaiting_approval') {
    return ToolConfirmationOutcome.ProceedOnce;
  }
  const { confirmationDetails } = toolCall;
  // Display tool call information
  console.log('\n='.repeat(60));
  console.log('Tool Approval Required');
  console.log('='.repeat(60));
  console.log(`Tool: ${toolCall.request.name}`);
  if (confirmationDetails.type === 'edit') {
    console.log(`File: ${confirmationDetails.fileName}`);
    if (confirmationDetails.fileDiff) {
      console.log('\nChanges:');
      console.log(confirmationDetails.fileDiff);
    }
  } else if (confirmationDetails.type === 'exec') {
    console.log(`Command: ${confirmationDetails.command}`);
  } else if (confirmationDetails.type === 'mcp') {
    console.log(`Server: ${confirmationDetails.serverName}`);
    console.log(`Tool: ${confirmationDetails.toolName}`);
  } else if (confirmationDetails.type === 'info') {
    console.log(`Prompt: ${confirmationDetails.prompt}`);
    if (confirmationDetails.urls && confirmationDetails.urls.length > 0) {
      console.log(`URLs: ${confirmationDetails.urls.join(', ')}`);
    }
  }
  console.log('\n' + '='.repeat(60));
  console.log('Options:');
  console.log('  y - Proceed once');
  console.log('  a - Proceed always (auto-approve this tool for the session)');
  console.log('  n - Cancel (reject this tool call)');
  console.log('='.repeat(60));
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question('\nYour choice [y/a/n]: ', (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();
      if (choice === 'y') {
        console.log('✓ Approved (once)\n');
        resolve(ToolConfirmationOutcome.ProceedOnce);
      } else if (choice === 'a') {
        console.log('✓ Approved (always for this tool)\n');
        resolve(ToolConfirmationOutcome.ProceedAlways);
      } else {
        console.log('✗ Cancelled\n');
        resolve(ToolConfirmationOutcome.Cancel);
      }
    });
  });
}
/**
 * Executes a single tool call non-interactively by leveraging the CoreToolScheduler.
 */
export async function executeToolCall(config, toolCallRequest, abortSignal) {
  return new Promise((resolve, reject) => {
    const scheduler = new CoreToolScheduler({
      config,
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (completedToolCalls) => {
        resolve(completedToolCalls[0].response);
      },
      onToolCallsUpdate: async (toolCalls) => {
        // Check if any tool call is awaiting approval
        const waitingTool = toolCalls.find(
          (tc) => tc.status === 'awaiting_approval',
        );
        if (waitingTool && waitingTool.status === 'awaiting_approval') {
          const { confirmationDetails } = waitingTool;
          // Prompt user for approval
          const outcome = await promptForApproval(waitingTool);
          // Call the tool's confirmation handler
          await scheduler.handleConfirmationResponse(
            waitingTool.request.callId,
            confirmationDetails.onConfirm,
            outcome,
            abortSignal,
          );
        }
      },
    });
    scheduler.schedule(toolCallRequest, abortSignal).catch(reject);
  });
}
//# sourceMappingURL=nonInteractiveToolExecutor.js.map
