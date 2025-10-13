/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// DISCLAIMER: This is a copied version of https://github.com/googleapis/js-genai/blob/main/src/chats.ts with the intention of working around a key bug
// where function responses are not treated as "valid" responses: https://b.corp.google.com/issues/420354090

import {
  GenerateContentResponse,
  type Content,
  type GenerateContentConfig,
  type SendMessageParameters,
  type Part,
  type Tool,
  FinishReason,
} from '@google/genai';
import { toParts } from '../code_assist/converter.js';
import { createUserContent } from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import type { Config } from '../config/config.js';
import { getEffectiveModel } from '../config/models.js';
import { hasCycleInSchema, MUTATOR_KINDS } from '../tools/tools.js';
import type { StructuredError } from './turn.js';
import {
  logContentRetry,
  logContentRetryFailure,
} from '../telemetry/loggers.js';
import { tokenLimit } from './tokenLimits.js';
import { ChatRecordingService } from '../services/chatRecordingService.js';
import {
  ContentRetryEvent,
  ContentRetryFailureEvent,
} from '../telemetry/types.js';
import { handleFallback } from '../fallback/handler.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { partListUnionToString } from './geminiRequest.js';
import { uiTelemetryService } from '../telemetry/uiTelemetry.js';
import { injectProjectStandards } from '../utils/projectStandardsInjector.js';

export enum StreamEventType {
  /** A regular content chunk from the API. */
  CHUNK = 'chunk',
  /** A signal that a retry is about to happen. The UI should discard any partial
   * content from the attempt that just failed. */
  RETRY = 'retry',
}

export type StreamEvent =
  | { type: StreamEventType.CHUNK; value: GenerateContentResponse }
  | { type: StreamEventType.RETRY; error?: string };

/**
 * Options for retrying due to invalid content from the model.
 */
interface ContentRetryOptions {
  /** Total number of attempts to make (1 initial + N retries). */
  maxAttempts: number;
  /** The base delay in milliseconds for linear backoff. */
  initialDelayMs: number;
}

const INVALID_CONTENT_RETRY_OPTIONS: ContentRetryOptions = {
  maxAttempts: 3, // 1 initial call + 2 retries (especially for Flash throttling)
  initialDelayMs: 500,
};

/**
 * Returns true if the response is valid, false otherwise.
 */
function isValidResponse(response: GenerateContentResponse): boolean {
  if (response.candidates === undefined || response.candidates.length === 0) {
    return false;
  }
  const content = response.candidates[0]?.content;
  if (content === undefined) {
    return false;
  }
  return isValidContent(content);
}

export function isValidNonThoughtTextPart(part: Part): boolean {
  return (
    typeof part.text === 'string' &&
    !part.thought &&
    // Technically, the model should never generate parts that have text and
    //  any of these but we don't trust them so check anyways.
    !part.functionCall &&
    !part.functionResponse &&
    !part.inlineData &&
    !part.fileData
  );
}

function isValidContent(content: Content): boolean {
  if (content.parts === undefined || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (part === undefined || Object.keys(part).length === 0) {
      return false;
    }
    if (!part.thought && part.text !== undefined && part.text === '') {
      return false;
    }
  }
  return true;
}

/**
 * Validates the history contains the correct roles.
 *
 * @throws Error if the history does not start with a user turn.
 * @throws Error if the history contains an invalid role.
 */
function validateHistory(history: Content[]) {
  for (const content of history) {
    if (content.role !== 'user' && content.role !== 'model') {
      throw new Error(`Role must be user or model, but got ${content.role}.`);
    }
  }
}

/**
 * Extracts the curated (valid) history from a comprehensive history.
 *
 * @remarks
 * The model may sometimes generate invalid or empty contents(e.g., due to safety
 * filters or recitation). Extracting valid turns from the history
 * ensures that subsequent requests could be accepted by the model.
 */
function extractCuratedHistory(comprehensiveHistory: Content[]): Content[] {
  if (comprehensiveHistory === undefined || comprehensiveHistory.length === 0) {
    return [];
  }
  const curatedHistory: Content[] = [];
  const length = comprehensiveHistory.length;
  let i = 0;
  while (i < length) {
    if (comprehensiveHistory[i].role === 'user') {
      curatedHistory.push(comprehensiveHistory[i]);
      i++;
    } else {
      const modelOutput: Content[] = [];
      let isValid = true;
      while (i < length && comprehensiveHistory[i].role === 'model') {
        modelOutput.push(comprehensiveHistory[i]);
        if (isValid && !isValidContent(comprehensiveHistory[i])) {
          isValid = false;
        }
        i++;
      }
      if (isValid) {
        curatedHistory.push(...modelOutput);
      }
    }
  }
  return curatedHistory;
}

