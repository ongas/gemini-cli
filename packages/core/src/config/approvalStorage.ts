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
  value: string; // e.g., "edit", "shell", "mcp:server-name", "npm test"
  description: string;
  createdAt: number;
  lastUsed?: number;
}

export interface ApprovalRules {
  rules: ApprovalRule[];
}

const APPROVAL_RULES_KEY = 'persistent_approvals';

/**
 * Manages persistent approval rules that survive across sessions.
 */
export class ApprovalStorage {
  constructor(private readonly storage: Storage) {}

  /**
   * Load all approval rules from storage
   */
  async loadRules(): Promise<ApprovalRule[]> {
    const data = await this.storage.get<ApprovalRules>(APPROVAL_RULES_KEY);
    return data?.rules ?? [];
  }

  /**
   * Save approval rules to storage
   */
  async saveRules(rules: ApprovalRule[]): Promise<void> {
    const fs = await import('node:fs');
    const logPath = '/tmp/gemini-approval-debug.log';
    const timestamp = new Date().toISOString();

    fs.appendFileSync(
      logPath,
      `${timestamp} - saveRules called with ${rules.length} rules\n`,
    );
    fs.appendFileSync(
      logPath,
      `${timestamp} - rules: ${JSON.stringify(rules, null, 2)}\n`,
    );

    try {
      await this.storage.set<ApprovalRules>(APPROVAL_RULES_KEY, { rules });
      fs.appendFileSync(
        logPath,
        `${timestamp} - storage.set completed successfully\n`,
      );
    } catch (error) {
      fs.appendFileSync(
        logPath,
        `${timestamp} - storage.set ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      throw error;
    }
  }

  /**
   * Add a new approval rule
   */
  async addRule(rule: Omit<ApprovalRule, 'id' | 'createdAt'>): Promise<void> {
    const fs = await import('node:fs');
    const logPath = '/tmp/gemini-approval-debug.log';
    const timestamp = new Date().toISOString();

    fs.appendFileSync(
      logPath,
      `${timestamp} - addRule called with type=${rule.type}, value=${rule.value}\n`,
    );

    const rules = await this.loadRules();
    fs.appendFileSync(
      logPath,
      `${timestamp} - loaded ${rules.length} existing rules\n`,
    );

    // Check if rule already exists
    const exists = rules.some(
      (r) => r.type === rule.type && r.value === rule.value,
    );

    fs.appendFileSync(logPath, `${timestamp} - rule exists check: ${exists}\n`);

    if (!exists) {
      const newRule: ApprovalRule = {
        ...rule,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
      };
      rules.push(newRule);
      fs.appendFileSync(
        logPath,
        `${timestamp} - pushed new rule, now have ${rules.length} rules\n`,
      );
      fs.appendFileSync(
        logPath,
        `${timestamp} - about to call saveRules with ${rules.length} rules\n`,
      );
      await this.saveRules(rules);
      fs.appendFileSync(logPath, `${timestamp} - saveRules completed\n`);
    } else {
      fs.appendFileSync(
        logPath,
        `${timestamp} - skipped adding rule (already exists)\n`,
      );
    }
  }

  /**
   * Remove an approval rule by ID
   */
  async removeRule(id: string): Promise<boolean> {
    const rules = await this.loadRules();
    const initialLength = rules.length;
    const filteredRules = rules.filter((r) => r.id !== id);

    if (filteredRules.length < initialLength) {
      await this.saveRules(filteredRules);
      return true;
    }
    return false;
  }

  /**
   * Clear all approval rules
   */
  async clearAll(): Promise<void> {
    await this.storage.set<ApprovalRules>(APPROVAL_RULES_KEY, { rules: [] });
  }

  /**
   * Update last used timestamp for a rule
   */
  async updateLastUsed(id: string): Promise<void> {
    const rules = await this.loadRules();
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      rule.lastUsed = Date.now();
      await this.saveRules(rules);
    }
  }

  /**
   * Check if a tool kind is approved
   */
  async isKindApproved(kind: Kind): Promise<ApprovalRule | null> {
    const rules = await this.loadRules();
    const rule = rules.find((r) => r.type === 'tool_kind' && r.value === kind);

    if (rule) {
      await this.updateLastUsed(rule.id);
      return rule;
    }
    return null;
  }

  /**
   * Check if a specific tool name is approved
   */
  async isToolApproved(toolName: string): Promise<ApprovalRule | null> {
    const rules = await this.loadRules();
    const rule = rules.find(
      (r) => r.type === 'tool_name' && r.value === toolName,
    );

    if (rule) {
      await this.updateLastUsed(rule.id);
      return rule;
    }
    return null;
  }

  /**
   * Check if an MCP server is approved
   */
  async isMcpServerApproved(serverName: string): Promise<ApprovalRule | null> {
    const rules = await this.loadRules();
    const rule = rules.find(
      (r) => r.type === 'mcp_server' && r.value === serverName,
    );

    if (rule) {
      await this.updateLastUsed(rule.id);
      return rule;
    }
    return null;
  }

  /**
   * Check if a command pattern is approved
   */
  async isCommandApproved(command: string): Promise<ApprovalRule | null> {
    const rules = await this.loadRules();

    // Try exact match first
    let rule = rules.find(
      (r) => r.type === 'command_pattern' && r.value === command,
    );

    if (!rule) {
      // Try pattern matching (simple startsWith for now)
      rule = rules.find((r) => {
        if (r.type === 'command_pattern') {
          // Support wildcards like "npm *" or "git *"
          if (r.value.endsWith(' *')) {
            const prefix = r.value.slice(0, -2);
            return command.startsWith(prefix);
          }
          return r.value === command;
        }
        return false;
      });
    }

    if (rule) {
      await this.updateLastUsed(rule.id);
      return rule;
    }
    return null;
  }

  /**
   * Add approval for a tool kind (e.g., "edit", "execute")
   */
  async approveKind(kind: Kind, description?: string): Promise<void> {
    const fs = await import('node:fs');
    const logPath = '/tmp/gemini-approval-debug.log';
    const timestamp = new Date().toISOString();

    fs.appendFileSync(
      logPath,
      `${timestamp} - approveKind called with kind=${kind}, description=${description}\n`,
    );

    try {
      await this.addRule({
        type: 'tool_kind',
        value: kind,
        description: description ?? `Always allow ${kind} operations`,
      });
      fs.appendFileSync(
        logPath,
        `${timestamp} - approveKind completed successfully\n`,
      );
    } catch (error) {
      fs.appendFileSync(
        logPath,
        `${timestamp} - approveKind ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      fs.appendFileSync(
        logPath,
        `${timestamp} - approveKind ERROR stack: ${error instanceof Error ? error.stack : 'no stack'}\n`,
      );
      throw error;
    }
  }

  /**
   * Add approval for a specific tool
   */
  async approveTool(toolName: string, description?: string): Promise<void> {
    await this.addRule({
      type: 'tool_name',
      value: toolName,
      description: description ?? `Always allow ${toolName} tool`,
    });
  }

  /**
   * Add approval for an MCP server
   */
  async approveMcpServer(
    serverName: string,
    description?: string,
  ): Promise<void> {
    await this.addRule({
      type: 'mcp_server',
      value: serverName,
      description: description ?? `Always allow MCP server: ${serverName}`,
    });
  }

  /**
   * Add approval for a command pattern
   */
  async approveCommand(command: string, description?: string): Promise<void> {
    await this.addRule({
      type: 'command_pattern',
      value: command,
      description: description ?? `Always allow command: ${command}`,
    });
  }
}
