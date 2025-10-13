/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentDefinition } from './types.js';
/**
 * Loads agent definitions from markdown files.
 *
 * Markdown files contain agent instructions and descriptions
 * that we convert into AgentDefinition objects.
 */
export declare class MarkdownAgentLoader {
  /**
   * Loads all agent definitions from a directory containing markdown files.
   *
   * @param agentsDir Path to the directory containing agent markdown files
   * @param debugMode Whether to log debug information
   * @returns Array of AgentDefinition objects
   */
  static loadFromDirectory(
    agentsDir: string,
    debugMode?: boolean,
  ): Promise<AgentDefinition[]>;
  /**
   * Loads a single agent definition from a markdown file.
   *
   * @param filePath Path to the markdown file
   * @param debugMode Whether to log debug information
   * @returns AgentDefinition or null if parsing fails
   */
  static loadFromFile(
    filePath: string,
    debugMode?: boolean,
  ): Promise<AgentDefinition | null>;
  /**
   * Parses markdown content into an AgentDefinition.
   *
   * Markdown format:
   * - First # heading is the agent display name
   * - Content after heading is the description
   * - Everything is used as the system prompt
   */
  private static parseMarkdownAgent;
}
