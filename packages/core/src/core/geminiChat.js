/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { FinishReason } from '@google/genai';
import { toParts } from '../code_assist/converter.js';
import { createUserContent } from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import { getEffectiveModel } from '../config/models.js';
import { hasCycleInSchema, MUTATOR_KINDS } from '../tools/tools.js';
import { logContentRetry, logContentRetryFailure, } from '../telemetry/loggers.js';
import { tokenLimit } from './tokenLimits.js';
import { ChatRecordingService } from '../services/chatRecordingService.js';
import { ContentRetryEvent, ContentRetryFailureEvent, } from '../telemetry/types.js';
import { handleFallback } from '../fallback/handler.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { partListUnionToString } from './geminiRequest.js';
import { uiTelemetryService } from '../telemetry/uiTelemetry.js';
import { injectProjectStandards } from '../utils/projectStandardsInjector.js';
export var StreamEventType;
(function (StreamEventType) {
    /** A regular content chunk from the API. */
    StreamEventType["CHUNK"] = "chunk";
    /** A signal that a retry is about to happen. The UI should discard any partial
     * content from the attempt that just failed. */
    StreamEventType["RETRY"] = "retry";
})(StreamEventType || (StreamEventType = {}));
const INVALID_CONTENT_RETRY_OPTIONS = {
    maxAttempts: 5, // 1 initial call + 4 retries for quota recovery
    initialDelayMs: 20000, // Start at 20s (5 requests refilled @ 4s/request)
};
/**
 * Returns true if the response is valid, false otherwise.
 */
