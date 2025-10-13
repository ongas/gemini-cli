/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CountTokensResponse, GenerateContentResponse, GenerateContentParameters, CountTokensParameters, EmbedContentResponse, EmbedContentParameters } from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { Config } from '../config/config.js';
/**
 * ContentGenerator implementation for llama.cpp (llama-server)
 *
 * llama.cpp provides a local LLM inference server with native function calling support
 * via its OpenAI-compatible API endpoint.
 * API docs: https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md
 */
export declare class LlamaCppContentGenerator implements ContentGenerator {
    private baseUrl;
    constructor(baseUrl?: string, _config?: Config);
    /**
     * Normalize ContentListUnion to Content[] for processing
     */
    private normalizeContents;
    /**
     * Convert Gemini Tool format to llama.cpp format
     */
    private convertToLlamaCppTools;
    /**
     * Convert Gemini Content format to llama.cpp messages format
     */
    private convertToLlamaCppMessages;
    /**
     * Convert llama.cpp response to Gemini format
     */
    private convertToGeminiResponse;
    /**
     * Convert llama.cpp stream chunk to Gemini format
     */
    private convertStreamChunkToGeminiResponse;
    generateContent(request: GenerateContentParameters, _userPromptId: string): Promise<GenerateContentResponse>;
    generateContentStream(request: GenerateContentParameters, _userPromptId: string): Promise<AsyncGenerator<GenerateContentResponse>>;
    countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;
    embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}
