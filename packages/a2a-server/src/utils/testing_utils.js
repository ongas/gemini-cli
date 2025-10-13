/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ApprovalMode, DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES, DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD, GeminiClient, } from '@google/gemini-cli-core';
import { expect, vi } from 'vitest';
export function createMockConfig(overrides = {}) {
    const mockConfig = {
        getToolRegistry: vi.fn().mockReturnValue({
            getTool: vi.fn(),
            getAllToolNames: vi.fn().mockReturnValue([]),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
        getIdeMode: vi.fn().mockReturnValue(false),
        getAllowedTools: vi.fn().mockReturnValue([]),
        getWorkspaceContext: vi.fn().mockReturnValue({
            isPathWithinWorkspace: () => true,
        }),
        getTargetDir: () => '/test',
        storage: {
            getProjectTempDir: () => '/tmp',
        },
        getTruncateToolOutputThreshold: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
        getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
        getDebugMode: vi.fn().mockReturnValue(false),
        getContentGeneratorConfig: vi.fn().mockReturnValue({ model: 'gemini-pro' }),
        getModel: vi.fn().mockReturnValue('gemini-pro'),
        getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
        setFallbackModelHandler: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
        getProxy: vi.fn().mockReturnValue(undefined),
        getHistory: vi.fn().mockReturnValue([]),
        getEmbeddingModel: vi.fn().mockReturnValue('text-embedding-004'),
        getSessionId: vi.fn().mockReturnValue('test-session-id'),
        getUserTier: vi.fn(),
        ...overrides,
    };
    mockConfig.getGeminiClient = vi
        .fn()
        .mockReturnValue(new GeminiClient(mockConfig));
    return mockConfig;
}
export function createStreamMessageRequest(text, messageId, taskId) {
    const request = {
        jsonrpc: '2.0',
        id: '1',
        method: 'message/stream',
        params: {
            message: {
                kind: 'message',
                role: 'user',
                parts: [{ kind: 'text', text }],
                messageId,
            },
            metadata: {
                coderAgent: {
                    kind: 'agent-settings',
                    workspacePath: '/tmp',
                },
            },
        },
    };
    if (taskId) {
        request.params.taskId = taskId;
    }
    return request;
}
export function assertUniqueFinalEventIsLast(events) {
    // Final event is input-required & final
    const finalEvent = events[events.length - 1].result;
    expect(finalEvent.metadata?.['coderAgent']).toMatchObject({
        kind: 'state-change',
    });
    expect(finalEvent.status?.state).toBe('input-required');
    expect(finalEvent.final).toBe(true);
    // There is only one event with final and its the last
    expect(events.filter((e) => e.result.final).length).toBe(1);
    expect(events.findIndex((e) => e.result.final)).toBe(events.length - 1);
}
export function assertTaskCreationAndWorkingStatus(events) {
    // Initial task creation event
    const taskEvent = events[0].result;
    expect(taskEvent.kind).toBe('task');
    expect(taskEvent.status.state).toBe('submitted');
    // Status update: working
    const workingEvent = events[1].result;
    expect(workingEvent.kind).toBe('status-update');
    expect(workingEvent.status.state).toBe('working');
}
//# sourceMappingURL=testing_utils.js.map