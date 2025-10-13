/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CodebaseInvestigatorAgent } from './codebase-investigator.js';
import { MarkdownAgentLoader } from './markdown-agent-loader.js';
import { GEMINI_DIR } from '../utils/paths.js';
import {} from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
/**
 * Manages the discovery, loading, validation, and registration of
 * AgentDefinitions.
 */
export class AgentRegistry {
  config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents = new Map();
  constructor(config) {
    this.config = config;
  }
  /**
   * Discovers and loads agents.
   */
  async initialize() {
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
  loadBuiltInAgents() {
    this.registerAgent(CodebaseInvestigatorAgent);
  }
  /**
   * Loads markdown-based agents from .gemini/agents/ directory in the current working directory.
   */
  async loadMarkdownAgents() {
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
  registerAgent(definition) {
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
  getDefinition(name) {
    return this.agents.get(name);
  }
  /**
   * Returns all active agent definitions.
   */
  getAllDefinitions() {
    return Array.from(this.agents.values());
  }
}
//# sourceMappingURL=registry.js.map
