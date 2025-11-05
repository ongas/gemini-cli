/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { DiscoveredMCPTool } from '../tools/mcp-tool.js';
import { AuthType } from '../core/contentGenerator.js';
import { getDecisionFromOutcome, ToolCallDecision, } from './tool-call-decision.js';
export { ToolCallDecision };
import { getCommonAttributes } from './telemetryAttributes.js';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
export const EVENT_CLI_CONFIG = 'gemini_cli.config';
export class StartSessionEvent {
    'event.name';
    'event.timestamp';
    model;
    embedding_model;
    sandbox_enabled;
    core_tools_enabled;
    approval_mode;
    api_key_enabled;
    vertex_ai_enabled;
    debug_enabled;
    mcp_servers;
    telemetry_enabled;
    telemetry_log_user_prompts_enabled;
    file_filtering_respect_git_ignore;
    mcp_servers_count;
    mcp_tools_count;
    mcp_tools;
    output_format;
    extensions_count;
    extension_ids;
    constructor(config, toolRegistry) {
        const generatorConfig = config.getContentGeneratorConfig();
        const mcpServers = config.getMcpServers();
        let useGemini = false;
        let useVertex = false;
        if (generatorConfig && generatorConfig.authType) {
            useGemini = generatorConfig.authType === AuthType.USE_GEMINI;
            useVertex = generatorConfig.authType === AuthType.USE_VERTEX_AI;
        }
        this['event.name'] = 'cli_config';
        this['event.timestamp'] = new Date().toISOString();
        this.model = config.getModel();
        this.embedding_model = config.getEmbeddingModel();
        this.sandbox_enabled =
            typeof config.getSandbox() === 'string' || !!config.getSandbox();
        this.core_tools_enabled = (config.getCoreTools() ?? []).join(',');
        this.approval_mode = config.getApprovalMode();
        this.api_key_enabled = useGemini || useVertex;
        this.vertex_ai_enabled = useVertex;
        this.debug_enabled = config.getDebugMode();
        this.mcp_servers = mcpServers ? Object.keys(mcpServers).join(',') : '';
        this.telemetry_enabled = config.getTelemetryEnabled();
        this.telemetry_log_user_prompts_enabled =
            config.getTelemetryLogPromptsEnabled();
        this.file_filtering_respect_git_ignore =
            config.getFileFilteringRespectGitIgnore();
        this.mcp_servers_count = mcpServers ? Object.keys(mcpServers).length : 0;
        this.output_format = config.getOutputFormat();
        const extensions = config.getExtensions();
        this.extensions_count = extensions.length;
        this.extension_ids = extensions.map((e) => e.id).join(',');
        if (toolRegistry) {
            const mcpTools = toolRegistry
                .getAllTools()
                .filter((tool) => tool instanceof DiscoveredMCPTool);
            this.mcp_tools_count = mcpTools.length;
            this.mcp_tools = mcpTools
                .map((tool) => tool.name)
                .join(',');
        }
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_CLI_CONFIG,
            'event.timestamp': this['event.timestamp'],
            model: this.model,
            embedding_model: this.embedding_model,
            sandbox_enabled: this.sandbox_enabled,
            core_tools_enabled: this.core_tools_enabled,
            approval_mode: this.approval_mode,
            api_key_enabled: this.api_key_enabled,
            vertex_ai_enabled: this.vertex_ai_enabled,
            log_user_prompts_enabled: this.telemetry_log_user_prompts_enabled,
            file_filtering_respect_git_ignore: this.file_filtering_respect_git_ignore,
            debug_mode: this.debug_enabled,
            mcp_servers: this.mcp_servers,
            mcp_servers_count: this.mcp_servers_count,
            mcp_tools: this.mcp_tools,
            mcp_tools_count: this.mcp_tools_count,
            output_format: this.output_format,
            extensions_count: this.extensions_count,
            extension_ids: this.extension_ids,
        };
    }
    toLogBody() {
        return 'CLI configuration loaded.';
    }
}
export class EndSessionEvent {
    'event.name';
    'event.timestamp';
    session_id;
    constructor(config) {
        this['event.name'] = 'end_session';
        this['event.timestamp'] = new Date().toISOString();
        this.session_id = config?.getSessionId();
    }
}
export const EVENT_USER_PROMPT = 'gemini_cli.user_prompt';
export class UserPromptEvent {
    'event.name';
    'event.timestamp';
    prompt_length;
    prompt_id;
    auth_type;
    prompt;
    constructor(prompt_length, prompt_Id, auth_type, prompt) {
        this['event.name'] = 'user_prompt';
        this['event.timestamp'] = new Date().toISOString();
        this.prompt_length = prompt_length;
        this.prompt_id = prompt_Id;
        this.auth_type = auth_type;
        this.prompt = prompt;
    }
    toOpenTelemetryAttributes(config) {
        const attributes = {
            ...getCommonAttributes(config),
            'event.name': EVENT_USER_PROMPT,
            'event.timestamp': this['event.timestamp'],
            prompt_length: this.prompt_length,
            prompt_id: this.prompt_id,
        };
        if (this.auth_type) {
            attributes['auth_type'] = this.auth_type;
        }
        if (config.getTelemetryLogPromptsEnabled()) {
            attributes['prompt'] = this.prompt;
        }
        return attributes;
    }
    toLogBody() {
        return `User prompt. Length: ${this.prompt_length}.`;
    }
}
export const EVENT_TOOL_CALL = 'gemini_cli.tool_call';
export class ToolCallEvent {
    'event.name';
    'event.timestamp';
    function_name;
    function_args;
    duration_ms;
    success;
    decision;
    error;
    error_type;
    prompt_id;
    tool_type;
    content_length;
    mcp_server_name;
    extension_id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata;
    constructor(call, function_name, function_args, duration_ms, success, prompt_id, tool_type, error) {
        this['event.name'] = 'tool_call';
        this['event.timestamp'] = new Date().toISOString();
        if (call) {
            this.function_name = call.request.name;
            this.function_args = call.request.args;
            this.duration_ms = call.durationMs ?? 0;
            this.success = call.status === 'success';
            this.decision = call.outcome
                ? getDecisionFromOutcome(call.outcome)
                : undefined;
            this.error = call.response.error?.message;
            this.error_type = call.response.errorType;
            this.prompt_id = call.request.prompt_id;
            this.content_length = call.response.contentLength;
            if (typeof call.tool !== 'undefined' &&
                call.tool instanceof DiscoveredMCPTool) {
                this.tool_type = 'mcp';
                this.mcp_server_name = call.tool.serverName;
                this.extension_id = call.tool.extensionId;
            }
            else {
                this.tool_type = 'native';
            }
            if (call.status === 'success' &&
                typeof call.response.resultDisplay === 'object' &&
                call.response.resultDisplay !== null &&
                'diffStat' in call.response.resultDisplay) {
                const diffStat = call.response.resultDisplay.diffStat;
                if (diffStat) {
                    this.metadata = {
                        model_added_lines: diffStat.model_added_lines,
                        model_removed_lines: diffStat.model_removed_lines,
                        model_added_chars: diffStat.model_added_chars,
                        model_removed_chars: diffStat.model_removed_chars,
                        user_added_lines: diffStat.user_added_lines,
                        user_removed_lines: diffStat.user_removed_lines,
                        user_added_chars: diffStat.user_added_chars,
                        user_removed_chars: diffStat.user_removed_chars,
                    };
                }
            }
        }
        else {
            this.function_name = function_name;
            this.function_args = function_args;
            this.duration_ms = duration_ms;
            this.success = success;
            this.prompt_id = prompt_id;
            this.tool_type = tool_type;
            this.error = error;
        }
    }
    toOpenTelemetryAttributes(config) {
        const attributes = {
            ...getCommonAttributes(config),
            'event.name': EVENT_TOOL_CALL,
            'event.timestamp': this['event.timestamp'],
            function_name: this.function_name,
            function_args: safeJsonStringify(this.function_args, 2),
            duration_ms: this.duration_ms,
            success: this.success,
            decision: this.decision,
            prompt_id: this.prompt_id,
            tool_type: this.tool_type,
            content_length: this.content_length,
            mcp_server_name: this.mcp_server_name,
            extension_id: this.extension_id,
            metadata: this.metadata,
        };
        if (this.error) {
            attributes['error'] = this.error;
            attributes['error.message'] = this.error;
            if (this.error_type) {
                attributes['error_type'] = this.error_type;
                attributes['error.type'] = this.error_type;
            }
        }
        return attributes;
    }
    toLogBody() {
        return `Tool call: ${this.function_name}${this.decision ? `. Decision: ${this.decision}` : ''}. Success: ${this.success}. Duration: ${this.duration_ms}ms.`;
    }
}
export const EVENT_API_REQUEST = 'gemini_cli.api_request';
export class ApiRequestEvent {
    'event.name';
    'event.timestamp';
    model;
    prompt_id;
    request_text;
    constructor(model, prompt_id, request_text) {
        this['event.name'] = 'api_request';
        this['event.timestamp'] = new Date().toISOString();
        this.model = model;
        this.prompt_id = prompt_id;
        this.request_text = request_text;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_API_REQUEST,
            'event.timestamp': this['event.timestamp'],
            model: this.model,
            prompt_id: this.prompt_id,
            request_text: this.request_text,
        };
    }
    toLogBody() {
        return `API request to ${this.model}.`;
    }
}
export const EVENT_API_ERROR = 'gemini_cli.api_error';
export class ApiErrorEvent {
    'event.name';
    'event.timestamp';
    model;
    error;
    error_type;
    status_code;
    duration_ms;
    prompt_id;
    auth_type;
    constructor(model, error, duration_ms, prompt_id, auth_type, error_type, status_code) {
        this['event.name'] = 'api_error';
        this['event.timestamp'] = new Date().toISOString();
        this.model = model;
        this.error = error;
        this.error_type = error_type;
        this.status_code = status_code;
        this.duration_ms = duration_ms;
        this.prompt_id = prompt_id;
        this.auth_type = auth_type;
    }
    toOpenTelemetryAttributes(config) {
        const attributes = {
            ...getCommonAttributes(config),
            'event.name': EVENT_API_ERROR,
            'event.timestamp': this['event.timestamp'],
            ['error.message']: this.error,
            model_name: this.model,
            duration: this.duration_ms,
            model: this.model,
            error: this.error,
            status_code: this.status_code,
            duration_ms: this.duration_ms,
            prompt_id: this.prompt_id,
            auth_type: this.auth_type,
        };
        if (this.error_type) {
            attributes['error.type'] = this.error_type;
        }
        if (typeof this.status_code === 'number') {
            attributes[SemanticAttributes.HTTP_STATUS_CODE] = this.status_code;
        }
        return attributes;
    }
    toLogBody() {
        return `API error for ${this.model}. Error: ${this.error}. Duration: ${this.duration_ms}ms.`;
    }
}
export const EVENT_API_RESPONSE = 'gemini_cli.api_response';
export class ApiResponseEvent {
    'event.name';
    'event.timestamp';
    model;
    status_code;
    duration_ms;
    input_token_count;
    output_token_count;
    cached_content_token_count;
    thoughts_token_count;
    tool_token_count;
    total_token_count;
    response_text;
    prompt_id;
    auth_type;
    constructor(model, duration_ms, prompt_id, auth_type, usage_data, response_text) {
        this['event.name'] = 'api_response';
        this['event.timestamp'] = new Date().toISOString();
        this.model = model;
        this.duration_ms = duration_ms;
        this.status_code = 200;
        this.input_token_count = usage_data?.promptTokenCount ?? 0;
        this.output_token_count = usage_data?.candidatesTokenCount ?? 0;
        this.cached_content_token_count = usage_data?.cachedContentTokenCount ?? 0;
        this.thoughts_token_count = usage_data?.thoughtsTokenCount ?? 0;
        this.tool_token_count = usage_data?.toolUsePromptTokenCount ?? 0;
        this.total_token_count = usage_data?.totalTokenCount ?? 0;
        this.response_text = response_text;
        this.prompt_id = prompt_id;
        this.auth_type = auth_type;
    }
    toOpenTelemetryAttributes(config) {
        const attributes = {
            ...getCommonAttributes(config),
            'event.name': EVENT_API_RESPONSE,
            'event.timestamp': this['event.timestamp'],
            model: this.model,
            duration_ms: this.duration_ms,
            input_token_count: this.input_token_count,
            output_token_count: this.output_token_count,
            cached_content_token_count: this.cached_content_token_count,
            thoughts_token_count: this.thoughts_token_count,
            tool_token_count: this.tool_token_count,
            total_token_count: this.total_token_count,
            prompt_id: this.prompt_id,
            auth_type: this.auth_type,
            status_code: this.status_code,
        };
        if (this.response_text) {
            attributes['response_text'] = this.response_text;
        }
        if (this.status_code) {
            if (typeof this.status_code === 'number') {
                attributes[SemanticAttributes.HTTP_STATUS_CODE] = this.status_code;
            }
        }
        return attributes;
    }
    toLogBody() {
        return `API response from ${this.model}. Status: ${this.status_code || 'N/A'}. Duration: ${this.duration_ms}ms.`;
    }
}
export const EVENT_FLASH_FALLBACK = 'gemini_cli.flash_fallback';
export class FlashFallbackEvent {
    'event.name';
    'event.timestamp';
    auth_type;
    constructor(auth_type) {
        this['event.name'] = 'flash_fallback';
        this['event.timestamp'] = new Date().toISOString();
        this.auth_type = auth_type;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_FLASH_FALLBACK,
            'event.timestamp': this['event.timestamp'],
            auth_type: this.auth_type,
        };
    }
    toLogBody() {
        return `Switching to flash as Fallback.`;
    }
}
export const EVENT_RIPGREP_FALLBACK = 'gemini_cli.ripgrep_fallback';
export class RipgrepFallbackEvent {
    error;
    'event.name';
    'event.timestamp';
    constructor(error) {
        this.error = error;
        this['event.name'] = 'ripgrep_fallback';
        this['event.timestamp'] = new Date().toISOString();
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_RIPGREP_FALLBACK,
            'event.timestamp': this['event.timestamp'],
            error: this.error,
        };
    }
    toLogBody() {
        return `Switching to grep as fallback.`;
    }
}
export var LoopType;
(function (LoopType) {
    LoopType["CONSECUTIVE_IDENTICAL_TOOL_CALLS"] = "consecutive_identical_tool_calls";
    LoopType["CHANTING_IDENTICAL_SENTENCES"] = "chanting_identical_sentences";
    LoopType["LLM_DETECTED_LOOP"] = "llm_detected_loop";
})(LoopType || (LoopType = {}));
export class LoopDetectedEvent {
    'event.name';
    'event.timestamp';
    loop_type;
    prompt_id;
    constructor(loop_type, prompt_id) {
        this['event.name'] = 'loop_detected';
        this['event.timestamp'] = new Date().toISOString();
        this.loop_type = loop_type;
        this.prompt_id = prompt_id;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': this['event.name'],
            'event.timestamp': this['event.timestamp'],
            loop_type: this.loop_type,
            prompt_id: this.prompt_id,
        };
    }
    toLogBody() {
        return `Loop detected. Type: ${this.loop_type}.`;
    }
}
export class LoopDetectionDisabledEvent {
    'event.name';
    'event.timestamp';
    prompt_id;
    constructor(prompt_id) {
        this['event.name'] = 'loop_detection_disabled';
        this['event.timestamp'] = new Date().toISOString();
        this.prompt_id = prompt_id;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': this['event.name'],
            'event.timestamp': this['event.timestamp'],
            prompt_id: this.prompt_id,
        };
    }
    toLogBody() {
        return `Loop detection disabled.`;
    }
}
export const EVENT_NEXT_SPEAKER_CHECK = 'gemini_cli.next_speaker_check';
export class NextSpeakerCheckEvent {
    'event.name';
    'event.timestamp';
    prompt_id;
    finish_reason;
    result;
    constructor(prompt_id, finish_reason, result) {
        this['event.name'] = 'next_speaker_check';
        this['event.timestamp'] = new Date().toISOString();
        this.prompt_id = prompt_id;
        this.finish_reason = finish_reason;
        this.result = result;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_NEXT_SPEAKER_CHECK,
            'event.timestamp': this['event.timestamp'],
            prompt_id: this.prompt_id,
            finish_reason: this.finish_reason,
            result: this.result,
        };
    }
    toLogBody() {
        return `Next speaker check.`;
    }
}
export const EVENT_SLASH_COMMAND = 'gemini_cli.slash_command';
export function makeSlashCommandEvent({ command, subcommand, status, extension_id, }) {
    return {
        'event.name': 'slash_command',
        'event.timestamp': new Date().toISOString(),
        command,
        subcommand,
        status,
        extension_id,
        toOpenTelemetryAttributes(config) {
            return {
                ...getCommonAttributes(config),
                'event.name': EVENT_SLASH_COMMAND,
                'event.timestamp': this['event.timestamp'],
                command: this.command,
                subcommand: this.subcommand,
                status: this.status,
                extension_id: this.extension_id,
            };
        },
        toLogBody() {
            return `Slash command: ${this.command}.`;
        },
    };
}
export var SlashCommandStatus;
(function (SlashCommandStatus) {
    SlashCommandStatus["SUCCESS"] = "success";
    SlashCommandStatus["ERROR"] = "error";
})(SlashCommandStatus || (SlashCommandStatus = {}));
export const EVENT_CHAT_COMPRESSION = 'gemini_cli.chat_compression';
export function makeChatCompressionEvent({ tokens_before, tokens_after, }) {
    return {
        'event.name': 'chat_compression',
        'event.timestamp': new Date().toISOString(),
        tokens_before,
        tokens_after,
        toOpenTelemetryAttributes(config) {
            return {
                ...getCommonAttributes(config),
                'event.name': EVENT_CHAT_COMPRESSION,
                'event.timestamp': this['event.timestamp'],
                tokens_before: this.tokens_before,
                tokens_after: this.tokens_after,
            };
        },
        toLogBody() {
            return `Chat compression (Saved ${this.tokens_before - this.tokens_after} tokens)`;
        },
    };
}
export const EVENT_MALFORMED_JSON_RESPONSE = 'gemini_cli.malformed_json_response';
export class MalformedJsonResponseEvent {
    'event.name';
    'event.timestamp';
    model;
    constructor(model) {
        this['event.name'] = 'malformed_json_response';
        this['event.timestamp'] = new Date().toISOString();
        this.model = model;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_MALFORMED_JSON_RESPONSE,
            'event.timestamp': this['event.timestamp'],
            model: this.model,
        };
    }
    toLogBody() {
        return `Malformed JSON response from ${this.model}.`;
    }
}
export var IdeConnectionType;
(function (IdeConnectionType) {
    IdeConnectionType["START"] = "start";
    IdeConnectionType["SESSION"] = "session";
})(IdeConnectionType || (IdeConnectionType = {}));
export const EVENT_IDE_CONNECTION = 'gemini_cli.ide_connection';
export class IdeConnectionEvent {
    'event.name';
    'event.timestamp';
    connection_type;
    constructor(connection_type) {
        this['event.name'] = 'ide_connection';
        this['event.timestamp'] = new Date().toISOString();
        this.connection_type = connection_type;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_IDE_CONNECTION,
            'event.timestamp': this['event.timestamp'],
            connection_type: this.connection_type,
        };
    }
    toLogBody() {
        return `Ide connection. Type: ${this.connection_type}.`;
    }
}
export const EVENT_CONVERSATION_FINISHED = 'gemini_cli.conversation_finished';
export class ConversationFinishedEvent {
    'event_name';
    'event.timestamp'; // ISO 8601;
    approvalMode;
    turnCount;
    constructor(approvalMode, turnCount) {
        this['event_name'] = 'conversation_finished';
        this['event.timestamp'] = new Date().toISOString();
        this.approvalMode = approvalMode;
        this.turnCount = turnCount;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_CONVERSATION_FINISHED,
            'event.timestamp': this['event.timestamp'],
            approvalMode: this.approvalMode,
            turnCount: this.turnCount,
        };
    }
    toLogBody() {
        return `Conversation finished.`;
    }
}
export class KittySequenceOverflowEvent {
    'event.name';
    'event.timestamp'; // ISO 8601
    sequence_length;
    truncated_sequence;
    constructor(sequence_length, truncated_sequence) {
        this['event.name'] = 'kitty_sequence_overflow';
        this['event.timestamp'] = new Date().toISOString();
        this.sequence_length = sequence_length;
        // Truncate to first 20 chars for logging (avoid logging sensitive data)
        this.truncated_sequence = truncated_sequence.substring(0, 20);
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': this['event.name'],
            'event.timestamp': this['event.timestamp'],
            sequence_length: this.sequence_length,
            truncated_sequence: this.truncated_sequence,
        };
    }
    toLogBody() {
        return `Kitty sequence buffer overflow: ${this.sequence_length} bytes`;
    }
}
export const EVENT_FILE_OPERATION = 'gemini_cli.file_operation';
export class FileOperationEvent {
    'event.name';
    'event.timestamp';
    tool_name;
    operation;
    lines;
    mimetype;
    extension;
    programming_language;
    constructor(tool_name, operation, lines, mimetype, extension, programming_language) {
        this['event.name'] = 'file_operation';
        this['event.timestamp'] = new Date().toISOString();
        this.tool_name = tool_name;
        this.operation = operation;
        this.lines = lines;
        this.mimetype = mimetype;
        this.extension = extension;
        this.programming_language = programming_language;
    }
    toOpenTelemetryAttributes(config) {
        const attributes = {
            ...getCommonAttributes(config),
            'event.name': EVENT_FILE_OPERATION,
            'event.timestamp': this['event.timestamp'],
            tool_name: this.tool_name,
            operation: this.operation,
        };
        if (this.lines) {
            attributes['lines'] = this.lines;
        }
        if (this.mimetype) {
            attributes['mimetype'] = this.mimetype;
        }
        if (this.extension) {
            attributes['extension'] = this.extension;
        }
        if (this.programming_language) {
            attributes['programming_language'] = this.programming_language;
        }
        return attributes;
    }
    toLogBody() {
        return `File operation: ${this.operation}. Lines: ${this.lines}.`;
    }
}
export const EVENT_INVALID_CHUNK = 'gemini_cli.chat.invalid_chunk';
// Add these new event interfaces
export class InvalidChunkEvent {
    'event.name';
    'event.timestamp';
    error_message; // Optional: validation error details
    constructor(error_message) {
        this['event.name'] = 'invalid_chunk';
        this['event.timestamp'] = new Date().toISOString();
        this.error_message = error_message;
    }
    toOpenTelemetryAttributes(config) {
        const attributes = {
            ...getCommonAttributes(config),
            'event.name': EVENT_INVALID_CHUNK,
            'event.timestamp': this['event.timestamp'],
        };
        if (this.error_message) {
            attributes['error.message'] = this.error_message;
        }
        return attributes;
    }
    toLogBody() {
        return `Invalid chunk received from stream.`;
    }
}
export const EVENT_CONTENT_RETRY = 'gemini_cli.chat.content_retry';
export class ContentRetryEvent {
    'event.name';
    'event.timestamp';
    attempt_number;
    error_type; // e.g., 'EmptyStreamError'
    retry_delay_ms;
    model;
    constructor(attempt_number, error_type, retry_delay_ms, model) {
        this['event.name'] = 'content_retry';
        this['event.timestamp'] = new Date().toISOString();
        this.attempt_number = attempt_number;
        this.error_type = error_type;
        this.retry_delay_ms = retry_delay_ms;
        this.model = model;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_CONTENT_RETRY,
            'event.timestamp': this['event.timestamp'],
            attempt_number: this.attempt_number,
            error_type: this.error_type,
            retry_delay_ms: this.retry_delay_ms,
            model: this.model,
        };
    }
    toLogBody() {
        return `Content retry attempt ${this.attempt_number} due to ${this.error_type}.`;
    }
}
export const EVENT_CONTENT_RETRY_FAILURE = 'gemini_cli.chat.content_retry_failure';
export class ContentRetryFailureEvent {
    'event.name';
    'event.timestamp';
    total_attempts;
    final_error_type;
    total_duration_ms; // Optional: total time spent retrying
    model;
    constructor(total_attempts, final_error_type, model, total_duration_ms) {
        this['event.name'] = 'content_retry_failure';
        this['event.timestamp'] = new Date().toISOString();
        this.total_attempts = total_attempts;
        this.final_error_type = final_error_type;
        this.total_duration_ms = total_duration_ms;
        this.model = model;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_CONTENT_RETRY_FAILURE,
            'event.timestamp': this['event.timestamp'],
            total_attempts: this.total_attempts,
            final_error_type: this.final_error_type,
            total_duration_ms: this.total_duration_ms,
            model: this.model,
        };
    }
    toLogBody() {
        return `All content retries failed after ${this.total_attempts} attempts.`;
    }
}
export const EVENT_MODEL_ROUTING = 'gemini_cli.model_routing';
export class ModelRoutingEvent {
    'event.name';
    'event.timestamp';
    decision_model;
    decision_source;
    routing_latency_ms;
    reasoning;
    failed;
    error_message;
    constructor(decision_model, decision_source, routing_latency_ms, reasoning, failed, error_message) {
        this['event.name'] = 'model_routing';
        this['event.timestamp'] = new Date().toISOString();
        this.decision_model = decision_model;
        this.decision_source = decision_source;
        this.routing_latency_ms = routing_latency_ms;
        this.reasoning = reasoning;
        this.failed = failed;
        this.error_message = error_message;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_MODEL_ROUTING,
            'event.timestamp': this['event.timestamp'],
            decision_model: this.decision_model,
            decision_source: this.decision_source,
            routing_latency_ms: this.routing_latency_ms,
            reasoning: this.reasoning,
            failed: this.failed,
            error_message: this.error_message,
        };
    }
    toLogBody() {
        return `Model routing decision. Model: ${this.decision_model}, Source: ${this.decision_source}`;
    }
}
export const EVENT_EXTENSION_INSTALL = 'gemini_cli.extension_install';
export class ExtensionInstallEvent {
    'event.name';
    'event.timestamp';
    extension_name;
    extension_id;
    extension_version;
    extension_source;
    status;
    constructor(extension_name, extension_id, extension_version, extension_source, status) {
        this['event.name'] = 'extension_install';
        this['event.timestamp'] = new Date().toISOString();
        this.extension_name = extension_name;
        this.extension_id = extension_id;
        this.extension_version = extension_version;
        this.extension_source = extension_source;
        this.status = status;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_EXTENSION_INSTALL,
            'event.timestamp': this['event.timestamp'],
            extension_name: this.extension_name,
            extension_version: this.extension_version,
            extension_source: this.extension_source,
            status: this.status,
        };
    }
    toLogBody() {
        return `Installed extension ${this.extension_name}`;
    }
}
export const EVENT_TOOL_OUTPUT_TRUNCATED = 'gemini_cli.tool_output_truncated';
export class ToolOutputTruncatedEvent {
    eventName = 'tool_output_truncated';
    'event.timestamp' = new Date().toISOString();
    'event.name';
    tool_name;
    original_content_length;
    truncated_content_length;
    threshold;
    lines;
    prompt_id;
    constructor(prompt_id, details) {
        this['event.name'] = this.eventName;
        this.prompt_id = prompt_id;
        this.tool_name = details.toolName;
        this.original_content_length = details.originalContentLength;
        this.truncated_content_length = details.truncatedContentLength;
        this.threshold = details.threshold;
        this.lines = details.lines;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_TOOL_OUTPUT_TRUNCATED,
            eventName: this.eventName,
            'event.timestamp': this['event.timestamp'],
            tool_name: this.tool_name,
            original_content_length: this.original_content_length,
            truncated_content_length: this.truncated_content_length,
            threshold: this.threshold,
            lines: this.lines,
            prompt_id: this.prompt_id,
        };
    }
    toLogBody() {
        return `Tool output truncated for ${this.tool_name}.`;
    }
}
export const EVENT_EXTENSION_UNINSTALL = 'gemini_cli.extension_uninstall';
export class ExtensionUninstallEvent {
    'event.name';
    'event.timestamp';
    extension_name;
    extension_id;
    status;
    constructor(extension_name, extension_id, status) {
        this['event.name'] = 'extension_uninstall';
        this['event.timestamp'] = new Date().toISOString();
        this.extension_name = extension_name;
        this.extension_id = extension_id;
        this.status = status;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_EXTENSION_UNINSTALL,
            'event.timestamp': this['event.timestamp'],
            extension_name: this.extension_name,
            status: this.status,
        };
    }
    toLogBody() {
        return `Uninstalled extension ${this.extension_name}`;
    }
}
export const EVENT_EXTENSION_UPDATE = 'gemini_cli.extension_update';
export class ExtensionUpdateEvent {
    'event.name';
    'event.timestamp';
    extension_name;
    extension_id;
    extension_previous_version;
    extension_version;
    extension_source;
    status;
    constructor(extension_name, extension_id, extension_version, extension_previous_version, extension_source, status) {
        this['event.name'] = 'extension_update';
        this['event.timestamp'] = new Date().toISOString();
        this.extension_name = extension_name;
        this.extension_id = extension_id;
        this.extension_version = extension_version;
        this.extension_previous_version = extension_previous_version;
        this.extension_source = extension_source;
        this.status = status;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_EXTENSION_UPDATE,
            'event.timestamp': this['event.timestamp'],
            extension_name: this.extension_name,
            extension_version: this.extension_version,
            extension_previous_version: this.extension_previous_version,
            extension_source: this.extension_source,
            status: this.status,
        };
    }
    toLogBody() {
        return `Updated extension ${this.extension_name}`;
    }
}
export const EVENT_EXTENSION_ENABLE = 'gemini_cli.extension_enable';
export class ExtensionEnableEvent {
    'event.name';
    'event.timestamp';
    extension_name;
    extension_id;
    setting_scope;
    constructor(extension_name, extension_id, settingScope) {
        this['event.name'] = 'extension_enable';
        this['event.timestamp'] = new Date().toISOString();
        this.extension_name = extension_name;
        this.extension_id = extension_id;
        this.setting_scope = settingScope;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_EXTENSION_ENABLE,
            'event.timestamp': this['event.timestamp'],
            extension_name: this.extension_name,
            setting_scope: this.setting_scope,
        };
    }
    toLogBody() {
        return `Enabled extension ${this.extension_name}`;
    }
}
export const EVENT_MODEL_SLASH_COMMAND = 'gemini_cli.slash_command.model';
export class ModelSlashCommandEvent {
    'event.name';
    'event.timestamp';
    model_name;
    constructor(model_name) {
        this['event.name'] = 'model_slash_command';
        this['event.timestamp'] = new Date().toISOString();
        this.model_name = model_name;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_MODEL_SLASH_COMMAND,
            'event.timestamp': this['event.timestamp'],
            model_name: this.model_name,
        };
    }
    toLogBody() {
        return `Model slash command. Model: ${this.model_name}`;
    }
}
export const EVENT_EXTENSION_DISABLE = 'gemini_cli.extension_disable';
export class ExtensionDisableEvent {
    'event.name';
    'event.timestamp';
    extension_name;
    extension_id;
    setting_scope;
    constructor(extension_name, extension_id, settingScope) {
        this['event.name'] = 'extension_disable';
        this['event.timestamp'] = new Date().toISOString();
        this.extension_name = extension_name;
        this.extension_id = extension_id;
        this.setting_scope = settingScope;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_EXTENSION_DISABLE,
            'event.timestamp': this['event.timestamp'],
            extension_name: this.extension_name,
            setting_scope: this.setting_scope,
        };
    }
    toLogBody() {
        return `Disabled extension ${this.extension_name}`;
    }
}
export const EVENT_SMART_EDIT_STRATEGY = 'gemini_cli.smart_edit_strategy';
export class SmartEditStrategyEvent {
    'event.name';
    'event.timestamp';
    strategy;
    constructor(strategy) {
        this['event.name'] = 'smart_edit_strategy';
        this['event.timestamp'] = new Date().toISOString();
        this.strategy = strategy;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_SMART_EDIT_STRATEGY,
            'event.timestamp': this['event.timestamp'],
            strategy: this.strategy,
        };
    }
    toLogBody() {
        return `Smart Edit Tool Strategy: ${this.strategy}`;
    }
}
export const EVENT_SMART_EDIT_CORRECTION = 'gemini_cli.smart_edit_correction';
export class SmartEditCorrectionEvent {
    'event.name';
    'event.timestamp';
    correction;
    constructor(correction) {
        this['event.name'] = 'smart_edit_correction';
        this['event.timestamp'] = new Date().toISOString();
        this.correction = correction;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_SMART_EDIT_CORRECTION,
            'event.timestamp': this['event.timestamp'],
            correction: this.correction,
        };
    }
    toLogBody() {
        return `Smart Edit Tool Correction: ${this.correction}`;
    }
}
export const EVENT_AGENT_START = 'gemini_cli.agent.start';
export class AgentStartEvent {
    'event.name';
    'event.timestamp';
    agent_id;
    agent_name;
    constructor(agent_id, agent_name) {
        this['event.name'] = 'agent_start';
        this['event.timestamp'] = new Date().toISOString();
        this.agent_id = agent_id;
        this.agent_name = agent_name;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_AGENT_START,
            'event.timestamp': this['event.timestamp'],
            agent_id: this.agent_id,
            agent_name: this.agent_name,
        };
    }
    toLogBody() {
        return `Agent ${this.agent_name} started. ID: ${this.agent_id}`;
    }
}
export const EVENT_AGENT_FINISH = 'gemini_cli.agent.finish';
export class AgentFinishEvent {
    'event.name';
    'event.timestamp';
    agent_id;
    agent_name;
    duration_ms;
    turn_count;
    terminate_reason;
    constructor(agent_id, agent_name, duration_ms, turn_count, terminate_reason) {
        this['event.name'] = 'agent_finish';
        this['event.timestamp'] = new Date().toISOString();
        this.agent_id = agent_id;
        this.agent_name = agent_name;
        this.duration_ms = duration_ms;
        this.turn_count = turn_count;
        this.terminate_reason = terminate_reason;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_AGENT_FINISH,
            'event.timestamp': this['event.timestamp'],
            agent_id: this.agent_id,
            agent_name: this.agent_name,
            duration_ms: this.duration_ms,
            turn_count: this.turn_count,
            terminate_reason: this.terminate_reason,
        };
    }
    toLogBody() {
        return `Agent ${this.agent_name} finished. Reason: ${this.terminate_reason}. Duration: ${this.duration_ms}ms. Turns: ${this.turn_count}.`;
    }
}
export const EVENT_WEB_FETCH_FALLBACK_ATTEMPT = 'gemini_cli.web_fetch_fallback_attempt';
export class WebFetchFallbackAttemptEvent {
    'event.name';
    'event.timestamp';
    reason;
    constructor(reason) {
        this['event.name'] = 'web_fetch_fallback_attempt';
        this['event.timestamp'] = new Date().toISOString();
        this.reason = reason;
    }
    toOpenTelemetryAttributes(config) {
        return {
            ...getCommonAttributes(config),
            'event.name': EVENT_WEB_FETCH_FALLBACK_ATTEMPT,
            'event.timestamp': this['event.timestamp'],
            reason: this.reason,
        };
    }
    toLogBody() {
        return `Web fetch fallback attempt. Reason: ${this.reason}`;
    }
}
//# sourceMappingURL=types.js.map