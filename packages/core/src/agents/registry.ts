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

    if (this.config.getDebugMode()) {
      console.log(
        `[AgentRegistry] Initialized with ${this.agents.size} agents.`,
      );
    }
  }

  private loadBuiltInAgents(): void {
    this.registerAgent(CodebaseInvestigatorAgent);
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
