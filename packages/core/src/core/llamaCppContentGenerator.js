/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * ContentGenerator implementation for llama.cpp (llama-server)
 *
 * llama.cpp provides a local LLM inference server with native function calling support
 * via its OpenAI-compatible API endpoint.
 * API docs: https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md
 */
export class LlamaCppContentGenerator {
    baseUrl;
    constructor(baseUrl = 'http://localhost:8000', _config) {
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
     * Convert Gemini Tool format to llama.cpp format
     */
    convertToLlamaCppTools(tools) {
        if (!tools || tools.length === 0) {
            return undefined;
        }
        // Filter to only Tool types (not CallableTool)
        const toolsArray = tools.filter((t) => 'functionDeclarations' in t);
        console.log(`[LLAMACPP TOOLS DEBUG] Converting ${toolsArray.length} Tool objects`);
        // Flatten all function declarations from all Tool objects
        const result = [];
        for (const tool of toolsArray) {
            if (!tool.functionDeclarations)
                continue;
            console.log(`[LLAMACPP TOOLS DEBUG] Tool has ${tool.functionDeclarations.length} function declarations`);
            for (const decl of tool.functionDeclarations) {
                console.log(`[LLAMACPP TOOLS DEBUG]   - Converting ${decl.name}`);
                result.push({
                    type: 'function',
                    function: {
                        name: decl.name || 'unknown',
                        description: decl.description || '',
                        parameters: decl.parameters || {},
                    },
                });
            }
        }
        console.log(`[LLAMACPP TOOLS DEBUG] Final result: ${result.length} tools - ${result.map((t) => t.function.name).join(', ')}`);
        return result;
    }
    /**
     * Convert Gemini Content format to llama.cpp messages format
     */
    convertToLlamaCppMessages(contents) {
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
     * Convert llama.cpp response to Gemini format
     */
    convertToGeminiResponse(llamaCppResponse) {
        const choice = llamaCppResponse.choices[0];
        const parts = [];
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
                }
                catch (error) {
                    console.warn('Failed to parse tool call arguments:', toolCall.function.arguments, error);
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
        };
    }
    /**
     * Convert llama.cpp stream chunk to Gemini format
     */
    convertStreamChunkToGeminiResponse(chunk) {
        const choice = chunk.choices[0];
        const parts = [];
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
                }
                catch (error) {
                    console.warn('Failed to parse tool call arguments in stream:', toolCall.function.arguments, error);
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
        };
    }
    async generateContent(request, _userPromptId) {
        const contentsArray = this.normalizeContents(request.contents);
        const messages = this.convertToLlamaCppMessages(contentsArray);
        // For llama.cpp: prepend system instruction to first user message instead of separate message
        // This works better with many local models that don't handle system role well
        if (request.config?.systemInstruction && messages.length > 0) {
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
                // Find first user message and prepend system instruction
                const firstUserIdx = messages.findIndex((m) => m.role === 'user');
                if (firstUserIdx >= 0) {
                    messages[firstUserIdx].content =
                        `${systemText}\n\n${messages[firstUserIdx].content}`;
                }
            }
        }
        const llamaCppRequest = {
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
        }
        catch (error) {
            throw new Error(`❌ LOCAL LLM ERROR: Cannot connect to llama.cpp server at ${this.baseUrl}\n\n` +
                `Troubleshooting:\n` +
                `  1. Check if llama.cpp server is running:\n` +
                `     curl ${this.baseUrl}/health\n\n` +
                `  2. Start llama.cpp server if needed:\n` +
                `     llama-server --model /path/to/model.gguf --port 8000\n\n` +
                `  3. Check LLAMACPP_BASE_URL environment variable\n\n` +
                `Original error: ${error}`);
        }
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`❌ LOCAL LLM ERROR: llama.cpp API returned ${response.status} ${response.statusText}\n\n` +
                `Server URL: ${this.baseUrl}/v1/chat/completions\n` +
                `Model: ${request.model}\n\n` +
                `Response: ${errorText}\n\n` +
                `Troubleshooting:\n` +
                `  • Verify the model is loaded in llama.cpp\n` +
                `  • Check server logs for errors\n` +
                `  • Try: curl ${this.baseUrl}/v1/models`);
        }
        const llamaCppResponse = await response.json();
        return this.convertToGeminiResponse(llamaCppResponse);
    }
    async generateContentStream(request, _userPromptId) {
        const baseUrl = this.baseUrl;
        const convertStreamChunkToGeminiResponse = this.convertStreamChunkToGeminiResponse.bind(this);
        const contentsArray = this.normalizeContents(request.contents);
        const messages = this.convertToLlamaCppMessages(contentsArray);
        // For llama.cpp: Use minimal single-message mode by default to avoid timeouts
        // Many local models struggle with long system instructions and conversation history
        // This can be disabled by setting LLAMACPP_FULL_CONTEXT=1
        const testMinimalMode = process.env['LLAMACPP_FULL_CONTEXT'] !== '1';
        if (testMinimalMode) {
            // Find the last user message (the actual user prompt)
            const lastUserMessage = messages.reverse().find((m) => m.role === 'user');
            if (lastUserMessage) {
                // Reset to just this one message
                messages.length = 0;
                // If tools are available, prepend a MINIMAL instruction about using them
                // This is much shorter than the full CLI system prompt
                let userContent = lastUserMessage.content.split('\n\n').pop() ||
                    lastUserMessage.content;
                if (request.config?.tools && request.config.tools.length > 0) {
                    // Ultra-minimal tool instruction - just 15 tokens
                    const toolInstruction = 'You have tools available. Use them when appropriate.\n\n';
                    userContent = toolInstruction + userContent;
                }
                messages.push({
                    role: 'user',
                    content: userContent,
                });
            }
        }
        else {
            // For llama.cpp: prepend system instruction to first user message instead of separate message
            // This works better with many local models that don't handle system role well
            if (request.config?.systemInstruction && messages.length > 0) {
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
                    // Find first user message and prepend system instruction
                    const firstUserIdx = messages.findIndex((m) => m.role === 'user');
                    if (firstUserIdx >= 0) {
                        messages[firstUserIdx].content =
                            `${systemText}\n\n${messages[firstUserIdx].content}`;
                    }
                }
            }
        }
        const llamaCppRequest = {
            model: request.model,
            messages,
            stream: true,
            temperature: request.config?.temperature,
            top_p: request.config?.topP,
            // Re-enable tools for testing - now that we have minimal context, let's see if tools work
            tools: this.convertToLlamaCppTools(request.config?.tools),
            tool_choice: request.config?.tools && request.config.tools.length > 0
                ? 'auto'
                : undefined,
        };
        // Debug: Log request details
        console.log('[LLAMACPP DEBUG] Request details:');
        console.log(`  Model: ${llamaCppRequest.model}`);
        console.log(`  Messages: ${llamaCppRequest.messages.length}`);
        for (let i = 0; i < llamaCppRequest.messages.length; i++) {
            const msg = llamaCppRequest.messages[i];
            const contentPreview = msg.content.substring(0, 100);
            console.log(`  Message ${i} [${msg.role}]: ${contentPreview}${msg.content.length > 100 ? '...' : ''}`);
        }
        console.log(`  Tools: ${llamaCppRequest.tools?.length || 0}`);
        if (llamaCppRequest.tools && llamaCppRequest.tools.length > 0) {
            console.log(`  Tool names: ${llamaCppRequest.tools.map((t) => t.function.name).join(', ')}`);
        }
        async function* streamGenerator() {
            let response;
            try {
                response = await fetch(`${baseUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(llamaCppRequest),
                });
            }
            catch (error) {
                throw new Error(`❌ LOCAL LLM ERROR: Cannot connect to llama.cpp server at ${baseUrl}\n\n` +
                    `Troubleshooting:\n` +
                    `  1. Check if llama.cpp server is running:\n` +
                    `     curl ${baseUrl}/health\n\n` +
                    `  2. Start llama.cpp server if needed:\n` +
                    `     llama-server --model /path/to/model.gguf --port 8000\n\n` +
                    `  3. Check LLAMACPP_BASE_URL environment variable\n\n` +
                    `Original error: ${error}`);
            }
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`❌ LOCAL LLM ERROR: llama.cpp API returned ${response.status} ${response.statusText}\n\n` +
                    `Server URL: ${baseUrl}/v1/chat/completions\n` +
                    `Model: ${llamaCppRequest.model}\n\n` +
                    `Response: ${errorText}\n\n` +
                    `Troubleshooting:\n` +
                    `  • Verify the model is loaded in llama.cpp\n` +
                    `  • Check server logs for errors\n` +
                    `  • Try: curl ${baseUrl}/v1/models`);
            }
            // llama.cpp streams Server-Sent Events (SSE) format
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error(`❌ LOCAL LLM ERROR: No response body from llama.cpp server\n\n` +
                    `This usually indicates a server configuration issue.\n` +
                    `Check llama.cpp server logs for details.`);
            }
            const decoder = new TextDecoder();
            let buffer = '';
            let chunksReceived = 0;
            let hasFinishReason = false;
            // Buffer for accumulating tool call arguments across chunks
            const toolCallBuffers = new Map();
            // Track tool names since they only come in the first chunk
            const toolCallNames = new Map();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('data: ')) {
                        const data = trimmed.slice(6); // Remove 'data: ' prefix
                        if (data === '[DONE]') {
                            // Before returning, try to parse any accumulated tool calls that didn't complete properly
                            for (const [toolId, accumulatedArgs,] of toolCallBuffers.entries()) {
                                if (accumulatedArgs.trim().length > 0) {
                                    try {
                                        console.log(`[LLAMACPP DEBUG] Attempting to parse final buffered tool call: ${accumulatedArgs}`);
                                        const parsedArgs = JSON.parse(accumulatedArgs);
                                        // We don't have the tool name here, so log it for debugging
                                        console.log(`[LLAMACPP DEBUG] Successfully parsed final tool call with args:`, parsedArgs);
                                    }
                                    catch (error) {
                                        console.warn(`⚠️  LOCAL LLM WARNING: Stream ended with incomplete tool call in buffer:\n` +
                                            `  Tool ID: ${toolId}\n` +
                                            `  Buffered: ${accumulatedArgs}\n` +
                                            `  Error: ${error}`);
                                    }
                                }
                            }
                            if (!hasFinishReason) {
                                console.warn(`⚠️  LOCAL LLM WARNING: Stream ended with [DONE] but no finish_reason was received.\n` +
                                    `This may indicate the model stopped generating unexpectedly.\n` +
                                    `Chunks received: ${chunksReceived}`);
                            }
                            return;
                        }
                        try {
                            const chunk = JSON.parse(data);
                            chunksReceived++;
                            // Track if we've seen a finish_reason
                            if (chunk.choices[0]?.finish_reason === 'stop') {
                                hasFinishReason = true;
                            }
                            // Handle streaming tool calls - accumulate arguments across chunks
                            const choice = chunk.choices[0];
                            if (choice?.delta?.tool_calls) {
                                for (const toolCall of choice.delta.tool_calls) {
                                    // llama.cpp sends different IDs in different chunks - use 'current' as single key
                                    const toolId = 'current';
                                    const toolName = toolCall.function.name;
                                    // Store tool name if provided (only in first chunk)
                                    if (toolName) {
                                        toolCallNames.set(toolId, toolName);
                                        console.log(`[LLAMACPP DEBUG] Tool call started: ${toolName}`);
                                    }
                                    // Accumulate arguments
                                    const existingArgs = toolCallBuffers.get(toolId) || '';
                                    const newArgs = toolCall.function.arguments || '';
                                    const accumulated = existingArgs + newArgs;
                                    toolCallBuffers.set(toolId, accumulated);
                                    console.log(`[LLAMACPP DEBUG] Accumulating: ${accumulated}`);
                                    // Only try to parse when we have a complete JSON (ends with '}')
                                    const accumulatedArgs = toolCallBuffers.get(toolId) || '';
                                    if (accumulatedArgs.trim().endsWith('}')) {
                                        try {
                                            // Try to parse - if successful, yield the tool call
                                            const parsedArgs = JSON.parse(accumulatedArgs);
                                            // Get the stored tool name
                                            const storedToolName = toolCallNames.get(toolId);
                                            if (!storedToolName) {
                                                console.warn(`[LLAMACPP DEBUG] No tool name found, skipping`);
                                                continue;
                                            }
                                            console.log(`[LLAMACPP DEBUG] ✅ Successfully parsed complete tool call: ${storedToolName}(${JSON.stringify(parsedArgs)})`);
                                            // Create a response with the complete tool call
                                            const geminiResponse = {
                                                candidates: [
                                                    {
                                                        content: {
                                                            role: 'model',
                                                            parts: [
                                                                {
                                                                    functionCall: {
                                                                        name: storedToolName,
                                                                        args: parsedArgs,
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                        finishReason: choice.finish_reason === 'stop'
                                                            ? 'STOP'
                                                            : undefined,
                                                        index: choice.index,
                                                    },
                                                ],
                                            };
                                            yield geminiResponse;
                                            // Clear the buffers for this tool call
                                            toolCallBuffers.delete(toolId);
                                            toolCallNames.delete(toolId);
                                        }
                                        catch (parseError) {
                                            // Not yet complete JSON, keep accumulating
                                            // Don't warn - this is expected during streaming
                                            console.log(`[LLAMACPP DEBUG] JSON not yet complete: ${parseError}`);
                                        }
                                    }
                                }
                            }
                            else {
                                // No tool calls in this chunk, yield text content normally
                                yield convertStreamChunkToGeminiResponse(chunk);
                            }
                        }
                        catch (error) {
                            console.warn(`⚠️  LOCAL LLM WARNING: Failed to parse stream chunk (chunk #${chunksReceived}):\n`, `Data: ${data.substring(0, 200)}...\n`, `Error: ${error}`);
                        }
                    }
                }
            }
            // Stream ended without [DONE]
            if (!hasFinishReason) {
                console.error(`❌ LOCAL LLM ERROR: Stream ended unexpectedly without finish_reason\n\n` +
                    `Chunks received: ${chunksReceived}\n` +
                    `Server: ${baseUrl}\n\n` +
                    `This usually means:\n` +
                    `  • The model crashed or ran out of memory\n` +
                    `  • The server was interrupted\n` +
                    `  • Network connection was lost\n\n` +
                    `Check llama.cpp server logs for details.`);
            }
        }
        return streamGenerator();
    }
    async countTokens(request) {
        // llama.cpp doesn't have a dedicated token counting endpoint
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
        // llama.cpp supports embeddings via /v1/embeddings endpoint
        const contentsArray = this.normalizeContents(request.contents);
        const text = contentsArray
            .map((c) => c.parts?.map((p) => ('text' in p ? p.text : '')).join(' ') ||
            '')
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
            throw new Error(`llama.cpp embeddings API error: ${response.status} ${response.statusText}`);
        }
        const result = await response.json();
        return {
            embedding: {
                values: result.data[0].embedding,
            },
        };
    }
}
//# sourceMappingURL=llamaCppContentGenerator.js.map