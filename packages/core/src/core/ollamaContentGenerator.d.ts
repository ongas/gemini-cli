/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { Config } from '../config/config.js';
/**
 * ContentGenerator implementation for Ollama local models
 *
 * Ollama supports function calling via its OpenAI-compatible API.
 * Tool support blog: https://ollama.com/blog/tool-support
 * API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
export declare class OllamaContentGenerator implements ContentGenerator {
  private baseUrl;
  constructor(baseUrl?: string, _config?: Config);
  /**
   * Normalize ContentListUnion to Content[] for processing
   */
  private normalizeContents;
  /**
   * Convert Gemini Tool format to Ollama format
   */
  private convertToOllamaTools;
  /**
   * Convert Gemini Content format to Ollama messages format
   */
  private convertToOllamaMessages;
  /**
   * Convert Ollama response to Gemini format
   */
  private convertToGeminiResponse;
  generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse>;
  generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;
  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;
  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}
