/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Storage } from './storage.js';
import type { Kind } from '../tools/tools.js';
export interface ApprovalRule {
    id: string;
    type: 'tool_kind' | 'tool_name' | 'mcp_server' | 'command_pattern';
    value: string;
    description: string;
    createdAt: number;
    lastUsed?: number;
}
export interface ApprovalRules {
    rules: ApprovalRule[];
}
/**
 * Manages persistent approval rules that survive across sessions.
 */
export declare class ApprovalStorage {
    private readonly storage;
    constructor(storage: Storage);
    /**
     * Load all approval rules from storage
     */
    loadRules(): Promise<ApprovalRule[]>;
    /**
     * Save approval rules to storage
     */
    saveRules(rules: ApprovalRule[]): Promise<void>;
    /**
     * Add a new approval rule
     */
    addRule(rule: Omit<ApprovalRule, 'id' | 'createdAt'>): Promise<void>;
    /**
     * Remove an approval rule by ID
     */
    removeRule(id: string): Promise<boolean>;
    /**
     * Clear all approval rules
     */
    clearAll(): Promise<void>;
    /**
     * Update last used timestamp for a rule
     */
    updateLastUsed(id: string): Promise<void>;
    /**
     * Check if a tool kind is approved
     */
    isKindApproved(kind: Kind): Promise<ApprovalRule | null>;
    /**
     * Check if a specific tool name is approved
     */
    isToolApproved(toolName: string): Promise<ApprovalRule | null>;
    /**
     * Check if an MCP server is approved
     */
    isMcpServerApproved(serverName: string): Promise<ApprovalRule | null>;
    /**
     * Check if a command pattern is approved
     */
    isCommandApproved(command: string): Promise<ApprovalRule | null>;
    /**
     * Add approval for a tool kind (e.g., "edit", "execute")
     */
    approveKind(kind: Kind, description?: string): Promise<void>;
    /**
     * Add approval for a specific tool
     */
    approveTool(toolName: string, description?: string): Promise<void>;
    /**
     * Add approval for an MCP server
     */
    approveMcpServer(serverName: string, description?: string): Promise<void>;
    /**
     * Add approval for a command pattern
     */
    approveCommand(command: string, description?: string): Promise<void>;
}
