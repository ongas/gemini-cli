/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * ContentGenerator implementation for Ollama local models
 *
 * Ollama supports function calling via its OpenAI-compatible API.
 * Tool support blog: https://ollama.com/blog/tool-support
 * API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
export class OllamaContentGenerator {
    baseUrl;
    constructor(baseUrl = 'http://localhost:11434', _config) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    }
    /**
     * Normalize ContentListUnion to Content[] for processing
     */
    normalizeContents(contents) {
        // If it's already an array of Content objects
        if (Array.isArray(contents)) {
            // Check if first element is a Content object (has role and parts)
            if (contents.length > 0 &&
                'role' in contents[0] &&
                'parts' in contents[0]) {
                return contents;
            }
            // If it's an array of parts, wrap in a single Content
            return [{ role: 'user', parts: contents }];
        }
        // If it's a single Content object
        if (typeof contents === 'object' &&
            contents !== null &&
            'role' in contents &&
            'parts' in contents) {
            return [contents];
        }
        // If it's a single Part, wrap it
        return [{ role: 'user', parts: [contents] }];
    }
    /**
     * Convert Gemini Tool format to Ollama format
     */
    convertToOllamaTools(tools) {
        if (!tools || tools.length === 0) {
            return undefined;
        }
        // Filter to only Tool types (not CallableTool)
        const toolsArray = tools.filter((t) => 'functionDeclarations' in t);
        return toolsArray.map((tool) => ({
            type: 'function',
            function: {
                name: tool.functionDeclarations?.[0]?.name || 'unknown',
                description: tool.functionDeclarations?.[0]?.description || '',
                parameters: tool.functionDeclarations?.[0]?.parameters || {},
            },
        }));
    }
    /**
     * Convert Gemini Content format to Ollama messages format
     */
    convertToOllamaMessages(contents) {
        const messages = [];
        for (const content of contents) {
            const role = content.role === 'model'
                ? 'assistant'
                : content.role;
            // Extract text from parts
            const textParts = [];
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
     * Convert Ollama response to Gemini format
     */
    convertToGeminiResponse(ollamaResponse) {
        const parts = [];
        // Add text content if present
        if (ollamaResponse.message.content) {
            parts.push({
                text: ollamaResponse.message.content,
            });
        }
        // Add function calls if present
        if (ollamaResponse.message.tool_calls) {
            for (const toolCall of ollamaResponse.message.tool_calls) {
                parts.push({
                    functionCall: {
                        name: toolCall.function.name,
                        args: toolCall.function.arguments,
                    },
                });
            }
        }
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
        };
    }
    async generateContent(request, _userPromptId) {
        const contentsArray = this.normalizeContents(request.contents);
        const messages = this.convertToOllamaMessages(contentsArray);
        // Add system instruction if provided in config
        if (request.config?.systemInstruction) {
            const sysInstr = request.config.systemInstruction;
            let systemText = '';
            if (typeof sysInstr === 'string') {
                systemText = sysInstr;
            }
            else {
                const sysArray = this.normalizeContents(sysInstr);
                systemText = sysArray
                    .map((c) => c.parts
                    ?.map((p) => ('text' in p ? p.text : ''))
                    .join(' ') || '')
                    .join('\n');
            }
            if (systemText) {
                messages.unshift({
                    role: 'system',
                    content: systemText,
                });
            }
        }
        const ollamaRequest = {
            model: request.model,
            messages,
            stream: false,
            options: {
                temperature: request.config?.temperature,
                top_p: request.config?.topP,
            },
            tools: this.convertToOllamaTools(request.config?.tools),
        };
        let response;
        try {
            response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(ollamaRequest),
            });
        }
        catch (error) {
            throw new Error(`❌ LOCAL LLM ERROR: Cannot connect to Ollama server at ${this.baseUrl}\n\n` +
                `Troubleshooting:\n` +
                `  1. Check if Ollama is running:\n` +
                `     ollama list\n\n` +
                `  2. Start Ollama if needed:\n` +
                `     ollama serve\n\n` +
                `  3. Check OLLAMA_BASE_URL environment variable\n` +
                `     (default: http://localhost:11434)\n\n` +
                `Original error: ${error}`);
        }
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`❌ LOCAL LLM ERROR: Ollama API returned ${response.status} ${response.statusText}\n\n` +
                `Server URL: ${this.baseUrl}/api/chat\n` +
                `Model: ${request.model}\n\n` +
                `Response: ${errorText}\n\n` +
                `Troubleshooting:\n` +
                `  • Verify the model exists: ollama list\n` +
                `  • Pull the model if needed: ollama pull ${request.model}\n` +
                `  • Check Ollama logs for errors`);
        }
        const ollamaResponse = await response.json();
        return this.convertToGeminiResponse(ollamaResponse);
    }
    async generateContentStream(request, _userPromptId) {
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
            }
            else {
                const sysArray = this.normalizeContents(sysInstr);
                systemText = sysArray
                    .map((c) => c.parts
                    ?.map((p) => ('text' in p ? p.text : ''))
                    .join(' ') || '')
                    .join('\n');
            }
            if (systemText) {
                messages.unshift({
                    role: 'system',
                    content: systemText,
                });
            }
        }
        const ollamaRequest = {
            model: request.model,
            messages,
            stream: true,
            options: {
                temperature: request.config?.temperature,
                top_p: request.config?.topP,
            },
            tools: this.convertToOllamaTools(request.config?.tools),
        };
        async function* streamGenerator() {
            let response;
            try {
                response = await fetch(`${baseUrl}/api/chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(ollamaRequest),
                });
            }
            catch (error) {
                throw new Error(`❌ LOCAL LLM ERROR: Cannot connect to Ollama server at ${baseUrl}\n\n` +
                    `Troubleshooting:\n` +
                    `  1. Check if Ollama is running:\n` +
                    `     ollama list\n\n` +
                    `  2. Start Ollama if needed:\n` +
                    `     ollama serve\n\n` +
                    `  3. Check OLLAMA_BASE_URL environment variable\n` +
                    `     (default: http://localhost:11434)\n\n` +
                    `Original error: ${error}`);
            }
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`❌ LOCAL LLM ERROR: Ollama API returned ${response.status} ${response.statusText}\n\n` +
                    `Server URL: ${baseUrl}/api/chat\n` +
                    `Model: ${ollamaRequest.model}\n\n` +
                    `Response: ${errorText}\n\n` +
                    `Troubleshooting:\n` +
                    `  • Verify the model exists: ollama list\n` +
                    `  • Pull the model if needed: ollama pull ${ollamaRequest.model}\n` +
                    `  • Check Ollama logs for errors`);
            }
            // Ollama streams newline-delimited JSON
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error(`❌ LOCAL LLM ERROR: No response body from Ollama server\n\n` +
                    `This usually indicates a server configuration issue.\n` +
                    `Check Ollama logs for details.`);
            }
            const decoder = new TextDecoder();
            let buffer = '';
            let chunksReceived = 0;
            let hasFinishReason = false;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const ollamaResponse = JSON.parse(line);
                            chunksReceived++;
                            // Track if we've seen done=true
                            if (ollamaResponse.done) {
                                hasFinishReason = true;
                            }
                            yield convertToGeminiResponse(ollamaResponse);
                        }
                        catch (error) {
                            console.warn(`⚠️  LOCAL LLM WARNING: Failed to parse Ollama response (chunk #${chunksReceived}):\n`, `Data: ${line.substring(0, 200)}...\n`, `Error: ${error}`);
                        }
                    }
                }
            }
            // Check if stream completed properly
            if (!hasFinishReason) {
                console.warn(`⚠️  LOCAL LLM WARNING: Ollama stream ended without done=true\n` +
                    `Chunks received: ${chunksReceived}\n` +
                    `This may indicate the model stopped generating unexpectedly.`);
            }
        }
        return streamGenerator();
    }
    async countTokens(request) {
        // Ollama doesn't have a token counting API
        // Approximate: ~4 characters per token for English text
        const contentsArray = this.normalizeContents(request.contents);
        const text = contentsArray
            .map((c) => c.parts?.map((p) => ('text' in p ? p.text : '')).join('') || '')
            .join('');
        const approximateTokens = Math.ceil(text.length / 4);
        return {
            totalTokens: approximateTokens,
        };
    }
    async embedContent(request) {
        // Ollama has an /api/embeddings endpoint
        const contentsArray = this.normalizeContents(request.contents);
        const text = contentsArray
            .map((c) => c.parts?.map((p) => ('text' in p ? p.text : '')).join(' ') ||
            '')
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
            throw new Error(`Ollama embeddings API error: ${response.status} ${response.statusText}`);
        }
        const result = await response.json();
        return {
            embedding: {
                values: result.embedding,
            },
        };
    }
}
//# sourceMappingURL=ollamaContentGenerator.js.map