/**
 * Custom error to signal that a stream completed with invalid content,
 * which should trigger a retry.
 */
export class InvalidStreamError extends Error {
  readonly type: 'NO_FINISH_REASON' | 'NO_RESPONSE_TEXT';
  readonly finishReason?: FinishReason;
  readonly shouldRetry: boolean;

  constructor(
    message: string,
    type: 'NO_FINISH_REASON' | 'NO_RESPONSE_TEXT',
    finishReason?: FinishReason,
    shouldRetry: boolean = true,
  ) {
    super(message);
    this.name = 'InvalidStreamError';
    this.type = type;
    this.finishReason = finishReason;
    this.shouldRetry = shouldRetry;
  }
}

/**
 * Estimates token count for content using the approximation: 1 token ≈ 4 characters.
 * This is a fast, local estimation that doesn't require an API call.
 */
function estimateTokenCount(contents: Content[]): number {
  let totalChars = 0;

  for (const content of contents) {
    if (!content.parts) continue;

    for (const part of content.parts) {
      if (part.text) {
        totalChars += part.text.length;
      }
      // Note: We don't estimate tokens for images, files, etc.
      // Those would need the actual countTokens API
    }
  }

  return Math.ceil(totalChars / 4);
}

/**
 * Estimates token count for a string.
 */
function estimateStringTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

interface ContextSizeInfo {
  total: number;
  history: number;
  systemInstruction: number;
  tools: number;
  breakdown: string;
}

/**
 * Analyzes context size and returns breakdown.
 */
function analyzeContextSize(
  history: Content[],
  systemInstruction: string | undefined,
  tools: Tool[] | undefined,
): ContextSizeInfo {
  const historyTokens = estimateTokenCount(history);
  const systemTokens = estimateStringTokens(systemInstruction);
  const toolsTokens = tools ? estimateStringTokens(JSON.stringify(tools)) : 0;
  const total = historyTokens + systemTokens + toolsTokens;

  const breakdown =
    `Context size: ~${(total / 1000).toFixed(1)}K tokens\n` +
    `  • History: ${(historyTokens / 1000).toFixed(1)}K tokens\n` +
    `  • System: ${(systemTokens / 1000).toFixed(1)}K tokens\n` +
    `  • Tools: ${(toolsTokens / 1000).toFixed(1)}K tokens`;

  return {
    total,
    history: historyTokens,
    systemInstruction: systemTokens,
    tools: toolsTokens,
    breakdown,
  };
}

interface TrimResult {
  trimmedHistory: Content[];
  warning?: string;
  breakdown?: string;
}

/**
 * Proactively checks context size and trims if necessary to prevent API failures.
 * Uses smart prioritization: trims oldest conversation history first.
 */
function checkAndTrimContext(
  model: string,
  history: Content[],
  systemInstruction: string | undefined,
  tools: Tool[] | undefined,
): TrimResult {
  const limit = tokenLimit(model);
  const safeLimit = Math.floor(limit * 0.7); // Use 70% of limit as safety threshold

  const sizeInfo = analyzeContextSize(history, systemInstruction, tools);

  if (sizeInfo.total < safeLimit) {
    return { trimmedHistory: history };
  }

  // Context is too large - need to trim
  const tokensToRemove = sizeInfo.total - safeLimit;

  // Strategy: Trim oldest conversation history first (keep at least last 2 turns)
  const minHistoryToKeep = Math.min(4, history.length); // Keep last 2 turns (user + model)
  let removedTokens = 0;
  let trimIndex = 0;

  for (let i = 0; i < history.length - minHistoryToKeep; i++) {
    const msgTokens = estimateTokenCount([history[i]]);
    removedTokens += msgTokens;
    trimIndex = i + 1;

    if (removedTokens >= tokensToRemove) {
      break;
    }
  }

  if (removedTokens < tokensToRemove) {
    // Even after trimming all old history, still too large
    // This means system instruction or tools are too large
    return {
      trimmedHistory: history.slice(trimIndex),
      warning:
        `⚠️  Context too large (~${(sizeInfo.total / 1000).toFixed(1)}K tokens, limit: ${(limit / 1000).toFixed(0)}K).\n` +
        `Trimmed ${Math.floor(trimIndex / 2)} conversation turn(s), but context is still large.\n` +
        `Consider:\n` +
        `  • Starting a new chat session (/clear)\n` +
        `  • Reducing system instructions\n` +
        `  • Disabling unused tools`,
      breakdown: sizeInfo.breakdown,
    };
  }

  const removedTurns = Math.floor(trimIndex / 2);

  return {
    trimmedHistory: history.slice(trimIndex),
    warning: `⚠️  Context approaching limit. Trimmed ${removedTurns} older conversation turn(s) to prevent errors.`,
    breakdown: sizeInfo.breakdown,
  };
}

