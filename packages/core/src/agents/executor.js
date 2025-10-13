/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { reportError } from '../utils/errorReporting.js';
import { GeminiChat, StreamEventType } from '../core/geminiChat.js';
import { Type } from '@google/genai';
import { executeToolCall } from '../core/nonInteractiveToolExecutor.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { getDirectoryContextString } from '../utils/environmentContext.js';
import { GlobTool as _GlobTool } from '../tools/glob.js';
import { GrepTool as _GrepTool } from '../tools/grep.js';
import { RipGrepTool as _RipGrepTool } from '../tools/ripGrep.js';
import { LSTool as _LSTool } from '../tools/ls.js';
import { MemoryTool as _MemoryTool } from '../tools/memoryTool.js';
import { ReadFileTool as _ReadFileTool } from '../tools/read-file.js';
import { ReadManyFilesTool as _ReadManyFilesTool } from '../tools/read-many-files.js';
import { WebSearchTool as _WebSearchTool } from '../tools/web-search.js';
import { WriteFileTool as _WriteFileTool } from '../tools/write-file.js';
import { EditTool as _EditTool } from '../tools/edit.js';
import { ShellTool as _ShellTool } from '../tools/shell.js';
import { AgentTerminateMode } from './types.js';
import { templateString } from './utils.js';
import { parseThought } from '../utils/thoughtUtils.js';
import {} from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AuthType } from '../core/contentGenerator.js';
import { OllamaContentGenerator } from '../core/ollamaContentGenerator.js';
import { LlamaCppContentGenerator } from '../core/llamaCppContentGenerator.js';
import { LoggingContentGenerator } from '../core/loggingContentGenerator.js';
const TASK_COMPLETE_TOOL_NAME = 'complete_task';
/**
 * Executes an agent loop based on an {@link AgentDefinition}.
 *
 * This executor runs the agent in a loop, calling tools until it calls the
 * mandatory `complete_task` tool to signal completion.
 */
