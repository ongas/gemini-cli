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
  Content,
  Part,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { Config } from '../config/config.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
  };
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

/**
 * ContentGenerator implementation for Ollama local models
 *
 * Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
 * Uses the /api/chat endpoint which is compatible with OpenAI-style chat
 */
export class OllamaContentGenerator implements ContentGenerator {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434', _config?: Config) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Normalize ContentListUnion to Content[] for processing
   */
  private normalizeContents(contents: any): Content[] {
    // If it's already an array of Content objects
    if (Array.isArray(contents)) {
      // Check if first element is a Content object (has role and parts)
      if (
        contents.length > 0 &&
        'role' in contents[0] &&
        'parts' in contents[0]
      ) {
        return contents as Content[];
      }
      // If it's an array of parts, wrap in a single Content
      return [{ role: 'user', parts: contents }];
    }

    // If it's a single Content object
    if (
      typeof contents === 'object' &&
      'role' in contents &&
      'parts' in contents
    ) {
      return [contents as Content];
    }

    // If it's a single Part, wrap it
    return [{ role: 'user', parts: [contents] }];
  }

  /**
   * Convert Gemini Content format to Ollama messages format
   */
  private convertToOllamaMessages(contents: Content[]): OllamaMessage[] {
    const messages: OllamaMessage[] = [];

    for (const content of contents) {
      const role =
        content.role === 'model' ? 'assistant' : (content.role as any);

      // Extract text from parts
      const textParts: string[] = [];
      for (const part of content.parts || []) {
        if ('text' in part && part.text) {
          textParts.push(part.text);
        }
        // Ollama doesn't support function calls natively, so we skip them
        // In the future, we could convert them to text descriptions
      }

      if (textParts.length > 0) {
        messages.push({
          role,
          content: textParts.join('\n'),
        });
      }
    }

    return messages;
  }

  /**
   * Convert Ollama response to Gemini format
   */
  private convertToGeminiResponse(
    ollamaResponse: OllamaResponse,
  ): GenerateContentResponse {
    const parts: Part[] = [
      {
        text: ollamaResponse.message.content,
      },
    ];

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
          finishReason: ollamaResponse.done ? 'STOP' : undefined,
          index: 0,
        },
      ],
    } as GenerateContentResponse;
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const contentsArray = this.normalizeContents(request.contents);
    const messages = this.convertToOllamaMessages(contentsArray);

    // Add system instruction if provided in config
    if (request.config?.systemInstruction) {
      const sysInstr = request.config.systemInstruction;
      let systemText = '';

      if (typeof sysInstr === 'string') {
        systemText = sysInstr;
      } else {
        const sysArray = this.normalizeContents(sysInstr);
        systemText = sysArray
          .map(
            (c: Content) =>
              c.parts
                ?.map((p: Part) => ('text' in p ? p.text : ''))
                .join(' ') || '',
          )
          .join('\n');
      }

      if (systemText) {
        messages.unshift({
          role: 'system',
          content: systemText,
        });
      }
    }

    const ollamaRequest: OllamaRequest = {
      model: request.model,
      messages,
      stream: false,
      options: {
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ollamaRequest),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const ollamaResponse: OllamaResponse = await response.json();
    return this.convertToGeminiResponse(ollamaResponse);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const baseUrl = this.baseUrl;
    const convertToGeminiResponse = this.convertToGeminiResponse.bind(this);

    const contentsArray = this.normalizeContents(request.contents);
    const messages = this.convertToOllamaMessages(contentsArray);

    // Add system instruction if provided in config
    if (request.config?.systemInstruction) {
      const sysInstr = request.config.systemInstruction;
      let systemText = '';

      if (typeof sysInstr === 'string') {
        systemText = sysInstr;
      } else {
        const sysArray = this.normalizeContents(sysInstr);
        systemText = sysArray
          .map(
            (c: Content) =>
              c.parts
                ?.map((p: Part) => ('text' in p ? p.text : ''))
                .join(' ') || '',
          )
          .join('\n');
      }

      if (systemText) {
        messages.unshift({
          role: 'system',
          content: systemText,
        });
      }
    }

    const ollamaRequest: OllamaRequest = {
      model: request.model,
      messages,
      stream: true,
      options: {
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
      },
    };

    async function* streamGenerator(): AsyncGenerator<GenerateContentResponse> {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ollamaRequest),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`,
        );
      }

      // Ollama streams newline-delimited JSON
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body from Ollama');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const ollamaResponse: OllamaResponse = JSON.parse(line);
              yield convertToGeminiResponse(ollamaResponse);
            } catch (error) {
              console.warn(
                'Failed to parse Ollama response line:',
                line,
                error,
              );
            }
          }
        }
      }
    }

    return streamGenerator();
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Ollama doesn't have a token counting API
    // Approximate: ~4 characters per token for English text
    const contentsArray = this.normalizeContents(request.contents);

    const text = contentsArray
      .map(
        (c: Content) =>
          c.parts?.map((p: Part) => ('text' in p ? p.text : '')).join('') || '',
      )
      .join('');

    const approximateTokens = Math.ceil(text.length / 4);

    return {
      totalTokens: approximateTokens,
    } as CountTokensResponse;
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // Ollama has an /api/embeddings endpoint
    const contentsArray = this.normalizeContents(request.contents);
    const text = contentsArray
      .map(
        (c: Content) =>
          c.parts?.map((p: Part) => ('text' in p ? p.text : '')).join(' ') ||
          '',
      )
      .join('\n');

    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model || 'llama3',
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama embeddings API error: ${response.status} ${response.statusText}`,
      );
    }

    const result = await response.json();

    return {
      embedding: {
        values: result.embedding,
      },
    } as EmbedContentResponse;
  }
}