function isValidResponse(response) {
    if (response.candidates === undefined || response.candidates.length === 0) {
        return false;
    }
    const content = response.candidates[0]?.content;
    if (content === undefined) {
        return false;
    }
    return isValidContent(content);
}
export function isValidNonThoughtTextPart(part) {
    return (typeof part.text === 'string' &&
        !part.thought &&
        // Technically, the model should never generate parts that have text and
        //  any of these but we don't trust them so check anyways.
        !part.functionCall &&
        !part.functionResponse &&
        !part.inlineData &&
        !part.fileData);
}
function isValidContent(content) {
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
function validateHistory(history) {
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
function extractCuratedHistory(comprehensiveHistory) {
    if (comprehensiveHistory === undefined || comprehensiveHistory.length === 0) {
        return [];
    }
    const curatedHistory = [];
    const length = comprehensiveHistory.length;
    let i = 0;
    while (i < length) {
        if (comprehensiveHistory[i].role === 'user') {
            curatedHistory.push(comprehensiveHistory[i]);
            i++;
        }
        else {
            const modelOutput = [];
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
    type;
    finishReason;
    shouldRetry;
    constructor(message, type, finishReason, shouldRetry = true) {
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
function estimateTokenCount(contents) {
    let totalChars = 0;
    for (const content of contents) {
        if (!content.parts)
            continue;
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
function estimateStringTokens(text) {
    if (!text)
        return 0;
    return Math.ceil(text.length / 4);
}
/**
 * Analyzes context size and returns breakdown.
 */
function analyzeContextSize(history, systemInstruction, tools) {
    const historyTokens = estimateTokenCount(history);
    const systemTokens = estimateStringTokens(systemInstruction);
    const toolsTokens = tools ? estimateStringTokens(JSON.stringify(tools)) : 0;
    const total = historyTokens + systemTokens + toolsTokens;
    const breakdown = `Context size: ~${(total / 1000).toFixed(1)}K tokens\n` +
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
/**
 * Proactively checks context size and trims if necessary to prevent API failures.
 * Uses smart prioritization: trims oldest conversation history first.
 */
function checkAndTrimContext(model, history, systemInstruction, tools) {
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
            warning: `⚠️  Context too large (~${(sizeInfo.total / 1000).toFixed(1)}K tokens, limit: ${(limit / 1000).toFixed(0)}K).\n` +
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
function toToolsArray(tools) {
    if (!tools) {
        return undefined;
    }
    if (Array.isArray(tools)) {
        return tools;
    }
    return [tools];
}
/**
 * Chat session that enables sending messages to the model with previous
 * conversation context.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 */
export class GeminiChat {
    config;
    generationConfig;
    history;
    // A promise to represent the current state of the message being sent to the
    // model.
    sendPromise = Promise.resolve();
    chatRecordingService;
    // Track consecutive empty response errors to fail faster on persistent issues
    consecutiveEmptyResponses = 0;
    constructor(config, generationConfig = {}, history = []) {
        this.config = config;
        this.generationConfig = generationConfig;
        this.history = history;
        validateHistory(history);
        this.chatRecordingService = new ChatRecordingService(config);
        this.chatRecordingService.initialize();
    }
    setSystemInstruction(sysInstr) {
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
    async sendMessageStream(model, params, prompt_id) {
        await this.sendPromise;
        let streamDoneResolver;
        const streamDonePromise = new Promise((resolve) => {
            streamDoneResolver = resolve;
        });
        this.sendPromise = streamDonePromise;
        // Inject project standards context if applicable
        let messageWithContext = params.message;
        // Extract text from PartListUnion for context injection
        if (Array.isArray(params.message)) {
            const textParts = params.message.filter((part) => typeof part === 'string' ||
                (typeof part === 'object' && 'text' in part && part.text));
            if (textParts.length > 0) {
                const firstTextPart = textParts[0];
                const originalText = typeof firstTextPart === 'string'
                    ? firstTextPart
                    : (firstTextPart.text ?? '');
                const workingDir = this.config.getTargetDir();
                if (!workingDir) {
                    throw new Error('Working directory is not defined.');
                }
                const textWithContext = await injectProjectStandards(originalText, workingDir);
                // Replace the first text part with context-injected version
                if (typeof textParts[0] === 'string') {
                    messageWithContext = params.message.map((part) => part === textParts[0] ? textWithContext : part);
                }
                else {
                    messageWithContext = params.message.map((part) => {
                        if (part === textParts[0]) {
                            if (typeof part === 'string') {
                                return textWithContext;
                            }
                            else {
                                return { ...part, text: textWithContext };
                            }
                        }
                        return part;
                    });
                }
            }
        }
        else if (typeof params.message === 'string') {
            const workingDir = this.config.getTargetDir();
            if (!workingDir) {
                throw new Error('Working directory is not defined.');
            }
            messageWithContext = await injectProjectStandards(params.message, workingDir);
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
        // Convert systemInstruction to string for token estimation
        const systemInstructionStr = typeof this.generationConfig.systemInstruction === 'string'
            ? this.generationConfig.systemInstruction
            : this.generationConfig.systemInstruction
                ? JSON.stringify(this.generationConfig.systemInstruction)
                : undefined;
        const { trimmedHistory, warning, breakdown } = checkAndTrimContext(model, requestContents, systemInstructionStr, toToolsArray(this.generationConfig.tools));
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
                let lastError = new Error('Request failed after all retries.');
                // Start with Pro retry limits, but will adjust dynamically if we fall back to Flash
                const MAX_FLASH_ATTEMPTS = 2; // Flash: 1 initial + 1 retry (connection issues often resolve with fresh request)
                const MAX_PRO_ATTEMPTS = INVALID_CONTENT_RETRY_OPTIONS.maxAttempts; // Pro: 1 initial + 4 retries
                for (let attempt = 0; attempt < MAX_FLASH_ATTEMPTS; attempt++) {
                    try {
                        if (attempt > 0) {
                            // Include error message from previous attempt in retry event
                            const errorMessage = lastError instanceof Error
                                ? lastError.message
                                : String(lastError);
                            yield { type: StreamEventType.RETRY, error: errorMessage };
                        }
                        // If this is a retry, set temperature to 1 to encourage different output.
                        const currentParams = { ...params };
                        if (attempt > 0) {
                            currentParams.config = {
                                ...currentParams.config,
                                temperature: 1,
                            };
                        }
                        const stream = await self.makeApiCallAndProcessStream(model, requestContents, currentParams, prompt_id);
                        for await (const chunk of stream) {
                            yield { type: StreamEventType.CHUNK, value: chunk };
                        }
                        // Success! Reset empty response counter
                        self.consecutiveEmptyResponses = 0;
                        lastError = null;
                        break;
                    }
                    catch (error) {
                        lastError = error;
                        const isContentError = error instanceof InvalidStreamError;
                        // Check if this error should be retried (e.g., not safety/recitation blocks)
                        const shouldRetryError = isContentError && error.shouldRetry;
                        // Track consecutive empty responses to detect persistent issues
                        const isEmptyResponseError = isContentError &&
                            error.type === 'NO_RESPONSE_TEXT';
                        if (isEmptyResponseError && self.config.isInFallbackMode()) {
                            self.consecutiveEmptyResponses++;
                            console.log(`[RETRY DEBUG] Consecutive empty responses: ${self.consecutiveEmptyResponses}`);
                            // Only give up after many attempts (allow full retry sequence)
                            // The longer delays with exponential backoff should give quota time to recover
                            // Don't fail fast - quota exhaustion needs time, not quick failures
                        }
                        // Check dynamically: use Flash limits if in fallback mode, otherwise Pro limits
                        const maxAttempts = self.config.isInFallbackMode()
                            ? MAX_FLASH_ATTEMPTS
                            : MAX_PRO_ATTEMPTS;
                        if (shouldRetryError) {
                            // Check if we have more attempts left.
                            if (attempt < maxAttempts - 1) {
                                // Retry delays - short delay to allow connection state to clear
                                let retryDelay;
                                if (self.config.isInFallbackMode()) {
                                    // Flash: 5s delay to allow any transient connection issues to clear
                                    // Longer waits don't help as the issue is often connection-level, not quota
                                    retryDelay = 5000;
                                }
                                else {
                                    // Pro: Linear backoff is fine
                                    retryDelay =
                                        INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs *
                                            (attempt + 1);
                                }
                                const totalSeconds = Math.round(retryDelay / 1000);
                                const modelName = self.config.isInFallbackMode()
                                    ? 'Flash'
                                    : 'Pro';
                                console.log(`\n⏳ [RETRY ${attempt + 1}/${maxAttempts}] ${modelName} returned empty response. Waiting ${totalSeconds}s before retry...`);
                                logContentRetry(self.config, new ContentRetryEvent(attempt, error.type, retryDelay, model));
                                // Refresh connection to clear any connection-level rate limiting
                                try {
                                    await self.config.refreshConnection();
                                    console.log('🔌 Refreshed connection, retrying now...\n');
                                }
                                catch (refreshError) {
                                    console.warn('⚠️  Could not refresh connection:', refreshError);
                                    // Still try to retry with existing connection
                                    await new Promise((res) => setTimeout(res, retryDelay));
                                    console.log('🔄 Retrying now...\n');
                                }
                                continue;
                            }
                        }
                        break;
                    }
                }
                if (lastError) {
                    if (lastError instanceof InvalidStreamError) {
                        logContentRetryFailure(self.config, new ContentRetryFailureEvent(INVALID_CONTENT_RETRY_OPTIONS.maxAttempts, lastError.type, model));
                    }
                    // Don't throw - emit error event and let conversation continue
                    const errorMessage = lastError instanceof Error
                        ? lastError.message
                        : String(lastError);
                    yield {
                        type: StreamEventType.RETRY,
                        error: `Request failed after retries: ${errorMessage}\n\nYou can try sending your message again.`
                    };
                    return; // Exit gracefully instead of throwing
                }
            }
            finally {
                streamDoneResolver();
            }
        })();
    }
    async makeApiCallAndProcessStream(model, requestContents, params, prompt_id) {
        const apiCall = () => {
            const modelToUse = getEffectiveModel(this.config.isInFallbackMode(), model);
            console.log('[API CALL DEBUG] Calling API with model:', modelToUse);
            console.log('[API CALL DEBUG] isInFallbackMode:', this.config.isInFallbackMode());
            console.log('[API CALL DEBUG] requested model:', model);
            return this.config.getContentGenerator().generateContentStream({
                model: modelToUse,
                contents: requestContents,
                config: { ...this.generationConfig, ...params.config },
            }, prompt_id);
        };
        const onPersistent429Callback = async (authType, error) => await handleFallback(this.config, model, authType, error);
        const streamResponse = await retryWithBackoff(apiCall, {
            onPersistent429: onPersistent429Callback,
            authType: this.config.getContentGeneratorConfig()?.authType,
            retryFetchErrors: this.config.getRetryFetchErrors(),
            signal: params.config?.abortSignal,
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
    getHistory(curated = false) {
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
    clearHistory() {
        this.history = [];
    }
    /**
     * Adds a new entry to the chat history.
     */
    addHistory(content) {
        this.history.push(content);
    }
    setHistory(history) {
        this.history = history;
    }
    stripThoughtsFromHistory() {
        this.history = this.history.map((content) => {
            const newContent = { ...content };
            if (newContent.parts) {
                newContent.parts = newContent.parts.map((part) => {
                    if (part && typeof part === 'object' && 'thoughtSignature' in part) {
                        const newPart = { ...part };
                        delete newPart.thoughtSignature;
                        return newPart;
                    }
                    return part;
                });
            }
            return newContent;
        });
    }
    setTools(tools) {
        this.generationConfig.tools = tools;
    }
    /**
     * Trims old tool results (functionResponse) from history to save tokens.
     * Keeps recent tool results (last 4 contents = 2 turns) in full.
     * Older tool results are replaced with brief summaries.
     */
    trimOldToolResults(contents) {
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
            const hasFunctionResponse = content.parts?.some((part) => part.functionResponse);
            if (!hasFunctionResponse) {
                return content; // No tool results to trim
            }
            // Trim functionResponse parts
            const trimmedParts = content.parts?.map((part) => {
                if (!part.functionResponse) {
                    return part; // Keep non-tool parts as-is
                }
                const response = part.functionResponse.response;
                if (!response ||
                    typeof response['output'] !== 'string' ||
                    response['output'].length < 500) {
                    return part; // Keep small outputs
                }
                // Replace large output with summary
                const toolName = part.functionResponse.name || 'unknown_tool';
                const output = response['output'];
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
    async maybeIncludeSchemaDepthContext(error) {
        // Check for potentially problematic cyclic tools with cyclic schemas
        // and include a recommendation to remove potentially problematic tools.
        if (isSchemaDepthError(error.message) ||
            isInvalidArgumentError(error.message)) {
            const tools = this.config.getToolRegistry().getAllTools();
            const cyclicSchemaTools = [];
            for (const tool of tools) {
                if ((tool.schema.parametersJsonSchema &&
                    hasCycleInSchema(tool.schema.parametersJsonSchema)) ||
                    (tool.schema.parameters && hasCycleInSchema(tool.schema.parameters))) {
                    cyclicSchemaTools.push(tool.displayName);
                }
            }
            if (cyclicSchemaTools.length > 0) {
                const extraDetails = `\n\nThis error was probably caused by cyclic schema references in one of the following tools, try disabling them with excludeTools:\n\n - ` +
                    cyclicSchemaTools.join(`\n - `) +
                    `\n`;
                error.message += extraDetails;
            }
        }
    }
    async *processStreamResponse(model, streamResponse) {
        const modelResponseParts = [];
        let hasToolCall = false;
        let hasFinishReason = false;
        let lastFinishReason;
        // Detect local LLM server for longer first-chunk timeout (model loading)
        const isOllama = false; // Local LLM support disabled in upstream merge
        // Timeout strategy:
        // - Ollama: 90s for first chunk (model loading), then 30s for subsequent chunks
        // - llama.cpp with tools: 90s for first chunk, then 60s for subsequent (slower processing)
        // - Flash fallback: 10s (throttling usually fails fast)
        // - Pro/others: 30s
        // Detect if we're using llama.cpp
        let contentGen = this.config.getContentGenerator();
        if (contentGen && typeof contentGen.getWrapped === 'function') {
            contentGen = contentGen.getWrapped();
        }
        const isLlamaCpp = contentGen.constructor.name === 'LlamaCppContentGenerator';
        const hasTools = (this.generationConfig.tools?.length || 0) > 0;
        const FIRST_CHUNK_TIMEOUT_MS = isOllama ? 90000 : 30000; // 90s for Ollama first load
        const SUBSEQUENT_CHUNK_TIMEOUT_MS = isLlamaCpp && hasTools
            ? 60000 // llama.cpp with tools gets 60s (slow tool processing)
            : this.config.isInFallbackMode()
                ? 10000 // Flash fallback: 10s
                : 30000; // Others: 30s
        const MAX_CHUNKS = 1000; // Maximum chunks to prevent infinite loops
        let chunkCount = 0;
        const streamIterator = this.stopBeforeSecondMutator(streamResponse);
        try {
            while (true) {
                chunkCount++;
                // Safety limit: prevent infinite streaming loops
                if (chunkCount > MAX_CHUNKS) {
                    console.warn(`[STREAM DEBUG] Reached maximum chunk limit (${MAX_CHUNKS}). Aborting stream to prevent infinite loop.`);
                    break;
                }
                console.log('[STREAM DEBUG] Waiting for next chunk...');
                // Wrap each chunk read with a timeout
                // Use longer timeout for first chunk (Ollama model loading), shorter for subsequent
                const chunkTimeout = chunkCount === 1
                    ? FIRST_CHUNK_TIMEOUT_MS
                    : SUBSEQUENT_CHUNK_TIMEOUT_MS;
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Stream chunk timeout')), chunkTimeout));
                const chunkPromise = streamIterator.next();
                let result;
                try {
                    result = await Promise.race([chunkPromise, timeoutPromise]);
                    console.log('[STREAM DEBUG] Chunk received, done:', result.done);
                }
                catch (_timeoutError) {
                    const timeoutSeconds = Math.round(chunkTimeout / 1000);
                    console.warn(`[STREAM DEBUG] Stream stalled - no chunks received for ${timeoutSeconds} seconds. Treating as incomplete stream.`);
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
                console.log('[STREAM DEBUG] Received chunk:', JSON.stringify(chunkInfo));
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
                        modelResponseParts.push(...content.parts.filter((part) => !part.thought));
                    }
                }
                // Record token usage if this chunk has usageMetadata
                if (chunk.usageMetadata) {
                    this.chatRecordingService.recordMessageTokens(chunk.usageMetadata);
                    if (chunk.usageMetadata.promptTokenCount !== undefined) {
                        uiTelemetryService.setLastPromptTokenCount(chunk.usageMetadata.promptTokenCount);
                    }
                }
                yield chunk; // Yield every chunk to the UI immediately.
                console.log('[STREAM DEBUG] Chunk yielded, waiting for next...');
            }
        }
        catch (error) {
            console.error('Stream processing error:', error);
            throw error;
        }
        // String thoughts and consolidate text parts.
        const consolidatedParts = [];
        for (const part of modelResponseParts) {
            const lastPart = consolidatedParts[consolidatedParts.length - 1];
            if (lastPart?.text &&
                isValidNonThoughtTextPart(lastPart) &&
                isValidNonThoughtTextPart(part)) {
                lastPart.text += part.text;
            }
            else {
                consolidatedParts.push(part);
            }
        }
        const responseText = consolidatedParts
            .filter((part) => part.text)
            .map((part) => part.text)
            .join('')
            .trim();
        // Diagnostic: Log detailed part information when we have parts but no text
        if (consolidatedParts.length > 0 && !responseText) {
            console.warn('[EMPTY RESPONSE DIAGNOSTIC] Received parts with no text content:');
            console.warn(`[EMPTY RESPONSE DIAGNOSTIC] Total parts: ${consolidatedParts.length}`);
            consolidatedParts.forEach((part, idx) => {
                const partType = part.functionCall
                    ? `functionCall(${part.functionCall.name})`
                    : part.functionResponse
                        ? `functionResponse(${part.functionResponse.name})`
                        : part.fileData
                            ? 'fileData'
                            : part.inlineData
                                ? 'inlineData'
                                : part.thought
                                    ? 'thought'
                                    : part.text !== undefined
                                        ? `text(${part.text.length} chars: "${part.text.substring(0, 50)}${part.text.length > 50 ? '..."' : '"'}")`
                                        : `unknown(keys: ${Object.keys(part).join(',')})`;
                console.warn(`[EMPTY RESPONSE DIAGNOSTIC]   Part ${idx}: ${partType}`);
            });
        }
        // Record model response text from the collected parts
        if (responseText) {
            this.chatRecordingService.recordMessage({
                model,
                type: 'gemini',
                content: responseText,
            });
        }
        // Special handling for llama.cpp responses:
        // llama.cpp/vLLM often doesn't send finish_reason even when generation completes naturally.
        // If using llama.cpp and we got meaningful text (regardless of finish reason),
        // accept it as a valid response.
        if (isLlamaCpp && hasTools && responseText.length > 0) {
            if (!hasFinishReason) {
                console.log(`[LLAMA.CPP] Accepting response (${chunkCount} chunks, ${responseText.length} chars) without finish_reason (llama.cpp often omits this).`);
            }
            // Add to history and return successfully
            this.history.push({ role: 'model', parts: consolidatedParts });
            return;
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
                    let contentGen = this.config.getContentGenerator();
                    // Unwrap LoggingContentGenerator if present
                    if (contentGen && typeof contentGen.getWrapped === 'function') {
                        contentGen = contentGen.getWrapped();
                    }
                    const isLlamaCpp = contentGen.constructor.name === 'LlamaCppContentGenerator';
                    const serverType = isLlamaCpp ? 'llama.cpp' : 'Ollama';
                    const defaultUrl = isLlamaCpp
                        ? 'http://localhost:8000'
                        : 'http://localhost:11434';
                    const apiPath = isLlamaCpp ? '/v1/chat/completions' : '/api/chat';
                    const curlExample = `curl -X POST ${defaultUrl}${apiPath} \\\n` +
                        `       -H "Content-Type: application/json" \\\n` +
                        `       -d '{"model": "<your-model>", "messages": [{"role": "user", "content": "Say hello"}], "stream": true}'`;
                    const port = isLlamaCpp ? '8000' : '11434';
                    const startCommand = isLlamaCpp
                        ? `export HF_HOME="/path/to/models"
python -m vllm.entrypoints.openai.api_server \\
  --model Qwen/Qwen2.5-Coder-7B-Instruct \\
  --host 0.0.0.0 --port ${port}`
                        : `ollama serve`;
                    // Check if we got partial response (stream started but timed out mid-response)
                    const gotPartialResponse = responseText.length > 0;
                    // Build agent-aware guidance based on whether we got a partial response
                    let errorMessage = gotPartialResponse
                        ? `❌ LOCAL LLM ERROR: Stream timed out mid-response (${chunkCount} chunks received, ${responseText.length} chars)\n\nServer type: ${serverType}\nModel: ${model}\n`
                        : `❌ LOCAL LLM ERROR: Stream timed out without receiving any response\n\nServer type: ${serverType}\nModel: ${model}\n`;
                    if (isLlamaCpp) {
                        if (gotPartialResponse) {
                            // Model is responding but very slowly - likely struggling with tools
                            errorMessage +=
                                `\n⚠️  LIKELY CAUSE: 7B model is too slow with tool calling\n` +
                                    `The model responded but couldn't finish processing ${this.generationConfig.tools?.length || 0} tools within the timeout.\n\n` +
                                    `SOLUTIONS:\n` +
                                    `  1. Use Ollama instead (faster tool handling with 7B models):\n` +
                                    `     ollama pull qwen2.5-coder:7b\n` +
                                    `     Then use agent: ollama-coder\n\n` +
                                    `  2. Use a larger, faster model with llama.cpp (32B+):\n` +
                                    `     python -m vllm.entrypoints.openai.api_server \\\n` +
                                    `       --model Qwen/Qwen2.5-Coder-32B-Instruct \\\n` +
                                    `       --host 0.0.0.0 --port ${port}\n\n` +
                                    `  3. Use simplified agent without tools:\n` +
                                    `     Agent: llamacpp-coder (Q&A only, no file operations)\n`;
                        }
                        else {
                            // Model never responded - likely cannot handle tools at all
                            errorMessage +=
                                `\n⚠️  LIKELY CAUSE: 7B models cannot handle tool calling\n` +
                                    `Qwen2.5-Coder-7B times out when processing function/tool schemas.\n\n` +
                                    `SOLUTIONS:\n` +
                                    `  1. Use Ollama instead (supports tools with 7B models):\n` +
                                    `     ollama pull qwen2.5-coder:7b\n` +
                                    `     Then use agent: ollama-coder\n\n` +
                                    `  2. Use a larger model with llama.cpp (32B+):\n` +
                                    `     python -m vllm.entrypoints.openai.api_server \\\n` +
                                    `       --model Qwen/Qwen2.5-Coder-32B-Instruct \\\n` +
                                    `       --host 0.0.0.0 --port ${port}\n\n` +
                                    `  3. Use simplified agent without tools:\n` +
                                    `     Agent: llamacpp-coder (Q&A only, no file operations)\n`;
                        }
                    }
                    errorMessage +=
                        `\nDIAGNOSTICS:\n` +
                            `  # Check if server is running:\n` +
                            `  curl -s ${defaultUrl}/health\n\n` +
                            `  # Check what's listening on port ${port}:\n` +
                            `  lsof -i :${port}\n\n` +
                            `  # Start ${serverType} server:\n` +
                            `  ${startCommand}\n\n` +
                            `  # Test with simple request:\n` +
                            `  ${curlExample}`;
                    // Don't retry if we got a partial response - the model is fundamentally too slow
                    // Retrying will just hit the same timeout and cause duplicate responses
                    throw new InvalidStreamError(errorMessage, 'NO_FINISH_REASON', undefined, !gotPartialResponse);
                }
                throw new InvalidStreamError('Model stream ended without a finish reason.\n\n' +
                    'This can happen due to:\n' +
                    '  • Temporary API issues (try again in a moment)\n' +
                    '  • Rate limiting (wait 30-60 seconds)\n' +
                    '  • Request too large (start a new chat with /clear)\n' +
                    '  • Safety filters (try rephrasing your request)', 'NO_FINISH_REASON');
            }
            else {
                // Use the finish reason to provide more accurate error classification
                console.log('[EMPTY RESPONSE DEBUG] Finish reason:', lastFinishReason, 'In fallback mode:', this.config.isInFallbackMode());
                // Check finish reason to distinguish between different types of failures
                if (lastFinishReason === FinishReason.SAFETY) {
                    // Safety blocks should NOT retry - they will fail the same way again
                    throw new InvalidStreamError('Model response was blocked by safety filters.\n\n' +
                        'The content violated safety policies. Try:\n' +
                        '  • Rephrasing your request in a different way\n' +
                        '  • Avoiding sensitive or controversial topics\n' +
                        '  • Starting a new chat session (/clear)', 'NO_RESPONSE_TEXT', lastFinishReason, false);
                }
                if (lastFinishReason === FinishReason.RECITATION) {
                    // Recitation blocks should NOT retry - they will fail the same way again
                    throw new InvalidStreamError('Model response was blocked due to recitation.\n\n' +
                        'The content matched copyrighted material. Try:\n' +
                        '  • Asking for a summary or paraphrase instead\n' +
                        '  • Requesting original content\n' +
                        '  • Starting a new chat session (/clear)', 'NO_RESPONSE_TEXT', lastFinishReason, false);
                }
                // For OTHER finish reason or STOP with empty text, check if we're in fallback mode
                // This is more likely to be quota exhaustion or rate limiting if we just switched to Flash
                if (this.config.isInFallbackMode()) {
                    // Check if we've seen multiple consecutive empty responses
                    // If so, it's likely quota exhaustion - retry with longer backoff
                    if (this.consecutiveEmptyResponses >= 1) {
                        // Second+ empty response in fallback - likely quota exhaustion
                        // Keep retrying with exponential backoff to gracefully resume when quota resets
                        throw new InvalidStreamError('Flash model returned empty response (likely quota exhausted).\n\n' +
                            'Quota may be temporarily exhausted. Retrying with longer backoff...\n' +
                            'The system will automatically resume when quota becomes available.', 'NO_RESPONSE_TEXT', lastFinishReason, true);
                    }
                    else {
                        // First empty response in fallback - could be transient rate limiting (429)
                        // Retry with backoff to see if it clears
                        throw new InvalidStreamError('Flash model returned empty response (likely rate limited).\n\n' +
                            'This may be temporary throttling. Retrying with backoff...', 'NO_RESPONSE_TEXT', lastFinishReason, true);
                    }
                }
                // Default empty response error for non-fallback cases
                throw new InvalidStreamError('Model stream ended with empty response text.\n\n' +
                    'This usually means:\n' +
                    '  • Content was filtered by safety systems\n' +
                    '  • Request was too complex or large\n' +
                    '  • Temporary API issue\n\n' +
                    'Try:\n' +
                    '  • Rephrasing your request\n' +
                    '  • Starting a new chat session (/clear)\n' +
                    '  • Waiting a moment and trying again', 'NO_RESPONSE_TEXT', lastFinishReason, true);
            }
        }
        this.history.push({ role: 'model', parts: consolidatedParts });
    }
    /**
     * Gets the chat recording service instance.
     */
    getChatRecordingService() {
        return this.chatRecordingService;
    }
    /**
     * Records completed tool calls with full metadata.
     * This is called by external components when tool calls complete, before sending responses to Gemini.
     */
    recordCompletedToolCalls(model, toolCalls) {
        const toolCallRecords = toolCalls.map((call) => {
            const resultDisplayRaw = call.response?.resultDisplay;
            const resultDisplay = typeof resultDisplayRaw === 'string' ? resultDisplayRaw : undefined;
            return {
                id: call.request.callId,
                name: call.request.name,
                args: call.request.args,
                result: call.response?.responseParts || null,
                status: call.status,
                timestamp: new Date().toISOString(),
                resultDisplay,
            };
        });
        this.chatRecordingService.recordToolCalls(model, toolCallRecords);
    }
    /**
     * Extracts and records thought from thought content.
     */
    recordThoughtFromContent(content) {
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
    async *stopBeforeSecondMutator(chunkStream) {
        let foundMutatorFunctionCall = false;
        try {
            for await (const chunk of chunkStream) {
                const candidate = chunk.candidates?.[0];
                const content = candidate?.content;
                if (!candidate || !content?.parts) {
                    yield chunk;
                    continue;
                }
                const truncatedParts = [];
                for (const part of content.parts) {
                    if (this.isMutatorFunctionCall(part)) {
                        if (foundMutatorFunctionCall) {
                            // This is the second mutator call.
                            // Truncate and return immediately
                            const newChunk = {
                                candidates: [
                                    {
                                        index: 0,
                                        content: {
                                            role: 'model',
                                            parts: truncatedParts,
                                        },
                                        finishReason: FinishReason.STOP,
                                    },
                                ],
                            };
                            // Don't set text property as it's readonly
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
        }
        finally {
            // Ensure stream is closed if we exit early
            if (chunkStream.return) {
                await chunkStream.return(undefined);
            }
        }
    }
    isMutatorFunctionCall(part) {
        if (!part?.functionCall?.name) {
            return false;
        }
        const tool = this.config.getToolRegistry().getTool(part.functionCall.name);
        return !!tool && MUTATOR_KINDS.includes(tool.kind);
    }
}
/** Visible for Testing */
export function isSchemaDepthError(errorMessage) {
    return errorMessage.includes('maximum schema depth exceeded');
}
export function isInvalidArgumentError(errorMessage) {
    return errorMessage.includes('Request contains an invalid argument');
}
//# sourceMappingURL=geminiChat.js.map