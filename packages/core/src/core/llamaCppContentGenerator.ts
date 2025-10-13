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
  Tool,
  ToolListUnion,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { Config } from '../config/config.js';

interface LlamaCppMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlamaCppTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface LlamaCppRequest {
  model: string;
  messages: LlamaCppMessage[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  tools?: LlamaCppTool[];
  tool_choice?: 'auto' | 'none';
}

interface LlamaCppFunctionCall {
  name: string;
  arguments: string; // JSON string
}

interface LlamaCppToolCall {
  id: string;
  type: 'function';
  function: LlamaCppFunctionCall;
}

interface LlamaCppResponseMessage {
  role: string;
  content: string | null;
  tool_calls?: LlamaCppToolCall[];
}

interface LlamaCppChoice {
  index: number;
  message: LlamaCppResponseMessage;
  finish_reason: string | null;
}

interface LlamaCppResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: LlamaCppChoice[];
}

interface LlamaCppStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: LlamaCppToolCall[];
    };
    finish_reason: string | null;
  }>;
}

/**
 * ContentGenerator implementation for llama.cpp (llama-server)
 *
 * llama.cpp provides a local LLM inference server with native function calling support
 * via its OpenAI-compatible API endpoint.
 * API docs: https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md
 */
export class LlamaCppContentGenerator implements ContentGenerator {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8000', _config?: Config) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Normalize ContentListUnion to Content[] for processing
   */
  private normalizeContents(contents: unknown): Content[] {
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
      contents !== null &&
      'role' in contents &&
      'parts' in contents
    ) {
      return [contents as Content];
    }