export class AgentExecutor {
    definition;
    agentId;
    toolRegistry;
    runtimeContext;
    onActivity;
    /**
     * Creates and validates a new `AgentExecutor` instance.
     *
     * This method ensures that all tools specified in the agent's definition are
     * safe for non-interactive use before creating the executor.
     *
     * @param definition The definition object for the agent.
     * @param runtimeContext The global runtime configuration.
     * @param onActivity An optional callback to receive activity events.
     * @returns A promise that resolves to a new `AgentExecutor` instance.
     */
    static async create(definition, runtimeContext, onActivity) {
        // Create an isolated tool registry for this agent instance.
        const agentToolRegistry = new ToolRegistry(runtimeContext);
        const parentToolRegistry = await runtimeContext.getToolRegistry();
        if (definition.toolConfig) {
            console.log('[EXECUTOR DEBUG] Agent tools config:', definition.toolConfig.tools);
            console.log('[EXECUTOR DEBUG] Available tools in parent registry:', parentToolRegistry.getAllToolNames());
            for (const toolRef of definition.toolConfig.tools) {
                if (typeof toolRef === 'string') {
                    // If the tool is referenced by name, retrieve it from the parent
                    // registry and register it with the agent's isolated registry.
                    console.log('[EXECUTOR DEBUG] Looking up tool by name:', toolRef);
                    const toolFromParent = parentToolRegistry.getTool(toolRef);
                    if (toolFromParent) {
                        console.log('[EXECUTOR DEBUG] Found tool in parent registry:', toolRef);
                        agentToolRegistry.registerTool(toolFromParent);
                    }
                    else {
                        console.log('[EXECUTOR DEBUG] Tool not found in parent registry:', toolRef);
                    }
                }
                else if (typeof toolRef === 'object' &&
                    'name' in toolRef &&
                    'build' in toolRef) {
                    agentToolRegistry.registerTool(toolRef);
                }
                // Note: Raw `FunctionDeclaration` objects in the config don't need to be
                // registered; their schemas are passed directly to the model later.
            }
            console.log('[EXECUTOR DEBUG] Registered tools in agent registry:', agentToolRegistry.getAllToolNames());
            // Validate that all registered tools are safe for non-interactive
            // execution.
            await AgentExecutor.validateTools(agentToolRegistry, definition.name);
        }
        return new AgentExecutor(definition, runtimeContext, agentToolRegistry, onActivity);
    }
    /**
     * Constructs a new AgentExecutor instance.
     *
     * @private This constructor is private. Use the static `create` method to
     * instantiate the class.
     */
    constructor(definition, runtimeContext, toolRegistry, onActivity) {
        this.definition = definition;
        this.runtimeContext = runtimeContext;
        this.toolRegistry = toolRegistry;
        this.onActivity = onActivity;
        const randomIdPart = Math.random().toString(36).slice(2, 8);
        this.agentId = `${this.definition.name}-${randomIdPart}`;
    }
    /**
     * Runs the agent.
     *
     * @param inputs The validated input parameters for this invocation.
     * @param signal An `AbortSignal` for cancellation.
     * @returns A promise that resolves to the agent's final output.
     */
    async run(inputs, signal) {
        const startTime = Date.now();
        let turnCounter = 0;
        try {
            const chat = await this.createChatObject(inputs);
            const tools = this.prepareToolsList();
            let terminateReason = AgentTerminateMode.ERROR;
            let finalResult = null;
            const query = this.definition.promptConfig.query
                ? templateString(this.definition.promptConfig.query, inputs)
                : 'Get Started!';
            let currentMessage = { role: 'user', parts: [{ text: query }] };
            while (true) {
                // Check for termination conditions like max turns or timeout.
                const reason = this.checkTermination(startTime, turnCounter);
                if (reason) {
                    terminateReason = reason;
                    break;
                }
                if (signal.aborted) {
                    terminateReason = AgentTerminateMode.ABORTED;
                    break;
                }
                // Call model
                const promptId = `${this.runtimeContext.getSessionId()}#${this.agentId}#${turnCounter++}`;
                const { functionCalls } = await this.callModel(chat, currentMessage, tools, signal, promptId);
                if (signal.aborted) {
                    terminateReason = AgentTerminateMode.ABORTED;
                    break;
                }
                // If the model stops calling tools without calling complete_task, it's an error.
                if (functionCalls.length === 0) {
                    terminateReason = AgentTerminateMode.ERROR;
                    finalResult = `Agent stopped calling tools but did not call '${TASK_COMPLETE_TOOL_NAME}' to finalize the session.`;
                    this.emitActivity('ERROR', {
                        error: finalResult,
                        context: 'protocol_violation',
                    });
                    break;
                }
                const { nextMessage, submittedOutput, taskCompleted } = await this.processFunctionCalls(functionCalls, signal, promptId);
                if (taskCompleted) {
                    finalResult = submittedOutput ?? 'Task completed successfully.';
                    terminateReason = AgentTerminateMode.GOAL;
                    break;
                }
                currentMessage = nextMessage;
            }
            if (terminateReason === AgentTerminateMode.GOAL) {
                return {
                    result: finalResult || 'Task completed.',
                    terminate_reason: terminateReason,
                };
            }
            return {
                result: finalResult || 'Agent execution was terminated before completion.',
                terminate_reason: terminateReason,
            };
        }
        catch (error) {
            this.emitActivity('ERROR', { error: String(error) });
            throw error; // Re-throw the error for the parent context to handle.
        }
    }
    /**
     * Calls the generative model with the current context and tools.
     *
     * @returns The model's response, including any tool calls or text.
     */
    async callModel(chat, message, tools, signal, promptId) {
        const messageParams = {
            message: message.parts || [],
            config: {
                abortSignal: signal,
                tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
            },
        };
        const responseStream = await chat.sendMessageStream(this.definition.modelConfig.model, messageParams, promptId);
        const functionCalls = [];
        let textResponse = '';
        for await (const resp of responseStream) {
            if (signal.aborted)
                break;
            if (resp.type === StreamEventType.CHUNK) {
                const chunk = resp.value;
                const parts = chunk.candidates?.[0]?.content?.parts;
                // Extract and emit any subject "thought" content from the model.
                const { subject } = parseThought(parts?.find((p) => p.thought)?.text || '');
                if (subject) {
                    this.emitActivity('THOUGHT_CHUNK', { text: subject });
                }
                // Collect any function calls requested by the model.
                if (chunk.functionCalls) {
                    functionCalls.push(...chunk.functionCalls);
                }
                // Handle text response (non-thought text)
                const text = parts
                    ?.filter((p) => !p.thought && p.text)
                    .map((p) => p.text)
                    .join('') || '';
                if (text) {
                    textResponse += text;
                }
            }
        }
        return { functionCalls, textResponse };
    }
    /**
     * Creates a provider-specific Config object for agents that specify a custom provider.
     * This creates a new Config with a ContentGenerator configured for the specified provider.
     */
    async createProviderSpecificConfig(provider, _model) {
        // Clone the runtime context to avoid modifying the original
        const providerConfig = Object.create(this.runtimeContext);
        if (provider === 'ollama') {
            // Get Ollama base URL from environment or use default
            const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';
            // Create Ollama content generator
            const ollamaGenerator = new LoggingContentGenerator(new OllamaContentGenerator(ollamaBaseUrl, this.runtimeContext), this.runtimeContext);
            // Override getContentGenerator to return Ollama generator
            providerConfig.getContentGenerator = () => ollamaGenerator;
            // Override getContentGeneratorConfig to return Ollama config
            providerConfig.getContentGeneratorConfig = () => ({
                authType: AuthType.LOCAL,
                ollamaBaseUrl,
            });
        }
        else if (provider === 'llamacpp') {
            // Get llama.cpp base URL from environment or use default
            const llamaCppBaseUrl = process.env['LLAMACPP_BASE_URL'] || 'http://localhost:8000';
            // Create llama.cpp content generator
            const llamaCppGenerator = new LoggingContentGenerator(new LlamaCppContentGenerator(llamaCppBaseUrl, this.runtimeContext), this.runtimeContext);
            // Override getContentGenerator to return llama.cpp generator
            providerConfig.getContentGenerator = () => llamaCppGenerator;
            // Override getContentGeneratorConfig to return llama.cpp config
            providerConfig.getContentGeneratorConfig = () => ({
                authType: AuthType.LOCAL, // Use LOCAL auth type for local server
                ollamaBaseUrl: llamaCppBaseUrl, // Reuse ollamaBaseUrl field for llama.cpp URL
            });
        }
        else {
            throw new Error(`Unsupported provider: ${provider}. Supported providers: 'ollama', 'llamacpp'.`);
        }
        return providerConfig;
    }
    /** Initializes a `GeminiChat` instance for the agent run. */
    async createChatObject(inputs) {
        const { promptConfig, modelConfig } = this.definition;
        if (!promptConfig.systemPrompt && !promptConfig.initialMessages) {
            throw new Error('PromptConfig must define either `systemPrompt` or `initialMessages`.');
        }
        const startHistory = this.applyTemplateToInitialMessages(promptConfig.initialMessages ?? [], inputs);
        // Build system instruction from the templated prompt string.
        const systemInstruction = promptConfig.systemPrompt
            ? await this.buildSystemPrompt(inputs)
            : undefined;
        try {
            const generationConfig = {
                temperature: modelConfig.temp,
                topP: modelConfig.top_p,
                thinkingConfig: {
                    includeThoughts: true,
                    thinkingBudget: modelConfig.thinkingBudget ?? -1,
                },
            };
            if (systemInstruction) {
                generationConfig.systemInstruction = systemInstruction;
            }
            // If agent specifies a provider, create agent-specific config
            let runtimeConfig = this.runtimeContext;
            if (modelConfig.provider) {
                runtimeConfig = await this.createProviderSpecificConfig(modelConfig.provider, modelConfig.model);
            }
            return new GeminiChat(runtimeConfig, generationConfig, startHistory);
        }
        catch (error) {
            await reportError(error, `Error initializing Gemini chat for agent ${this.definition.name}.`, startHistory, 'startChat');
            // Re-throw as a more specific error after reporting.
            throw new Error(`Failed to create chat object: ${error}`);
        }
    }
    /**
     * Executes function calls requested by the model and returns the results.
     *
     * @returns A new `Content` object for history, any submitted output, and completion status.
     */
    async processFunctionCalls(functionCalls, signal, promptId) {
        const allowedToolNames = new Set(this.toolRegistry.getAllToolNames());
        // Always allow the completion tool
        allowedToolNames.add(TASK_COMPLETE_TOOL_NAME);
        let submittedOutput = null;
        let taskCompleted = false;
        // We'll collect promises for the tool executions
        const toolExecutionPromises = [];
        // And we'll need a place to store the synchronous results (like complete_task or blocked calls)
        const syncResponseParts = [];
        for (const [index, functionCall] of functionCalls.entries()) {
            const callId = functionCall.id ?? `${promptId}-${index}`;
            const args = (functionCall.args ?? {});
            this.emitActivity('TOOL_CALL_START', {
                name: functionCall.name,
                args,
            });
            if (functionCall.name === TASK_COMPLETE_TOOL_NAME) {
                if (taskCompleted) {
                    // We already have a completion from this turn. Ignore subsequent ones.
                    const error = 'Task already marked complete in this turn. Ignoring duplicate call.';
                    syncResponseParts.push({
                        functionResponse: {
                            name: TASK_COMPLETE_TOOL_NAME,
                            response: { error },
                            id: callId,
                        },
                    });
                    this.emitActivity('ERROR', {
                        context: 'tool_call',
                        name: functionCall.name,
                        error,
                    });
                    continue;
                }
                const { outputConfig } = this.definition;
                taskCompleted = true; // Signal completion regardless of output presence
                if (outputConfig) {
                    const outputName = outputConfig.outputName;
                    if (args[outputName] !== undefined) {
                        const outputValue = args[outputName];
                        const validationResult = outputConfig.schema.safeParse(outputValue);
                        if (!validationResult.success) {
                            taskCompleted = false; // Validation failed, revoke completion
                            const error = `Output validation failed: ${JSON.stringify(validationResult.error.flatten())}`;
                            syncResponseParts.push({
                                functionResponse: {
                                    name: TASK_COMPLETE_TOOL_NAME,
                                    response: { error },
                                    id: callId,
                                },
                            });
                            this.emitActivity('ERROR', {
                                context: 'tool_call',
                                name: functionCall.name,
                                error,
                            });
                            continue;
                        }
                        const validatedOutput = validationResult.data;
                        if (this.definition.processOutput) {
                            submittedOutput = this.definition.processOutput(validatedOutput);
                        }
                        else {
                            submittedOutput =
                                typeof outputValue === 'string'
                                    ? outputValue
                                    : JSON.stringify(outputValue, null, 2);
                        }
                        syncResponseParts.push({
                            functionResponse: {
                                name: TASK_COMPLETE_TOOL_NAME,
                                response: { result: 'Output submitted and task completed.' },
                                id: callId,
                            },
                        });
                        this.emitActivity('TOOL_CALL_END', {
                            name: functionCall.name,
                            output: 'Output submitted and task completed.',
                        });
                    }
                    else {
                        // Failed to provide required output.
                        taskCompleted = false; // Revoke completion status
                        const error = `Missing required argument '${outputName}' for completion.`;
                        syncResponseParts.push({
                            functionResponse: {
                                name: TASK_COMPLETE_TOOL_NAME,
                                response: { error },
                                id: callId,
                            },
                        });
                        this.emitActivity('ERROR', {
                            context: 'tool_call',
                            name: functionCall.name,
                            error,
                        });
                    }
                }
                else {
                    // No output expected. Just signal completion.
                    submittedOutput = 'Task completed successfully.';
                    syncResponseParts.push({
                        functionResponse: {
                            name: TASK_COMPLETE_TOOL_NAME,
                            response: { status: 'Task marked complete.' },
                            id: callId,
                        },
                    });
                    this.emitActivity('TOOL_CALL_END', {
                        name: functionCall.name,
                        output: 'Task marked complete.',
                    });
                }
                continue;
            }
            // Handle standard tools
            if (!allowedToolNames.has(functionCall.name)) {
                const error = `Unauthorized tool call: '${functionCall.name}' is not available to this agent.`;
                console.warn(`[AgentExecutor] Blocked call: ${error}`);
                syncResponseParts.push({
                    functionResponse: {
                        name: functionCall.name,
                        id: callId,
                        response: { error },
                    },
                });
                this.emitActivity('ERROR', {
                    context: 'tool_call_unauthorized',
                    name: functionCall.name,
                    callId,
                    error,
                });
                continue;
            }
            const requestInfo = {
                callId,
                name: functionCall.name,
                args,
                isClientInitiated: true,
                prompt_id: promptId,
            };
            // Create a promise for the tool execution
            const executionPromise = (async () => {
                const toolResponse = await executeToolCall(this.runtimeContext, requestInfo, signal);
                if (toolResponse.error) {
                    this.emitActivity('ERROR', {
                        context: 'tool_call',
                        name: functionCall.name,
                        error: toolResponse.error.message,
                    });
                }
                else {
                    this.emitActivity('TOOL_CALL_END', {
                        name: functionCall.name,
                        output: toolResponse.resultDisplay,
                    });
                }
                return toolResponse.responseParts;
            })();
            toolExecutionPromises.push(executionPromise);
        }
        // Wait for all tool executions to complete
        const asyncResults = await Promise.all(toolExecutionPromises);
        // Combine all response parts
        const toolResponseParts = [...syncResponseParts];
        for (const result of asyncResults) {
            if (result) {
                toolResponseParts.push(...result);
            }
        }
        // If all authorized tool calls failed (and task isn't complete), provide a generic error.
        if (functionCalls.length > 0 &&
            toolResponseParts.length === 0 &&
            !taskCompleted) {
            toolResponseParts.push({
                text: 'All tool calls failed or were unauthorized. Please analyze the errors and try an alternative approach.',
            });
        }
        return {
            nextMessage: { role: 'user', parts: toolResponseParts },
            submittedOutput,
            taskCompleted,
        };
    }
    /**
     * Prepares the list of tool function declarations to be sent to the model.
     */
    prepareToolsList() {
        const toolsList = [];
        const { toolConfig, outputConfig } = this.definition;
        if (toolConfig) {
            const toolNamesToLoad = [];
            for (const toolRef of toolConfig.tools) {
                if (typeof toolRef === 'string') {
                    toolNamesToLoad.push(toolRef);
                }
                else if (typeof toolRef === 'object' && 'schema' in toolRef) {
                    // Tool instance with an explicit schema property.
                    toolsList.push(toolRef.schema);
                }
                else {
                    // Raw `FunctionDeclaration` object.
                    toolsList.push(toolRef);
                }
            }
            // Add schemas from tools that were registered by name.
            toolsList.push(...this.toolRegistry.getFunctionDeclarationsFiltered(toolNamesToLoad));
        }
        // Always inject complete_task.
        // Configure its schema based on whether output is expected.
        const completeTool = {
            name: TASK_COMPLETE_TOOL_NAME,
            description: outputConfig
                ? 'Call this tool to submit your final answer and complete the task. This is the ONLY way to finish.'
                : 'Call this tool to signal that you have completed your task. This is the ONLY way to finish.',
            parameters: {
                type: Type.OBJECT,
                properties: {},
                required: [],
            },
        };
        if (outputConfig) {
            const jsonSchema = zodToJsonSchema(outputConfig.schema);
            const { $schema: _$schema, definitions: _definitions, ...schema } = jsonSchema;
            completeTool.parameters.properties[outputConfig.outputName] =
                schema;
            completeTool.parameters.required.push(outputConfig.outputName);
        }
        toolsList.push(completeTool);
        return toolsList;
    }
    /** Builds the system prompt from the agent definition and inputs. */
    async buildSystemPrompt(inputs) {
        const { promptConfig } = this.definition;
        if (!promptConfig.systemPrompt) {
            return '';
        }
        // Inject user inputs into the prompt template.
        let finalPrompt = templateString(promptConfig.systemPrompt, inputs);
        // Append environment context (CWD and folder structure).
        const dirContext = await getDirectoryContextString(this.runtimeContext);
        finalPrompt += `\n\n# Environment Context\n${dirContext}`;
        // Append task completion requirement.
        finalPrompt += `

When you have completed your task, you MUST call the \`${TASK_COMPLETE_TOOL_NAME}\` tool. Do not call any other tools in the same turn as \`${TASK_COMPLETE_TOOL_NAME}\`. This is the ONLY way to complete your mission.`;
        return finalPrompt;
    }
    /**
     * Applies template strings to initial messages.
     *
     * @param initialMessages The initial messages from the prompt config.
     * @param inputs The validated input parameters for this invocation.
     * @returns A new array of `Content` with templated strings.
     */
    applyTemplateToInitialMessages(initialMessages, inputs) {
        return initialMessages.map((content) => {
            const newParts = (content.parts ?? []).map((part) => {
                if ('text' in part && part.text !== undefined) {
                    return { text: templateString(part.text, inputs) };
                }
                return part;
            });
            return { ...content, parts: newParts };
        });
    }
    /**
     * Validates that all tools in a registry are safe for subagent use.
     *
     * With message bus support, subagents can request user confirmation for any tool,
     * so no validation is needed. This method is kept for backwards compatibility.
     *
     * @throws An error if a tool is not safe (currently never throws with message bus support)
     */
    static async validateTools(_toolRegistry, _agentName) {
        // With message bus integration, all tools are safe because they can request
        // user confirmation when needed. No validation required.
        //
        // If message bus were disabled, we would need to restrict to read-only tools:
        // const readOnlyTools = [LSTool.Name, ReadFileTool.Name, GrepTool.Name, ...];
        // No-op - all tools are allowed with confirmation support
        return;
    }
    /**
     * Checks if the agent should terminate due to exceeding configured limits.
     *
     * @returns The reason for termination, or `null` if execution can continue.
     */
    checkTermination(startTime, turnCounter) {
        const { runConfig } = this.definition;
        if (runConfig.max_turns && turnCounter >= runConfig.max_turns) {
            return AgentTerminateMode.MAX_TURNS;
        }
        const elapsedMinutes = (Date.now() - startTime) / (1000 * 60);
        if (elapsedMinutes >= runConfig.max_time_minutes) {
            return AgentTerminateMode.TIMEOUT;
        }
        return null;
    }
    /** Emits an activity event to the configured callback. */
    emitActivity(type, data) {
        if (this.onActivity) {
            const event = {
                isSubagentActivityEvent: true,
                agentName: this.definition.name,
                type,
                data,
            };
            this.onActivity(event);
        }
    }
}
//# sourceMappingURL=executor.js.map