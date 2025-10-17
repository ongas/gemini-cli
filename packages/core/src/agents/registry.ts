/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { AgentDefinition } from './types.js';
import { CodebaseInvestigatorAgent } from './codebase-investigator.js';
import { MarkdownAgentLoader } from './markdown-agent-loader.js';
import { GEMINI_DIR } from '../utils/paths.js';
import { type z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * Manages the discovery, loading, validation, and registration of
 * AgentDefinitions.
 */
export class AgentRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly agents = new Map<string, AgentDefinition<any>>();

  constructor(private readonly config: Config) {}

  /**
   * Discovers and loads agents.
   */
  async initialize(): Promise<void> {
    this.loadBuiltInAgents();
    await this.loadMarkdownAgents();

    const debugMode = this.config.getDebugMode();

    if (debugMode) {
      console.log(
        `[AgentRegistry] Initialized with ${this.agents.size} agents:`,
      );
      for (const agent of this.agents.values()) {
        const provider = agent.modelConfig.provider || 'gemini';
        console.log(
          `  - ${agent.displayName || agent.name} (${provider}/${agent.modelConfig.model})`,
        );
      }
    }
  }

  private loadBuiltInAgents(): void {
    const investigatorSettings = this.config.getCodebaseInvestigatorSettings();

    // Only register the agent if it's enabled in the settings.
    if (investigatorSettings?.enabled) {
      const agentDef = {
        ...CodebaseInvestigatorAgent,
        modelConfig: {
          ...CodebaseInvestigatorAgent.modelConfig,
          model:
            investigatorSettings.model ??
            CodebaseInvestigatorAgent.modelConfig.model,
          thinkingBudget:
            investigatorSettings.thinkingBudget ??
            CodebaseInvestigatorAgent.modelConfig.thinkingBudget,
        },
        runConfig: {
          ...CodebaseInvestigatorAgent.runConfig,
          max_time_minutes:
            investigatorSettings.maxTimeMinutes ??
            CodebaseInvestigatorAgent.runConfig.max_time_minutes,
          max_turns:
            investigatorSettings.maxNumTurns ??
            CodebaseInvestigatorAgent.runConfig.max_turns,
        },
      };
      this.registerAgent(agentDef);
    }
  }

  /**
   * Loads markdown-based agents from .gemini/agents/ directory in the current working directory.
   */
  private async loadMarkdownAgents(): Promise<void> {
    const debugMode = this.config.getDebugMode();
    const cwd = this.config.getWorkingDir();
    const agentsDir = path.join(cwd, GEMINI_DIR, 'agents');

    try {
      // Check if the agents directory exists
      await fs.access(agentsDir);

      if (debugMode) {
        console.log(
          `[AgentRegistry] Loading markdown agents from ${agentsDir}`,
        );
      }

      const agents = await MarkdownAgentLoader.loadFromDirectory(
        agentsDir,
        debugMode,
      );

      for (const agent of agents) {
        this.registerAgent(agent);
      }

      if (debugMode && agents.length > 0) {
        console.log(
          `[AgentRegistry] Loaded ${agents.length} markdown agents from ${agentsDir}`,
        );
      }
    } catch {
      // Directory doesn't exist or can't be accessed - this is fine, not all projects will have custom agents
      if (debugMode) {
        console.log(
          `[AgentRegistry] No markdown agents directory found at ${agentsDir}`,
        );
      }
    }
  }

  /**
   * Registers an agent definition. If an agent with the same name exists,
   * it will be overwritten, respecting the precedence established by the
   * initialization order.
   */
  protected registerAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): void {
    // Basic validation
    if (!definition.name || !definition.description) {
      console.warn(
        `[AgentRegistry] Skipping invalid agent definition. Missing name or description.`,
      );
      return;
    }

    if (this.agents.has(definition.name) && this.config.getDebugMode()) {
      console.log(`[AgentRegistry] Overriding agent '${definition.name}'`);
    }

    this.agents.set(definition.name, definition);
  }

  /**
   * Retrieves an agent definition by name.
   */
  getDefinition(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Returns all active agent definitions.
   */
  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
