/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolResult,
} from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
const BROWSER_ACTION_TIMEOUT_MS = 300000; // 5 minutes for browser actions

/**
 * Parameters for the BrowserAction tool
 */
export interface BrowserActionToolParams {
  /**
   * Natural language task description for the browser agent
   */
  task: string;

  /**
   * Optional URL to navigate to before executing the task
   */
  url?: string;

  /**
   * Maximum number of steps the agent can take (default: 100)
   */
  max_steps?: number;
}

/**
 * Response from the browser-use API
 */
interface BrowserActionResponse {
  success: boolean;
  result?: string;
  final_result?: unknown;
  steps_taken?: number;
  error?: string;
  screenshots?: string[];
}

class BrowserActionToolInvocation extends BaseToolInvocation<
  BrowserActionToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: BrowserActionToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const displayTask =
      this.params.task.length > 100
        ? this.params.task.substring(0, 97) + '...'
        : this.params.task;
    const urlPart = this.params.url ? ` at ${this.params.url}` : '';
    return `Executing browser action${urlPart}: "${displayTask}"`;
  }

  override async shouldConfirmExecute(): Promise<
    ToolCallConfirmationDetails | false
  > {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Confirm Browser Action`,
      prompt: this.params.url
        ? `Navigate to ${this.params.url} and: ${this.params.task}`
        : this.params.task,
      urls: this.params.url ? [this.params.url] : [],
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    // Primary: Local API with visible browser (port 11236)
    // Fallback: Docker API with headless browser (port 11237)
    const primaryUrl =
      process.env['BROWSER_USE_API_URL'] || 'http://localhost:11236';
    const fallbackUrl = 'http://localhost:11237';

    const requestBody = {
      task: this.params.task,
      url: this.params.url,
      max_steps: this.params.max_steps || 100,
    };

    // Try primary API first, then fallback if it fails
    const urlsToTry = [primaryUrl];
    if (primaryUrl !== fallbackUrl) {
      urlsToTry.push(fallbackUrl);
    }

    let lastError: unknown;
    for (const apiUrl of urlsToTry) {
      const endpoint = `${apiUrl}/browser/action`;

      try {
        // Quick health check first to see if API is available
        const healthCheck = await fetch(`${apiUrl}/health`, {
          signal: AbortSignal.timeout(2000), // 2 second timeout for health check
        }).catch(() => null);

        if (!healthCheck?.ok) {
          // API not responding, try next one
          if (apiUrl === primaryUrl && urlsToTry.length > 1) {
            console.log(
              `Primary browser API (${primaryUrl}) not available, trying fallback (${fallbackUrl})...`,
            );
            continue;
          }
          throw new Error(`API not responding at ${apiUrl}`);
        }

        // Create a combined abort controller that respects both the tool's signal and timeout
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(
          () => timeoutController.abort(),
          BROWSER_ACTION_TIMEOUT_MS,
        );

        // Combine signals if the tool signal is already provided
        const combinedSignal = signal.aborted
          ? signal
          : timeoutController.signal;

        // Listen to the tool signal and abort timeout controller if needed
        if (!signal.aborted) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            timeoutController.abort();
          });
        }

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: combinedSignal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(
              `Browser API request failed with status ${response.status} ${response.statusText}`,
            );
          }

          const result: BrowserActionResponse = await response.json();

          if (!result.success) {
            const errorMessage = result.error || 'Unknown error occurred';
            return {
              llmContent: `Browser action failed: ${errorMessage}`,
              returnDisplay: `Error: ${errorMessage}`,
              error: {
                message: errorMessage,
                type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
              },
            };
          }

          // Format the result for display
          let resultText = '';
          if (result.result) {
            resultText = result.result;
          } else if (result.final_result) {
            resultText = JSON.stringify(result.final_result, null, 2);
          } else {
            resultText = 'Browser action completed successfully';
          }

          const stepsInfo =
            result.steps_taken !== undefined
              ? ` (${result.steps_taken} steps)`
              : '';

          const apiMode = apiUrl.includes('11237')
            ? '(headless)'
            : '(visible browser)';
          return {
            llmContent: resultText,
            returnDisplay: `✅ Browser action completed${stepsInfo} ${apiMode}\n\n${resultText}`,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error: unknown) {
        lastError = error;
        // If this isn't the last URL to try, continue to next
        if (apiUrl !== urlsToTry[urlsToTry.length - 1]) {
          console.log(`Failed to use ${apiUrl}, trying next API...`);
          continue;
        }
        // This was the last option, fall through to error handling
      }
    }

    // All APIs failed
    if (signal.aborted) {
      const errorMessage = 'Browser action was cancelled';
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
        },
      };
    }

    const errorMessage = `Error executing browser action (tried ${urlsToTry.join(', ')}): ${getErrorMessage(lastError)}`;
    console.error(errorMessage, lastError);
    return {
      llmContent: `Error: ${errorMessage}`,
      returnDisplay: `Error: ${errorMessage}`,
      error: {
        message: errorMessage,
        type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
      },
    };
  }
}

/**
 * Implementation of the BrowserAction tool logic
 */
export class BrowserActionTool extends BaseDeclarativeTool<
  BrowserActionToolParams,
  ToolResult
> {
  static readonly Name: string = 'browser_action';

  constructor(private readonly config: Config) {
    super(
      BrowserActionTool.Name,
      'BrowserAction',
      `Executes browser automation tasks using natural language instructions. Can navigate websites, interact with elements, extract information, and perform complex multi-step workflows. Powered by an AI agent that understands web pages and can take actions like clicking, typing, and reading content.

Examples:
- "Navigate to example.com and extract all product names"
- "Go to github.com/user/repo and create a new issue titled 'Bug Report'"
- "Search for 'Python tutorials' on Google and get the top 5 results"
- "Fill out the contact form at example.com/contact with name 'John' and email 'john@example.com'"

The browser action runs in a headless Chromium browser with full JavaScript support. The API endpoint is configurable via BROWSER_USE_API_URL environment variable (default: http://localhost:11236).`,
      Kind.Fetch,
      {
        properties: {
          task: {
            description:
              'Natural language description of what you want the browser to do. Be specific and clear. Include any necessary details like form values, search terms, or extraction criteria.',
            type: 'string',
          },
          url: {
            description:
              'Optional URL to navigate to first. If not provided, the task should include navigation instructions (e.g., "Go to example.com and...")',
            type: 'string',
          },
          max_steps: {
            description:
              'Maximum number of steps the agent can take to complete the task. Default is 100. Increase for complex multi-page workflows.',
            type: 'number',
          },
        },
        required: ['task'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: BrowserActionToolParams,
  ): string | null {
    if (!params.task || params.task.trim() === '') {
      return "The 'task' parameter cannot be empty. Provide a clear natural language description of what the browser should do.";
    }
    if (params.max_steps !== undefined && params.max_steps < 1) {
      return "The 'max_steps' parameter must be at least 1.";
    }
    return null;
  }

  protected createInvocation(
    params: BrowserActionToolParams,
  ): ToolInvocation<BrowserActionToolParams, ToolResult> {
    return new BrowserActionToolInvocation(this.config, params);
  }
}