/**
 * Chat session that enables sending messages to the model with previous
 * conversation context.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 */
export class GeminiChat {
  // A promise to represent the current state of the message being sent to the
  // model.
  private sendPromise: Promise<void> = Promise.resolve();
  private readonly chatRecordingService: ChatRecordingService;

  constructor(
    private readonly config: Config,
    private readonly generationConfig: GenerateContentConfig = {},
    private history: Content[] = [],
  ) {
    validateHistory(history);
    this.chatRecordingService = new ChatRecordingService(config);
    this.chatRecordingService.initialize();
  }

  setSystemInstruction(sysInstr: string) {
    this.generationConfig.systemInstruction = sysInstr;
  }

  /**
   * Sends a message to the model and returns the response in chunks.
   *
   * @remarks
   * This method will wait for the previous message to be processed before
   * sending the next message.
   *
   * @see {@link Chat#sendMessage} for non-streaming method.
   * @param params - parameters for sending the message.
   * @return The model's response.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
   * const response = await chat.sendMessageStream({
   * message: 'Why is the sky blue?'
   * });
   * for await (const chunk of response) {
   * console.log(chunk.text);
   * }
   * ```
   */
  async sendMessageStream(
    model: string,
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>> {
    await this.sendPromise;

    let streamDoneResolver: () => void;
    const streamDonePromise = new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    });
    this.sendPromise = streamDonePromise;

    // Inject project standards context if applicable
    let messageWithContext = params.message;
    // Extract text from PartListUnion for context injection
    if (Array.isArray(params.message)) {
      const textParts = params.message.filter(
        (part: Part | string) =>
          typeof part === 'string' ||
          (typeof part === 'object' && 'text' in part && part.text),
      );
      if (textParts.length > 0) {
        const firstTextPart = textParts[0];
        const originalText =
          typeof firstTextPart === 'string'
            ? firstTextPart
            : firstTextPart.text;

        const workingDir = this.config.getTargetDir();
        const textWithContext = await injectProjectStandards(
          originalText,
          workingDir,
        );

        // Replace the first text part with context-injected version
        if (typeof textParts[0] === 'string') {
          messageWithContext = params.message.map((part: Part | string) =>
            part === textParts[0] ? textWithContext : part,
          );
        } else {
          messageWithContext = params.message.map((part: Part | string) =>
            part === textParts[0] ? { ...part, text: textWithContext } : part,
          );
        }
      }
    } else if (typeof params.message === 'string') {
      const workingDir = this.config.getTargetDir();
      messageWithContext = await injectProjectStandards(
        params.message,
        workingDir,
      );
    }

    const userContent = createUserContent(messageWithContext);

    // Record user input - capture complete message with all parts (text, files, images, etc.)
    // but skip recording function responses (tool call results) as they should be stored in tool call records
    if (!isFunctionResponse(userContent)) {
      const userMessage = Array.isArray(params.message)
        ? params.message
        : [params.message];
      const userMessageContent = partListUnionToString(toParts(userMessage));
      this.chatRecordingService.recordMessage({
        model,
        type: 'user',
        content: userMessageContent,
      });
    }

    // Add user content to history ONCE before any attempts.
    this.history.push(userContent);
    let requestContents = this.getHistory(true);

    // Trim old tool results to save tokens
    requestContents = this.trimOldToolResults(requestContents);

    // Proactively check and trim context if needed
    const { trimmedHistory, warning, breakdown } = checkAndTrimContext(
      model,
      requestContents,
      this.generationConfig.systemInstruction,
      this.generationConfig.tools,
    );

