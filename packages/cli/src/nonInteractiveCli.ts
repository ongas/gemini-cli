/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, ToolCallRequestInfo } from '@google/gemini-cli-core';
import { isSlashCommand } from './ui/utils/commandUtils.js';
import type { LoadedSettings } from './config/settings.js';
import {
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  FatalInputError,
  promptIdContext,
  OutputFormat,
  JsonFormatter,
  uiTelemetryService,
  Logger,
} from '@google/gemini-cli-core';

import type { Content, Part } from '@google/genai';

import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';
import {
  handleError,
  handleToolError,
  handleCancellationError,
  handleMaxTurnsExceededError,
} from './utils/errors.js';

export async function runNonInteractive(
  config: Config,
  settings: LoadedSettings,
  input: string,
  prompt_id: string,
  continueSession?: string,
): Promise<void> {
  return promptIdContext.run(prompt_id, async () => {
    const consolePatcher = new ConsolePatcher({
      stderr: true,
      debugMode: config.getDebugMode(),
    });

    try {
      consolePatcher.patch();
      // Handle EPIPE errors when the output is piped to a command that closes early.
      process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') {
          // Exit gracefully if the pipe is closed.
          process.exit(0);
        }
      });

      const geminiClient = config.getGeminiClient();

      const abortController = new AbortController();

      let query: Part[] | undefined;

      if (isSlashCommand(input)) {
        const slashCommandResult = await handleSlashCommand(
          input,
          abortController,
          config,
          settings,
        );
        // If a slash command is found and returns a prompt, use it.
        // Otherwise, slashCommandResult fall through to the default prompt
        // handling.
        if (slashCommandResult) {
          query = slashCommandResult as Part[];
        }
      }

      if (!query) {
        const { processedQuery, shouldProceed } = await handleAtCommand({
          query: input,
          config,
          addItem: (_item, _timestamp) => 0,
          onDebugMessage: () => {},
          messageId: Date.now(),
          signal: abortController.signal,
        });

        if (!shouldProceed || !processedQuery) {
          // An error occurred during @include processing (e.g., file not found).
          // The error message is already logged by handleAtCommand.
          throw new FatalInputError(
            'Exiting due to an error processing the @ command.',
          );
        }
        query = processedQuery as Part[];
      }

      // Load previous conversation history if continuing a session
      const sessionTag = continueSession || 'gemini-non-interactive-session';
      const logger = new Logger(config.getSessionId(), config.storage);

      if (continueSession) {
        try {
          const loadedHistory = await logger.loadCheckpoint(continueSession);
          if (loadedHistory && loadedHistory.length > 0) {
            // Set the loaded history on the Gemini client
            geminiClient.setHistory(loadedHistory);
            if (config.getDebugMode()) {
              console.log(
                `[DEBUG] Loaded ${loadedHistory.length} messages from session '${continueSession}'`,
              );
            }
          }
        } catch (error) {
          if (config.getDebugMode()) {
            console.warn(
              `[DEBUG] Could not load session '${continueSession}':`,
              error,
            );
          }
        }
      }

      let currentMessages: Content[] = [{ role: 'user', parts: query }];

      let turnCount = 0;
      while (true) {
        turnCount++;
        if (
          config.getMaxSessionTurns() >= 0 &&
          turnCount > config.getMaxSessionTurns()
        ) {
          handleMaxTurnsExceededError(config);
        }
        const toolCallRequests: ToolCallRequestInfo[] = [];

        const responseStream = geminiClient.sendMessageStream(
          currentMessages[0]?.parts || [],
          abortController.signal,
          prompt_id,
        );

        let responseText = '';
        for await (const event of responseStream) {
          if (abortController.signal.aborted) {
            handleCancellationError(config);
          }

          if (event.type === GeminiEventType.Content) {
            if (config.getOutputFormat() === OutputFormat.JSON) {
              responseText += event.value;
            } else {
              process.stdout.write(event.value);
            }
          } else if (event.type === GeminiEventType.ToolCallRequest) {
            toolCallRequests.push(event.value);
          }
        }

        if (toolCallRequests.length > 0) {
          const toolResponseParts: Part[] = [];
          for (const requestInfo of toolCallRequests) {
            const toolResponse = await executeToolCall(
              config,
              requestInfo,
              abortController.signal,
            );

            if (toolResponse.error) {
              handleToolError(
                requestInfo.name,
                toolResponse.error,
                config,
                toolResponse.errorType || 'TOOL_EXECUTION_ERROR',
                typeof toolResponse.resultDisplay === 'string'
                  ? toolResponse.resultDisplay
                  : undefined,
              );
            }

            if (toolResponse.responseParts) {
              toolResponseParts.push(...toolResponse.responseParts);
            }
          }
          currentMessages = [{ role: 'user', parts: toolResponseParts }];
        } else {
          // Save conversation history for future continuation
          try {
            const currentHistory = geminiClient.getHistory();
            await logger.saveCheckpoint(currentHistory, sessionTag);
            if (config.getDebugMode()) {
              console.log(
                `[DEBUG] Saved ${currentHistory.length} messages to session '${sessionTag}'`,
              );
            }
          } catch (error) {
            if (config.getDebugMode()) {
              console.warn(
                `[DEBUG] Could not save session '${sessionTag}':`,
                error,
              );
            }
          }

          if (config.getOutputFormat() === OutputFormat.JSON) {
            const formatter = new JsonFormatter();
            const stats = uiTelemetryService.getMetrics();
            process.stdout.write(formatter.format(responseText, stats));
          } else {
            process.stdout.write('\n'); // Ensure a final newline
          }
          return;
        }
      }
    } catch (error) {
      handleError(error, config);
    } finally {
      consolePatcher.cleanup();
      if (isTelemetrySdkInitialized()) {
        await shutdownTelemetry(config);
      }
    }
  });
}
