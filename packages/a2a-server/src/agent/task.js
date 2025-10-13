/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreToolScheduler,
  GeminiEventType,
  ToolConfirmationOutcome,
  ApprovalMode,
  getAllMCPServerStatuses,
  MCPServerStatus,
  isNodeError,
  parseAndFormatApiError,
  safeLiteralReplace,
} from '@google/gemini-cli-core';
import {} from '@a2a-js/sdk/server';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import * as fs from 'node:fs';
import { CoderAgentEvent } from '../types.js';
export class Task {
  id;
  contextId;
  scheduler;
  config;
  geminiClient;
  pendingToolConfirmationDetails;
  taskState;
  eventBus;
  completedToolCalls;
  skipFinalTrueAfterInlineEdit = false;
  // For tool waiting logic
  pendingToolCalls = new Map(); //toolCallId --> status
  toolCompletionPromise;
  toolCompletionNotifier;
  constructor(id, contextId, config, eventBus) {
    this.id = id;
    this.contextId = contextId;
    this.config = config;
    this.scheduler = this.createScheduler();
    this.geminiClient = this.config.getGeminiClient();
    this.pendingToolConfirmationDetails = new Map();
    this.taskState = 'submitted';
    this.eventBus = eventBus;
    this.completedToolCalls = [];
    this._resetToolCompletionPromise();
    this.config.setFallbackModelHandler(
      // For a2a-server, we want to automatically switch to the fallback model
      // for future requests without retrying the current one. The 'stop'
      // intent achieves this.
      async () => 'stop',
    );
  }
  static async create(id, contextId, config, eventBus) {
    return new Task(id, contextId, config, eventBus);
  }
  // Note: `getAllMCPServerStatuses` retrieves the status of all MCP servers for the entire
  // process. This is not scoped to the individual task but reflects the global connection
  // state managed within the @gemini-cli/core module.
  async getMetadata() {
    const toolRegistry = await this.config.getToolRegistry();
    const mcpServers = this.config.getMcpServers() || {};
    const serverStatuses = getAllMCPServerStatuses();
    const servers = Object.keys(mcpServers).map((serverName) => ({
      name: serverName,
      status: serverStatuses.get(serverName) || MCPServerStatus.DISCONNECTED,
      tools: toolRegistry.getToolsByServer(serverName).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameterSchema: tool.schema.parameters,
      })),
    }));
    const availableTools = toolRegistry.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameterSchema: tool.schema.parameters,
    }));
    const metadata = {
      id: this.id,
      contextId: this.contextId,
      taskState: this.taskState,
      model: this.config.getModel(),
      mcpServers: servers,
      availableTools,
    };
    return metadata;
  }
  _resetToolCompletionPromise() {
    this.toolCompletionPromise = new Promise((resolve, reject) => {
      this.toolCompletionNotifier = { resolve, reject };
    });
    // If there are no pending calls when reset, resolve immediately.
    if (this.pendingToolCalls.size === 0 && this.toolCompletionNotifier) {
      this.toolCompletionNotifier.resolve();
    }
  }
  _registerToolCall(toolCallId, status) {
    const wasEmpty = this.pendingToolCalls.size === 0;
    this.pendingToolCalls.set(toolCallId, status);
    if (wasEmpty) {
      this._resetToolCompletionPromise();
    }
    logger.info(
      `[Task] Registered tool call: ${toolCallId}. Pending: ${this.pendingToolCalls.size}`,
    );
  }
  _resolveToolCall(toolCallId) {
    if (this.pendingToolCalls.has(toolCallId)) {
      this.pendingToolCalls.delete(toolCallId);
      logger.info(
        `[Task] Resolved tool call: ${toolCallId}. Pending: ${this.pendingToolCalls.size}`,
      );
      if (this.pendingToolCalls.size === 0 && this.toolCompletionNotifier) {
        this.toolCompletionNotifier.resolve();
      }
    }
  }
  async waitForPendingTools() {
    if (this.pendingToolCalls.size === 0) {
      return Promise.resolve();
    }
    logger.info(
      `[Task] Waiting for ${this.pendingToolCalls.size} pending tool(s)...`,
    );
    return this.toolCompletionPromise;
  }
  cancelPendingTools(reason) {
    if (this.pendingToolCalls.size > 0) {
      logger.info(
        `[Task] Cancelling all ${this.pendingToolCalls.size} pending tool calls. Reason: ${reason}`,
      );
    }
    if (this.toolCompletionNotifier) {
      this.toolCompletionNotifier.reject(new Error(reason));
    }
    this.pendingToolCalls.clear();
    // Reset the promise for any future operations, ensuring it's in a clean state.
    this._resetToolCompletionPromise();
  }
  _createTextMessage(text, role = 'agent') {
    return {
      kind: 'message',
      role,
      parts: [{ kind: 'text', text }],
      messageId: uuidv4(),
      taskId: this.id,
      contextId: this.contextId,
    };
  }
  _createStatusUpdateEvent(
    stateToReport,
    coderAgentMessage,
    message,
    final = false,
    timestamp,
    metadataError,
  ) {
    const metadata = {
      coderAgent: coderAgentMessage,
      model: this.config.getModel(),
      userTier: this.config.getUserTier(),
    };
    if (metadataError) {
      metadata.error = metadataError;
    }
    return {
      kind: 'status-update',
      taskId: this.id,
      contextId: this.contextId,
      status: {
        state: stateToReport,
        message, // Shorthand property
        timestamp: timestamp || new Date().toISOString(),
      },
      final,
      metadata,
    };
  }
  setTaskStateAndPublishUpdate(
    newState,
    coderAgentMessage,
    messageText,
    messageParts, // For more complex messages
    final = false,
    metadataError,
  ) {
    this.taskState = newState;
    let message;
    if (messageText) {
      message = this._createTextMessage(messageText);
    } else if (messageParts) {
      message = {
        kind: 'message',
        role: 'agent',
        parts: messageParts,
        messageId: uuidv4(),
        taskId: this.id,
        contextId: this.contextId,
      };
    }
    const event = this._createStatusUpdateEvent(
      this.taskState,
      coderAgentMessage,
      message,
      final,
      undefined,
      metadataError,
    );
    this.eventBus?.publish(event);
  }
  _schedulerOutputUpdate(toolCallId, outputChunk) {
    let outputAsText;
    if (typeof outputChunk === 'string') {
      outputAsText = outputChunk;
    } else {
      outputAsText = outputChunk
        .map((line) => line.map((token) => token.text).join(''))
        .join('\n');
    }
    logger.info(
      '[Task] Scheduler output update for tool call ' +
        toolCallId +
        ': ' +
        outputAsText,
    );
    const artifact = {
      artifactId: `tool-${toolCallId}-output`,
      parts: [
        {
          kind: 'text',
          text: outputAsText,
        },
      ],
    };
    const artifactEvent = {
      kind: 'artifact-update',
      taskId: this.id,
      contextId: this.contextId,
      artifact,
      append: true,
      lastChunk: false,
    };
    this.eventBus?.publish(artifactEvent);
  }
  async _schedulerAllToolCallsComplete(completedToolCalls) {
    logger.info(
      '[Task] All tool calls completed by scheduler (batch):',
      completedToolCalls.map((tc) => tc.request.callId),
    );
    this.completedToolCalls.push(...completedToolCalls);
    completedToolCalls.forEach((tc) => {
      this._resolveToolCall(tc.request.callId);
    });
  }
  _schedulerToolCallsUpdate(toolCalls) {
    logger.info(
      '[Task] Scheduler tool calls updated:',
      toolCalls.map((tc) => `${tc.request.callId} (${tc.status})`),
    );
    // Update state and send continuous, non-final updates
    toolCalls.forEach((tc) => {
      const previousStatus = this.pendingToolCalls.get(tc.request.callId);
      const hasChanged = previousStatus !== tc.status;
      // Resolve tool call if it has reached a terminal state
      if (['success', 'error', 'cancelled'].includes(tc.status)) {
        this._resolveToolCall(tc.request.callId);
      } else {
        // This will update the map
        this._registerToolCall(tc.request.callId, tc.status);
      }
      if (tc.status === 'awaiting_approval' && tc.confirmationDetails) {
        this.pendingToolConfirmationDetails.set(
          tc.request.callId,
          tc.confirmationDetails,
        );
      }
      // Only send an update if the status has actually changed.
      if (hasChanged) {
        const message = this.toolStatusMessage(tc, this.id, this.contextId);
        const coderAgentMessage =
          tc.status === 'awaiting_approval'
            ? { kind: CoderAgentEvent.ToolCallConfirmationEvent }
            : { kind: CoderAgentEvent.ToolCallUpdateEvent };
        const event = this._createStatusUpdateEvent(
          this.taskState,
          coderAgentMessage,
          message,
          false,
        );
        this.eventBus?.publish(event);
      }
    });
    if (this.config.getApprovalMode() === ApprovalMode.YOLO) {
      logger.info('[Task] YOLO mode enabled. Auto-approving all tool calls.');
      toolCalls.forEach((tc) => {
        if (tc.status === 'awaiting_approval' && tc.confirmationDetails) {
          tc.confirmationDetails.onConfirm(ToolConfirmationOutcome.ProceedOnce);
          this.pendingToolConfirmationDetails.delete(tc.request.callId);
        }
      });
      return;
    }
    const allPendingStatuses = Array.from(this.pendingToolCalls.values());
    const isAwaitingApproval = allPendingStatuses.some(
      (status) => status === 'awaiting_approval',
    );
    const allPendingAreStable = allPendingStatuses.every(
      (status) =>
        status === 'awaiting_approval' ||
        status === 'success' ||
        status === 'error' ||
        status === 'cancelled',
    );
    // 1. Are any pending tool calls awaiting_approval
    // 2. Are all pending tool calls in a stable state (i.e. not in validing or executing)
    // 3. After an inline edit, the edited tool call will send awaiting_approval THEN scheduled. We wait for the next update in this case.
    if (
      isAwaitingApproval &&
      allPendingAreStable &&
      !this.skipFinalTrueAfterInlineEdit
    ) {
      this.skipFinalTrueAfterInlineEdit = false;
      // We don't need to send another message, just a final status update.
      this.setTaskStateAndPublishUpdate(
        'input-required',
        { kind: CoderAgentEvent.StateChangeEvent },
        undefined,
        undefined,
        /*final*/ true,
      );
    }
  }
  createScheduler() {
    const scheduler = new CoreToolScheduler({
      outputUpdateHandler: this._schedulerOutputUpdate.bind(this),
      onAllToolCallsComplete: this._schedulerAllToolCallsComplete.bind(this),
      onToolCallsUpdate: this._schedulerToolCallsUpdate.bind(this),
      getPreferredEditor: () => 'vscode',
      config: this.config,
      onEditorClose: () => {},
    });
    return scheduler;
  }
  _pickFields(from, ...fields) {
    const ret = {};
    for (const field of fields) {
      if (field in from) {
        ret[field] = from[field];
      }
    }
    return ret;
  }
  toolStatusMessage(tc, taskId, contextId) {
    const messageParts = [];
    // Create a serializable version of the ToolCall (pick necesssary
    // properties/avoid methods causing circular reference errors)
    const serializableToolCall = this._pickFields(
      tc,
      'request',
      'status',
      'confirmationDetails',
      'liveOutput',
      'response',
    );
    if (tc.tool) {
      serializableToolCall.tool = this._pickFields(
        tc.tool,
        'name',
        'displayName',
        'description',
        'kind',
        'isOutputMarkdown',
        'canUpdateOutput',
        'schema',
        'parameterSchema',
      );
    }
    messageParts.push({
      kind: 'data',
      data: serializableToolCall,
    });
    return {
      kind: 'message',
      role: 'agent',
      parts: messageParts,
      messageId: uuidv4(),
      taskId,
      contextId,
    };
  }
  async getProposedContent(file_path, old_string, new_string) {
    try {
      const currentContent = fs.readFileSync(file_path, 'utf8');
      return this._applyReplacement(
        currentContent,
        old_string,
        new_string,
        old_string === '' && currentContent === '',
      );
    } catch (err) {
      if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
      return '';
    }
  }
  _applyReplacement(currentContent, oldString, newString, isNewFile) {
    if (isNewFile) {
      return newString;
    }
    if (currentContent === null) {
      // Should not happen if not a new file, but defensively return empty or newString if oldString is also empty
      return oldString === '' ? newString : '';
    }
    // If oldString is empty and it's not a new file, do not modify the content.
    if (oldString === '' && !isNewFile) {
      return currentContent;
    }
    // Use intelligent replacement that handles $ sequences safely
    return safeLiteralReplace(currentContent, oldString, newString);
  }
  async scheduleToolCalls(requests, abortSignal) {
    if (requests.length === 0) {
      return;
    }
    const updatedRequests = await Promise.all(
      requests.map(async (request) => {
        if (
          request.name === 'replace' &&
          request.args &&
          !request.args['newContent'] &&
          request.args['file_path'] &&
          request.args['old_string'] &&
          request.args['new_string']
        ) {
          const newContent = await this.getProposedContent(
            request.args['file_path'],
            request.args['old_string'],
            request.args['new_string'],
          );
          return { ...request, args: { ...request.args, newContent } };
        }
        return request;
      }),
    );
    logger.info(
      `[Task] Scheduling batch of ${updatedRequests.length} tool calls.`,
    );
    const stateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    this.setTaskStateAndPublishUpdate('working', stateChange);
    await this.scheduler.schedule(updatedRequests, abortSignal);
  }
  async acceptAgentMessage(event) {
    const stateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    switch (event.type) {
      case GeminiEventType.Content:
        logger.info('[Task] Sending agent message content...');
        this._sendTextContent(event.value);
        break;
      case GeminiEventType.ToolCallRequest:
        // This is now handled by the agent loop, which collects all requests
        // and calls scheduleToolCalls once.
        logger.warn(
          '[Task] A single tool call request was passed to acceptAgentMessage. This should be handled in a batch by the agent. Ignoring.',
        );
        break;
      case GeminiEventType.ToolCallResponse:
        // This event type from ServerGeminiStreamEvent might be for when LLM *generates* a tool response part.
        // The actual execution result comes via user message.
        logger.info(
          '[Task] Received tool call response from LLM (part of generation):',
          event.value,
        );
        break;
      case GeminiEventType.ToolCallConfirmation:
        // This is when LLM requests confirmation, not when user provides it.
        logger.info(
          '[Task] Received tool call confirmation request from LLM:',
          event.value.request.callId,
        );
        this.pendingToolConfirmationDetails.set(
          event.value.request.callId,
          event.value.details,
        );
        // This will be handled by the scheduler and _schedulerToolCallsUpdate will set InputRequired if needed.
        // No direct state change here, scheduler drives it.
        break;
      case GeminiEventType.UserCancelled:
        logger.info('[Task] Received user cancelled event from LLM stream.');
        this.cancelPendingTools('User cancelled via LLM stream event');
        this.setTaskStateAndPublishUpdate(
          'input-required',
          stateChange,
          'Task cancelled by user',
          undefined,
          true,
        );
        break;
      case GeminiEventType.Thought:
        logger.info('[Task] Sending agent thought...');
        this._sendThought(event.value);
        break;
      case GeminiEventType.ChatCompressed:
        break;
      case GeminiEventType.Finished:
        logger.info(`[Task ${this.id}] Agent finished its turn.`);
        break;
      case GeminiEventType.Error:
      default: {
        // Block scope for lexical declaration
        const errorEvent = event; // Type assertion
        const errorMessage =
          errorEvent.value?.error.message ?? 'Unknown error from LLM stream';
        logger.error(
          '[Task] Received error event from LLM stream:',
          errorMessage,
        );
        let errMessage = 'Unknown error from LLM stream';
        if (errorEvent.value) {
          errMessage = parseAndFormatApiError(errorEvent.value);
        }
        this.cancelPendingTools(`LLM stream error: ${errorMessage}`);
        this.setTaskStateAndPublishUpdate(
          this.taskState,
          stateChange,
          `Agent Error, unknown agent message: ${errorMessage}`,
          undefined,
          false,
          errMessage,
        );
        break;
      }
    }
  }
  async _handleToolConfirmationPart(part) {
    if (
      part.kind !== 'data' ||
      !part.data ||
      typeof part.data['callId'] !== 'string' ||
      typeof part.data['outcome'] !== 'string'
    ) {
      return false;
    }
    const callId = part.data['callId'];
    const outcomeString = part.data['outcome'];
    let confirmationOutcome;
    if (outcomeString === 'proceed_once') {
      confirmationOutcome = ToolConfirmationOutcome.ProceedOnce;
    } else if (outcomeString === 'cancel') {
      confirmationOutcome = ToolConfirmationOutcome.Cancel;
    } else if (outcomeString === 'proceed_always') {
      confirmationOutcome = ToolConfirmationOutcome.ProceedAlways;
    } else if (outcomeString === 'proceed_always_server') {
      confirmationOutcome = ToolConfirmationOutcome.ProceedAlwaysServer;
    } else if (outcomeString === 'proceed_always_tool') {
      confirmationOutcome = ToolConfirmationOutcome.ProceedAlwaysTool;
    } else if (outcomeString === 'modify_with_editor') {
      confirmationOutcome = ToolConfirmationOutcome.ModifyWithEditor;
    } else {
      logger.warn(
        `[Task] Unknown tool confirmation outcome: "${outcomeString}" for callId: ${callId}`,
      );
      return false;
    }
    const confirmationDetails = this.pendingToolConfirmationDetails.get(callId);
    if (!confirmationDetails) {
      logger.warn(
        `[Task] Received tool confirmation for unknown or already processed callId: ${callId}`,
      );
      return false;
    }
    logger.info(
      `[Task] Handling tool confirmation for callId: ${callId} with outcome: ${outcomeString}`,
    );
    try {
      // Temporarily unset GCP environment variables so they do not leak into
      // tool calls.
      const gcpProject = process.env['GOOGLE_CLOUD_PROJECT'];
      const gcpCreds = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
      try {
        delete process.env['GOOGLE_CLOUD_PROJECT'];
        delete process.env['GOOGLE_APPLICATION_CREDENTIALS'];
        // This will trigger the scheduler to continue or cancel the specific tool.
        // The scheduler's onToolCallsUpdate will then reflect the new state (e.g., executing or cancelled).
        // If `edit` tool call, pass updated payload if presesent
        if (confirmationDetails.type === 'edit') {
          const payload = part.data['newContent']
            ? {
                newContent: part.data['newContent'],
              }
            : undefined;
          this.skipFinalTrueAfterInlineEdit = !!payload;
          await confirmationDetails.onConfirm(confirmationOutcome, payload);
        } else {
          await confirmationDetails.onConfirm(confirmationOutcome);
        }
      } finally {
        if (gcpProject) {
          process.env['GOOGLE_CLOUD_PROJECT'] = gcpProject;
        }
        if (gcpCreds) {
          process.env['GOOGLE_APPLICATION_CREDENTIALS'] = gcpCreds;
        }
      }
      // Do not delete if modifying, a subsequent tool confirmation for the same
      // callId will be passed with ProceedOnce/Cancel/etc
      // Note !== ToolConfirmationOutcome.ModifyWithEditor does not work!
      if (confirmationOutcome !== 'modify_with_editor') {
        this.pendingToolConfirmationDetails.delete(callId);
      }
      // If outcome is Cancel, scheduler should update status to 'cancelled', which then resolves the tool.
      // If ProceedOnce, scheduler updates to 'executing', then eventually 'success'/'error', which resolves.
      return true;
    } catch (error) {
      logger.error(
        `[Task] Error during tool confirmation for callId ${callId}:`,
        error,
      );
      // If confirming fails, we should probably mark this tool as failed
      this._resolveToolCall(callId); // Resolve it as it won't proceed.
      const errorMessageText =
        error instanceof Error
          ? error.message
          : `Error processing tool confirmation for ${callId}`;
      const message = this._createTextMessage(errorMessageText);
      const toolCallUpdate = {
        kind: CoderAgentEvent.ToolCallUpdateEvent,
      };
      const event = this._createStatusUpdateEvent(
        this.taskState,
        toolCallUpdate,
        message,
        false,
      );
      this.eventBus?.publish(event);
      return false;
    }
  }
  getAndClearCompletedTools() {
    const tools = [...this.completedToolCalls];
    this.completedToolCalls = [];
    return tools;
  }
  addToolResponsesToHistory(completedTools) {
    logger.info(
      `[Task] Adding ${completedTools.length} tool responses to history without generating a new response.`,
    );
    const responsesToAdd = completedTools.flatMap(
      (toolCall) => toolCall.response.responseParts,
    );
    for (const response of responsesToAdd) {
      let parts;
      if (Array.isArray(response)) {
        parts = response;
      } else if (typeof response === 'string') {
        parts = [{ text: response }];
      } else {
        parts = [response];
      }
      this.geminiClient.addHistory({
        role: 'user',
        parts,
      });
    }
  }
  async *sendCompletedToolsToLlm(completedToolCalls, aborted) {
    if (completedToolCalls.length === 0) {
      yield* (async function* () {})(); // Yield nothing
      return;
    }
    const llmParts = [];
    logger.info(
      `[Task] Feeding ${completedToolCalls.length} tool responses to LLM.`,
    );
    for (const completedToolCall of completedToolCalls) {
      logger.info(
        `[Task] Adding tool response for "${completedToolCall.request.name}" (callId: ${completedToolCall.request.callId}) to LLM input.`,
      );
      const responseParts = completedToolCall.response.responseParts;
      if (Array.isArray(responseParts)) {
        llmParts.push(...responseParts);
      } else {
        llmParts.push(responseParts);
      }
    }
    logger.info('[Task] Sending new parts to agent.');
    const stateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    // Set task state to working as we are about to call LLM
    this.setTaskStateAndPublishUpdate('working', stateChange);
    // TODO: Determine what it mean to have, then add a prompt ID.
    yield* this.geminiClient.sendMessageStream(
      llmParts,
      aborted,
      /*prompt_id*/ '',
    );
  }
  async *acceptUserMessage(requestContext, aborted) {
    const userMessage = requestContext.userMessage;
    const llmParts = [];
    let anyConfirmationHandled = false;
    let hasContentForLlm = false;
    for (const part of userMessage.parts) {
      const confirmationHandled = await this._handleToolConfirmationPart(part);
      if (confirmationHandled) {
        anyConfirmationHandled = true;
        // If a confirmation was handled, the scheduler will now run the tool (or cancel it).
        // We don't send anything to the LLM for this part.
        // The subsequent tool execution will eventually lead to resolveToolCall.
        continue;
      }
      if (part.kind === 'text') {
        llmParts.push({ text: part.text });
        hasContentForLlm = true;
      }
    }
    if (hasContentForLlm) {
      logger.info('[Task] Sending new parts to LLM.');
      const stateChange = {
        kind: CoderAgentEvent.StateChangeEvent,
      };
      // Set task state to working as we are about to call LLM
      this.setTaskStateAndPublishUpdate('working', stateChange);
      // TODO: Determine what it mean to have, then add a prompt ID.
      yield* this.geminiClient.sendMessageStream(
        llmParts,
        aborted,
        /*prompt_id*/ '',
      );
    } else if (anyConfirmationHandled) {
      logger.info(
        '[Task] User message only contained tool confirmations. Scheduler is active. No new input for LLM this turn.',
      );
      // Ensure task state reflects that scheduler might be working due to confirmation.
      // If scheduler is active, it will emit its own status updates.
      // If all pending tools were just confirmed, waitForPendingTools will handle the wait.
      // If some tools are still pending approval, scheduler would have set InputRequired.
      // If not, and no new text, we are just waiting.
      if (
        this.pendingToolCalls.size > 0 &&
        this.taskState !== 'input-required'
      ) {
        const stateChange = {
          kind: CoderAgentEvent.StateChangeEvent,
        };
        this.setTaskStateAndPublishUpdate('working', stateChange); // Reflect potential background activity
      }
      yield* (async function* () {})(); // Yield nothing
    } else {
      logger.info(
        '[Task] No relevant parts in user message for LLM interaction or tool confirmation.',
      );
      // If there's no new text and no confirmations, and no pending tools,
      // it implies we might need to signal input required if nothing else is happening.
      // However, the agent.ts will make this determination after waitForPendingTools.
      yield* (async function* () {})(); // Yield nothing
    }
  }
  _sendTextContent(content) {
    if (content === '') {
      return;
    }
    logger.info('[Task] Sending text content to event bus.');
    const message = this._createTextMessage(content);
    const textContent = {
      kind: CoderAgentEvent.TextContentEvent,
    };
    this.eventBus?.publish(
      this._createStatusUpdateEvent(
        this.taskState,
        textContent,
        message,
        false,
      ),
    );
  }
  _sendThought(content) {
    if (!content.subject && !content.description) {
      return;
    }
    logger.info('[Task] Sending thought to event bus.');
    const message = {
      kind: 'message',
      role: 'agent',
      parts: [
        {
          kind: 'data',
          data: content,
        },
      ],
      messageId: uuidv4(),
      taskId: this.id,
      contextId: this.contextId,
    };
    const thought = {
      kind: CoderAgentEvent.ThoughtEvent,
    };
    this.eventBus?.publish(
      this._createStatusUpdateEvent(this.taskState, thought, message, false),
    );
  }
}
//# sourceMappingURL=task.js.map