    // If it's a single Part, wrap it
    return [{ role: 'user', parts: [contents as Part] }];
  }

  /**
   * Convert Gemini Tool format to llama.cpp format
   */
  private convertToLlamaCppTools(
    tools?: ToolListUnion,
  ): LlamaCppTool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    // Filter to only Tool types (not CallableTool)
    const toolsArray = tools.filter(
      (t): t is Tool => 'functionDeclarations' in t,
    );

    return toolsArray.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.functionDeclarations?.[0]?.name || 'unknown',
        description: tool.functionDeclarations?.[0]?.description || '',
        parameters:
          (tool.functionDeclarations?.[0]?.parameters as Record<
            string,
            unknown
          >) || {},
      },
    }));
  }

  /**
   * Convert Gemini Content format to llama.cpp messages format
   */
  private convertToLlamaCppMessages(contents: Content[]): LlamaCppMessage[] {
    const messages: LlamaCppMessage[] = [];

    for (const content of contents) {
      const role =
        content.role === 'model'
          ? 'assistant'
          : (content.role as 'user' | 'system');

      // Extract text from parts
      const textParts: string[] = [];
      for (const part of content.parts || []) {
        if ('text' in part && part.text) {
          textParts.push(part.text);
        }
        // Function responses will be handled separately in conversation history
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
   * Convert llama.cpp response to Gemini format
   */
  private convertToGeminiResponse(
    llamaCppResponse: LlamaCppResponse,
  ): GenerateContentResponse {
    const choice = llamaCppResponse.choices[0];
    const parts: Part[] = [];

    // Add text content if present
    if (choice.message.content) {
      parts.push({
        text: choice.message.content,
      });
    }

    // Add function calls if present
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args,
            },
          });
        } catch (error) {
          console.warn(
            'Failed to parse tool call arguments:',
            toolCall.function.arguments,
            error,
          );
        }
      }
    }

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
          finishReason: choice.finish_reason === 'stop' ? 'STOP' : undefined,
          index: choice.index,
        },
      ],
    } as GenerateContentResponse;
  }

  /**
   * Convert llama.cpp stream chunk to Gemini format
   */
  private convertStreamChunkToGeminiResponse(
    chunk: LlamaCppStreamChunk,
  ): GenerateContentResponse {
    const choice = chunk.choices[0];
    const parts: Part[] = [];

    // Add text content if present
    if (choice.delta.content) {
      parts.push({
        text: choice.delta.content,
      });
    }

    // Add function calls if present
    if (choice.delta.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args,
            },
          });
        } catch (error) {
          console.warn(
            'Failed to parse tool call arguments in stream:',
            toolCall.function.arguments,
            error,
          );
        }
      }
    }

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
          finishReason: choice.finish_reason === 'stop' ? 'STOP' : undefined,
          index: choice.index,
        },
      ],
    } as GenerateContentResponse;
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const contentsArray = this.normalizeContents(request.contents);
    const messages = this.convertToLlamaCppMessages(contentsArray);

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

    const llamaCppRequest: LlamaCppRequest = {
      model: request.model,
      messages,
      stream: false,
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      tools: this.convertToLlamaCppTools(request.config?.tools),
      tool_choice: request.config?.tools ? 'auto' : undefined,
    };

    let response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(llamaCppRequest),
      });
    } catch (error) {
      throw new Error(
        `❌ LOCAL LLM ERROR: Cannot connect to llama.cpp server at ${this.baseUrl}\n\n` +
          `Troubleshooting:\n` +
          `  1. Check if llama.cpp server is running:\n` +
          `     curl ${this.baseUrl}/health\n\n` +
          `  2. Start llama.cpp server if needed:\n` +
          `     llama-server --model /path/to/model.gguf --port 8000\n\n` +
          `  3. Check LLAMACPP_BASE_URL environment variable\n\n` +
          `Original error: ${error}`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `❌ LOCAL LLM ERROR: llama.cpp API returned ${response.status} ${response.statusText}\n\n` +
          `Server URL: ${this.baseUrl}/v1/chat/completions\n` +
          `Model: ${request.model}\n\n` +
          `Response: ${errorText}\n\n` +
          `Troubleshooting:\n` +
          `  • Verify the model is loaded in llama.cpp\n` +
          `  • Check server logs for errors\n` +
          `  • Try: curl ${this.baseUrl}/v1/models`,
      );
    }

    const llamaCppResponse: LlamaCppResponse = await response.json();
    return this.convertToGeminiResponse(llamaCppResponse);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const baseUrl = this.baseUrl;
    const convertStreamChunkToGeminiResponse =
      this.convertStreamChunkToGeminiResponse.bind(this);

    const contentsArray = this.normalizeContents(request.contents);
    const messages = this.convertToLlamaCppMessages(contentsArray);

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

    const llamaCppRequest: LlamaCppRequest = {
      model: request.model,
      messages,
      stream: true,
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      tools: this.convertToLlamaCppTools(request.config?.tools),
      tool_choice: request.config?.tools ? 'auto' : undefined,
    };

    async function* streamGenerator(): AsyncGenerator<GenerateContentResponse> {
      let response;
      try {
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(llamaCppRequest),
        });
      } catch (error) {
        throw new Error(
          `❌ LOCAL LLM ERROR: Cannot connect to llama.cpp server at ${baseUrl}\n\n` +
            `Troubleshooting:\n` +
            `  1. Check if llama.cpp server is running:\n` +
            `     curl ${baseUrl}/health\n\n` +
            `  2. Start llama.cpp server if needed:\n` +
            `     llama-server --model /path/to/model.gguf --port 8000\n\n` +
            `  3. Check LLAMACPP_BASE_URL environment variable\n\n` +
            `Original error: ${error}`,
        );
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `❌ LOCAL LLM ERROR: llama.cpp API returned ${response.status} ${response.statusText}\n\n` +
            `Server URL: ${baseUrl}/v1/chat/completions\n` +
            `Model: ${llamaCppRequest.model}\n\n` +
            `Response: ${errorText}\n\n` +
            `Troubleshooting:\n` +
            `  • Verify the model is loaded in llama.cpp\n` +
            `  • Check server logs for errors\n` +
            `  • Try: curl ${baseUrl}/v1/models`,
        );
      }

      // llama.cpp streams Server-Sent Events (SSE) format
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(
          `❌ LOCAL LLM ERROR: No response body from llama.cpp server\n\n` +
            `This usually indicates a server configuration issue.\n` +
            `Check llama.cpp server logs for details.`,
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let chunksReceived = 0;
      let hasFinishReason = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6); // Remove 'data: ' prefix
            if (data === '[DONE]') {
              if (!hasFinishReason) {
                console.warn(
                  `⚠️  LOCAL LLM WARNING: Stream ended with [DONE] but no finish_reason was received.\n` +
                    `This may indicate the model stopped generating unexpectedly.\n` +
                    `Chunks received: ${chunksReceived}`,
                );
              }
              return;
            }
            try {
              const chunk: LlamaCppStreamChunk = JSON.parse(data);
              chunksReceived++;

              // Track if we've seen a finish_reason
              if (chunk.choices[0]?.finish_reason === 'stop') {
                hasFinishReason = true;
              }

              yield convertStreamChunkToGeminiResponse(chunk);
            } catch (error) {
              console.warn(
                `⚠️  LOCAL LLM WARNING: Failed to parse stream chunk (chunk #${chunksReceived}):\n`,
                `Data: ${data.substring(0, 200)}...\n`,
                `Error: ${error}`,
              );
            }
          }
        }
      }

      // Stream ended without [DONE]
      if (!hasFinishReason) {
        console.error(
          `❌ LOCAL LLM ERROR: Stream ended unexpectedly without finish_reason\n\n` +
            `Chunks received: ${chunksReceived}\n` +
            `Server: ${baseUrl}\n\n` +
            `This usually means:\n` +
            `  • The model crashed or ran out of memory\n` +
            `  • The server was interrupted\n` +
            `  • Network connection was lost\n\n` +
            `Check llama.cpp server logs for details.`,
        );
      }
    }

    return streamGenerator();
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // llama.cpp doesn't have a dedicated token counting endpoint
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
    // llama.cpp supports embeddings via /v1/embeddings endpoint
    const contentsArray = this.normalizeContents(request.contents);
    const text = contentsArray
      .map(
        (c: Content) =>
          c.parts?.map((p: Part) => ('text' in p ? p.text : '')).join(' ') ||
          '',
      )
      .join('\n');

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `llama.cpp embeddings API error: ${response.status} ${response.statusText}`,
      );
    }

    const result = await response.json();

    return {
      embedding: {
        values: result.data[0].embedding,
      },
    } as EmbedContentResponse;
  }
}