    requestContents = trimmedHistory;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (async function* () {
      // Show warning to user if trimming occurred
      if (warning) {
        console.warn('\n' + warning);
        if (breakdown && self.config.getDebugMode()) {
          console.warn(breakdown + '\n');
        }
      }

      try {
        let lastError: unknown = new Error('Request failed after all retries.');

        // Start with Pro retry limits, but will adjust dynamically if we fall back to Flash
        const MAX_FLASH_ATTEMPTS = 4; // Flash: 1 initial + 3 retries
        const MAX_PRO_ATTEMPTS = INVALID_CONTENT_RETRY_OPTIONS.maxAttempts; // Pro: 1 initial + 2 retries

        for (let attempt = 0; attempt < MAX_FLASH_ATTEMPTS; attempt++) {
          try {
            if (attempt > 0) {
              // Include error message from previous attempt in retry event
              const errorMessage =
                lastError instanceof Error
                  ? lastError.message
                  : String(lastError);
              yield { type: StreamEventType.RETRY, error: errorMessage };
            }

            const stream = await self.makeApiCallAndProcessStream(
              model,
              requestContents,
              params,
              prompt_id,
            );

            for await (const chunk of stream) {
              yield { type: StreamEventType.CHUNK, value: chunk };
            }

            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const isContentError = error instanceof InvalidStreamError;

            // Check if this error should be retried (e.g., not safety/recitation blocks)
            const shouldRetryError =
              isContentError && (error as InvalidStreamError).shouldRetry;

            // Check dynamically: use Flash limits if in fallback mode, otherwise Pro limits
            const maxAttempts = self.config.isInFallbackMode()
              ? MAX_FLASH_ATTEMPTS
              : MAX_PRO_ATTEMPTS;

            if (shouldRetryError) {
              // Check if we have more attempts left.
              if (attempt < maxAttempts - 1) {
                // Retry delays: Flash gets slightly longer delays but not excessive
                // Most Flash issues are transient throttling, not hard quota limits
                let retryDelay;
                if (self.config.isInFallbackMode()) {
                  // Flash: 5s, 10s, 15s (transient throttling clears quickly)
                  retryDelay = 5000 * (attempt + 1);
                } else {
                  // Pro: 500ms, 1s, 1.5s (shorter delays for non-fallback)
                  retryDelay =
                    INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs *
                    (attempt + 1);
                }

                const totalSeconds = Math.round(retryDelay / 1000);
                const modelName = self.config.isInFallbackMode()
                  ? 'Flash'
                  : 'Pro';

                console.log(
                  `\n[RETRY] ${modelName} returned empty response. (attempt ${attempt + 1}/${maxAttempts})`,
                );

                logContentRetry(
                  self.config,
                  new ContentRetryEvent(
                    attempt,
                    (error as InvalidStreamError).type,
                    retryDelay,
                    model,
                  ),
                );

                // Show countdown every 5 seconds
                let remaining = totalSeconds;
                console.log(`⏳ Waiting ${remaining}s before retry...`);

                while (remaining > 0) {
                  // Wait 5 seconds or remaining time, whichever is less
                  const waitTime = Math.min(5, remaining);
                  await new Promise((res) => setTimeout(res, waitTime * 1000));
                  remaining -= waitTime;

                  if (remaining > 0) {
                    console.log(`⏳ Waiting ${remaining}s before retry...`);
                  }
                }

                console.log('🔄 Retrying now...\n');
                continue;
              }
            }
            break;
          }
        }

        if (lastError) {
          if (lastError instanceof InvalidStreamError) {
            logContentRetryFailure(
              self.config,
              new ContentRetryFailureEvent(
                INVALID_CONTENT_RETRY_OPTIONS.maxAttempts,
                (lastError as InvalidStreamError).type,
                model,
              ),
            );
          }
          // If the stream fails, remove the user message that was added.
          if (self.history[self.history.length - 1] === userContent) {
            self.history.pop();
          }
          throw lastError;
        }
      } finally {
        streamDoneResolver!();
      }
    })();
  }

  private async makeApiCallAndProcessStream(
    model: string,
    requestContents: Content[],
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const apiCall = () => {
      const modelToUse = getEffectiveModel(
        this.config.isInFallbackMode(),
        model,
      );

      console.log('[API CALL DEBUG] Calling API with model:', modelToUse);
      console.log(
        '[API CALL DEBUG] isInFallbackMode:',
        this.config.isInFallbackMode(),
      );
      console.log('[API CALL DEBUG] requested model:', model);

      return this.config.getContentGenerator().generateContentStream(
        {
          model: modelToUse,
          contents: requestContents,
          config: { ...this.generationConfig, ...params.config },
        },
        prompt_id,
      );
    };

    const onPersistent429Callback = async (
      authType?: string,
      error?: unknown,
    ) => await handleFallback(this.config, model, authType, error);

    const streamResponse = await retryWithBackoff(apiCall, {
      onPersistent429: onPersistent429Callback,
      authType: this.config.getContentGeneratorConfig()?.authType,
    });

    return this.processStreamResponse(model, streamResponse);
  }

  /**
   * Returns the chat history.
   *
   * @remarks
   * The history is a list of contents alternating between user and model.
   *
   * There are two types of history:
   * - The `curated history` contains only the valid turns between user and
   * model, which will be included in the subsequent requests sent to the model.
   * - The `comprehensive history` contains all turns, including invalid or
   * empty model outputs, providing a complete record of the history.
   *
   * The history is updated after receiving the response from the model,
   * for streaming response, it means receiving the last chunk of the response.
   *
   * The `comprehensive history` is returned by default. To get the `curated
   * history`, set the `curated` parameter to `true`.
   *
   * @param curated - whether to return the curated history or the comprehensive
   * history.
   * @return History contents alternating between user and model for the entire
   * chat session.
   */
  getHistory(curated: boolean = false): Content[] {
    const history = curated
      ? extractCuratedHistory(this.history)
      : this.history;
    // Deep copy the history to avoid mutating the history outside of the
    // chat session.
    return structuredClone(history);
  }

  /**
   * Clears the chat history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Adds a new entry to the chat history.
   */
  addHistory(content: Content): void {
    this.history.push(content);
  }

  setHistory(history: Content[]): void {
    this.history = history;
  }

  stripThoughtsFromHistory(): void {
    this.history = this.history.map((content) => {
      const newContent = { ...content };
      if (newContent.parts) {
        newContent.parts = newContent.parts.map((part) => {
          if (part && typeof part === 'object' && 'thoughtSignature' in part) {
            const newPart = { ...part };
            delete (newPart as { thoughtSignature?: string }).thoughtSignature;
            return newPart;
          }
          return part;
        });
      }
      return newContent;
    });
  }

  setTools(tools: Tool[]): void {
    this.generationConfig.tools = tools;
  }

  /**
   * Trims old tool results (functionResponse) from history to save tokens.
   * Keeps recent tool results (last 4 contents = 2 turns) in full.
   * Older tool results are replaced with brief summaries.
   */
  private trimOldToolResults(contents: Content[]): Content[] {
    if (contents.length <= 4) {
      return contents; // Keep everything if conversation is short
    }

    // Keep last 4 contents (approximately 2 user-model turn pairs) at full size
    const recentCount = 4;
    const recentContents = contents.slice(-recentCount);
    const olderContents = contents.slice(0, -recentCount);

    const trimmedOlderContents = olderContents.map((content) => {
      if (content.role !== 'user') {
        return content; // Don't trim model responses
      }

      const hasFunctionResponse = content.parts?.some(
        (part) => part.functionResponse,
      );

      if (!hasFunctionResponse) {
        return content; // No tool results to trim
      }

      // Trim functionResponse parts
      const trimmedParts = content.parts?.map((part) => {
        if (!part.functionResponse) {
          return part; // Keep non-tool parts as-is
        }

        const response = part.functionResponse.response;
        const output = response?.output;

        if (typeof output !== 'string' || output.length < 1000) {
          return part; // Already small, keep as-is
        }

        // Replace large output with summary
        const toolName = part.functionResponse.name || 'unknown_tool';
        const outputPreview = output.substring(0, 200);
        const summary = `[Tool result truncated: ${toolName} returned ${output.length} chars. First 200 chars: ${outputPreview}...]`;

        return {
          functionResponse: {
            ...part.functionResponse,
            response: { output: summary },
          },
        };
      });

      return {
        ...content,
        parts: trimmedParts,
      };
    });

    return [...trimmedOlderContents, ...recentContents];
  }

  async maybeIncludeSchemaDepthContext(error: StructuredError): Promise<void> {
    // Check for potentially problematic cyclic tools with cyclic schemas
    // and include a recommendation to remove potentially problematic tools.
    if (
      isSchemaDepthError(error.message) ||
      isInvalidArgumentError(error.message)
    ) {
      const tools = this.config.getToolRegistry().getAllTools();
      const cyclicSchemaTools: string[] = [];
      for (const tool of tools) {
        if (
          (tool.schema.parametersJsonSchema &&
            hasCycleInSchema(tool.schema.parametersJsonSchema)) ||
          (tool.schema.parameters && hasCycleInSchema(tool.schema.parameters))
        ) {
          cyclicSchemaTools.push(tool.displayName);
        }
      }
      if (cyclicSchemaTools.length > 0) {
        const extraDetails =
          `\n\nThis error was probably caused by cyclic schema references in one of the following tools, try disabling them with excludeTools:\n\n - ` +
          cyclicSchemaTools.join(`\n - `) +
          `\n`;
        error.message += extraDetails;
      }
    }
  }

  private async *processStreamResponse(
    model: string,
    streamResponse: AsyncGenerator<GenerateContentResponse>,
  ): AsyncGenerator<GenerateContentResponse> {
    const modelResponseParts: Part[] = [];

    let hasToolCall = false;
    let hasFinishReason = false;
    let lastFinishReason: FinishReason | undefined;

    // Detect local LLM server for longer first-chunk timeout (model loading)
    const authType = this.config.getContentGeneratorConfig()?.authType;
    const isOllama = authType === 'local';

    // Timeout strategy:
    // - Ollama: 90s for first chunk (model loading), then 30s for subsequent chunks
    // - Flash fallback: 10s (throttling usually fails fast)
    // - Pro/others: 30s
    const FIRST_CHUNK_TIMEOUT_MS = isOllama ? 90000 : 30000; // 90s for Ollama first load
    const SUBSEQUENT_CHUNK_TIMEOUT_MS = this.config.isInFallbackMode()
      ? 10000
      : 30000; // 10s for Flash, 30s for others
    const MAX_CHUNKS = 1000; // Maximum chunks to prevent infinite loops
    let chunkCount = 0;
    const streamIterator = this.stopBeforeSecondMutator(streamResponse);

    try {
      while (true) {
        chunkCount++;

        // Safety limit: prevent infinite streaming loops
        if (chunkCount > MAX_CHUNKS) {
          console.warn(
            `[STREAM DEBUG] Reached maximum chunk limit (${MAX_CHUNKS}). Aborting stream to prevent infinite loop.`,
          );
          break;
        }

        console.log('[STREAM DEBUG] Waiting for next chunk...');
        // Wrap each chunk read with a timeout
        // Use longer timeout for first chunk (Ollama model loading), shorter for subsequent
        const chunkTimeout =
          chunkCount === 1
            ? FIRST_CHUNK_TIMEOUT_MS
            : SUBSEQUENT_CHUNK_TIMEOUT_MS;

        const timeoutPromise = new Promise<{ done: true; value: undefined }>(
          (_, reject) =>
            setTimeout(
              () => reject(new Error('Stream chunk timeout')),
              chunkTimeout,
            ),
        );

        const chunkPromise = streamIterator.next();

        let result;
        try {
          result = await Promise.race([chunkPromise, timeoutPromise]);
          console.log('[STREAM DEBUG] Chunk received, done:', result.done);
        } catch (_timeoutError) {
          const timeoutSeconds = Math.round(chunkTimeout / 1000);
          console.warn(
            `[STREAM DEBUG] Stream stalled - no chunks received for ${timeoutSeconds} seconds. Treating as incomplete stream.`,
          );
          // Stream stalled, break out and handle validation below
          break;
        }

        if (result.done) {
          console.log('[STREAM DEBUG] Stream complete');
          break;
        }

        const chunk = result.value;

        // Debug logging
        const chunkInfo = {
          hasCandidate: !!chunk?.candidates?.[0],
          hasParts: !!chunk?.candidates?.[0]?.content?.parts,
          partsCount: chunk?.candidates?.[0]?.content?.parts?.length || 0,
          hasFinishReason: !!chunk?.candidates?.[0]?.finishReason,
          finishReason: chunk?.candidates?.[0]?.finishReason,
        };
        console.log(
          '[STREAM DEBUG] Received chunk:',
          JSON.stringify(chunkInfo),
        );

        hasFinishReason =
          chunk?.candidates?.some((candidate) => candidate.finishReason) ??
          false;

        // Capture the last finish reason we see
        if (chunk?.candidates?.[0]?.finishReason) {
          lastFinishReason = chunk.candidates[0].finishReason;
        }

        if (isValidResponse(chunk)) {
          const content = chunk.candidates?.[0]?.content;
          if (content?.parts) {
            if (content.parts.some((part) => part.thought)) {
              // Record thoughts
              this.recordThoughtFromContent(content);
            }
            if (content.parts.some((part) => part.functionCall)) {
              hasToolCall = true;
              console.log('[STREAM DEBUG] Tool call detected');
            }

            modelResponseParts.push(
              ...content.parts.filter((part) => !part.thought),
            );
          }
        }

        // Record token usage if this chunk has usageMetadata
        if (chunk.usageMetadata) {
          this.chatRecordingService.recordMessageTokens(chunk.usageMetadata);
          if (chunk.usageMetadata.promptTokenCount !== undefined) {
            uiTelemetryService.setLastPromptTokenCount(
              chunk.usageMetadata.promptTokenCount,
            );
          }
        }

        yield chunk; // Yield every chunk to the UI immediately.
        console.log('[STREAM DEBUG] Chunk yielded, waiting for next...');
      }
    } catch (error) {
      console.error('Stream processing error:', error);
      throw error;
    }

    // String thoughts and consolidate text parts.
    const consolidatedParts: Part[] = [];
    for (const part of modelResponseParts) {
      const lastPart = consolidatedParts[consolidatedParts.length - 1];
      if (
        lastPart?.text &&
        isValidNonThoughtTextPart(lastPart) &&
        isValidNonThoughtTextPart(part)
      ) {
        lastPart.text += part.text;
      } else {
        consolidatedParts.push(part);
      }
    }

    const responseText = consolidatedParts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join('')
      .trim();

    // Record model response text from the collected parts
    if (responseText) {
      this.chatRecordingService.recordMessage({
        model,
        type: 'gemini',
        content: responseText,
      });
    }

    // Stream validation logic: A stream is considered successful if:
    // 1. There's a tool call (tool calls can end without explicit finish reasons), OR
    // 2. There's a finish reason AND we have non-empty response text
    //
    // We throw an error only when there's no tool call AND:
    // - No finish reason, OR
    // - Empty response text (e.g., only thoughts with no actual content)
    if (!hasToolCall && (!hasFinishReason || !responseText)) {
      if (!hasFinishReason) {
        // Special error message for local LLM servers
        if (isOllama) {
          // Detect which local server type based on the content generator
          let contentGen: any = this.config.getContentGenerator();

          // Unwrap LoggingContentGenerator if present
          if (contentGen && typeof contentGen.getWrapped === 'function') {
            contentGen = contentGen.getWrapped();
          }

          const isLlamaCpp =
            contentGen.constructor.name === 'LlamaCppContentGenerator';

          const serverType = isLlamaCpp ? 'llama.cpp' : 'Ollama';
          const defaultUrl = isLlamaCpp
            ? 'http://localhost:8000'
            : 'http://localhost:11434';
          const apiPath = isLlamaCpp ? '/v1/chat/completions' : '/api/chat';
          const curlExample =
            `curl -X POST ${defaultUrl}${apiPath} \\\n` +
            `       -H "Content-Type: application/json" \\\n` +
            `       -d '{"model": "<your-model>", "messages": [{"role": "user", "content": "Say hello"}], "stream": true}'`;

          throw new InvalidStreamError(
            `❌ LOCAL LLM ERROR: Stream timed out without receiving any response\n\n` +
              `Server type: ${serverType}\n\n` +
              `Troubleshooting:\n` +
              `  1. Check if the ${serverType} server is running and accessible\n` +
              `  2. Try a simpler test request first:\n` +
              `     ${curlExample}\n\n` +
              `  3. The server may be timing out on complex requests with tools/system instructions\n` +
              `  4. Check server logs for errors or configuration issues\n` +
              `  5. Consider:\n` +
              `     • Reducing the number of tools available to the agent\n` +
              `     • Using a more capable model (e.g., qwen2.5-coder:32b instead of 7b)\n` +
              `     • Increasing server timeout settings if available`,
            'NO_FINISH_REASON',
          );
        }

        throw new InvalidStreamError(
          'Model stream ended without a finish reason.\n\n' +
            'This can happen due to:\n' +
            '  • Temporary API issues (try again in a moment)\n' +
            '  • Rate limiting (wait 30-60 seconds)\n' +
            '  • Request too large (start a new chat with /clear)\n' +
            '  • Safety filters (try rephrasing your request)',
          'NO_FINISH_REASON',
        );
      } else {
        // Use the finish reason to provide more accurate error classification
        console.log(
          '[EMPTY RESPONSE DEBUG] Finish reason:',
          lastFinishReason,
          'In fallback mode:',
          this.config.isInFallbackMode(),
        );

        // Check finish reason to distinguish between different types of failures
        if (lastFinishReason === FinishReason.SAFETY) {
          // Safety blocks should NOT retry - they will fail the same way again
          throw new InvalidStreamError(
            'Model response was blocked by safety filters.\n\n' +
              'The content violated safety policies. Try:\n' +
              '  • Rephrasing your request in a different way\n' +
              '  • Avoiding sensitive or controversial topics\n' +
              '  • Starting a new chat session (/clear)',
            'NO_RESPONSE_TEXT',
            lastFinishReason,
            false, // Don't retry safety blocks
          );
        }

        if (lastFinishReason === FinishReason.RECITATION) {
          // Recitation blocks should NOT retry - they will fail the same way again
          throw new InvalidStreamError(
            'Model response was blocked due to recitation.\n\n' +
              'The content matched copyrighted material. Try:\n' +
              '  • Asking for a summary or paraphrase instead\n' +
              '  • Requesting original content\n' +
              '  • Starting a new chat session (/clear)',
            'NO_RESPONSE_TEXT',
            lastFinishReason,
            false, // Don't retry recitation blocks
          );
        }

        // For OTHER finish reason or STOP with empty text, check if we're in fallback mode
        // This is more likely to be quota exhaustion if we just switched to Flash
        if (this.config.isInFallbackMode()) {
          throw new InvalidStreamError(
            'Flash model returned empty response (likely quota exhausted).\n\n' +
              'Both Pro and Flash models may have hit quota limits.\n' +
              'Please wait a moment and send your message again manually.',
            'NO_RESPONSE_TEXT',
            lastFinishReason,
            true, // Do retry for potential quota issues
          );
        }

        // Default empty response error for non-fallback cases
        throw new InvalidStreamError(
          'Model stream ended with empty response text.\n\n' +
            'This usually means:\n' +
            '  • Content was filtered by safety systems\n' +
            '  • Request was too complex or large\n' +
            '  • Temporary API issue\n\n' +
            'Try:\n' +
            '  • Rephrasing your request\n' +
            '  • Starting a new chat session (/clear)\n' +
            '  • Waiting a moment and trying again',
          'NO_RESPONSE_TEXT',
          lastFinishReason,
          true, // Do retry for other potential transient issues
        );
      }
    }

    this.history.push({ role: 'model', parts: consolidatedParts });
  }

  /**
   * Gets the chat recording service instance.
   */
  getChatRecordingService(): ChatRecordingService {
    return this.chatRecordingService;
  }

  /**
   * Extracts and records thought from thought content.
   */
  private recordThoughtFromContent(content: Content): void {
    if (!content.parts || content.parts.length === 0) {
      return;
    }

    const thoughtPart = content.parts[0];
    if (thoughtPart.text) {
      // Extract subject and description using the same logic as turn.ts
      const rawText = thoughtPart.text;
      const subjectStringMatches = rawText.match(/\*\*(.*?)\*\*/s);
      const subject = subjectStringMatches
        ? subjectStringMatches[1].trim()
        : '';
      const description = rawText.replace(/\*\*(.*?)\*\*/s, '').trim();

      this.chatRecordingService.recordThought({
        subject,
        description,
      });
    }
  }

  /**
   * Truncates the chunkStream right before the second function call to a
   * function that mutates state. This may involve trimming parts from a chunk
   * as well as omtting some chunks altogether.
   *
   * We do this because it improves tool call quality if the model gets
   * feedback from one mutating function call before it makes the next one.
   */
  private async *stopBeforeSecondMutator(
    chunkStream: AsyncGenerator<GenerateContentResponse>,
  ): AsyncGenerator<GenerateContentResponse> {
    let foundMutatorFunctionCall = false;

    try {
      for await (const chunk of chunkStream) {
        const candidate = chunk.candidates?.[0];
        const content = candidate?.content;
        if (!candidate || !content?.parts) {
          yield chunk;
          continue;
        }

        const truncatedParts: Part[] = [];
        for (const part of content.parts) {
          if (this.isMutatorFunctionCall(part)) {
            if (foundMutatorFunctionCall) {
              // This is the second mutator call.
              // Truncate and return immediately, but first drain the stream
              const newChunk = new GenerateContentResponse();
              newChunk.candidates = [
                {
                  ...candidate,
                  content: {
                    ...content,
                    parts: truncatedParts,
                  },
                  finishReason: FinishReason.STOP,
                },
              ];
              yield newChunk;

              // Return early - the finally block will handle cleanup
              return;
            }
            foundMutatorFunctionCall = true;
          }
          truncatedParts.push(part);
        }

        yield chunk;
      }
    } finally {
      // Ensure stream is closed if we exit early
      if (chunkStream.return) {
        await chunkStream.return();
      }
    }
  }

  private isMutatorFunctionCall(part: Part): boolean {
    if (!part?.functionCall?.name) {
      return false;
    }
    const tool = this.config.getToolRegistry().getTool(part.functionCall.name);
    return !!tool && MUTATOR_KINDS.includes(tool.kind);
  }
}

/** Visible for Testing */
export function isSchemaDepthError(errorMessage: string): boolean {
  return errorMessage.includes('maximum schema depth exceeded');
}

export function isInvalidArgumentError(errorMessage: string): boolean {
  return errorMessage.includes('Request contains an invalid argument');
}
