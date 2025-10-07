/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentDefinition } from './types.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { z } from 'zod';

/**
 * Loads agent definitions from markdown files.
 *
 * Markdown files contain agent instructions and descriptions
 * that we convert into AgentDefinition objects.
 */
export class MarkdownAgentLoader {
  /**
   * Loads all agent definitions from a directory containing markdown files.
   *
   * @param agentsDir Path to the directory containing agent markdown files
   * @param debugMode Whether to log debug information
   * @returns Array of AgentDefinition objects
   */
  static async loadFromDirectory(
    agentsDir: string,
    debugMode: boolean = false,
  ): Promise<AgentDefinition[]> {
    const agents: AgentDefinition[] = [];

    try {
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      if (debugMode) {
        console.log(
          `[MarkdownAgentLoader] Found ${mdFiles.length} markdown files in ${agentsDir}`,
        );
      }

      for (const file of mdFiles) {
        const filePath = path.join(agentsDir, file);
        try {
          const agent = await this.loadFromFile(filePath, debugMode);
          if (agent) {
            agents.push(agent);
            if (debugMode) {
              console.log(
                `[MarkdownAgentLoader] Loaded agent '${agent.name}' from ${file}`,
              );
            }
          }
        } catch (error) {
          if (debugMode) {
            console.warn(
              `[MarkdownAgentLoader] Failed to load agent from ${file}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      if (debugMode) {
        console.warn(
          `[MarkdownAgentLoader] Failed to read agents directory ${agentsDir}:`,
          error,
        );
      }
    }

    return agents;
  }

  /**
   * Loads a single agent definition from a markdown file.
   *
   * @param filePath Path to the markdown file
   * @param debugMode Whether to log debug information
   * @returns AgentDefinition or null if parsing fails
   */
  static async loadFromFile(
    filePath: string,
    debugMode: boolean = false,
  ): Promise<AgentDefinition | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseMarkdownAgent(content, filePath, debugMode);
    } catch (error) {
      if (debugMode) {
        console.warn(
          `[MarkdownAgentLoader] Error reading file ${filePath}:`,
          error,
        );
      }
      return null;
    }
  }

  /**
   * Parses markdown content into an AgentDefinition.
   *
   * Markdown format:
   * - First # heading is the agent display name
   * - Content after heading is the description
   * - Everything is used as the system prompt
   */
  private static parseMarkdownAgent(
    content: string,
    filePath: string,
    debugMode: boolean,
  ): AgentDefinition | null {
    const lines = content.trim().split('\n');
    if (lines.length === 0) {
      return null;
    }

    // Extract agent name from first heading
    const firstLine = lines[0].trim();
    if (!firstLine.startsWith('#')) {
      if (debugMode) {
        console.warn(
          `[MarkdownAgentLoader] File ${filePath} doesn't start with a heading`,
        );
      }
      return null;
    }

    const displayName = firstLine.replace(/^#+\s*/, '').trim();

    // Generate agent name from filename (remove .md extension and convert to snake_case)
    const fileName = path.basename(filePath, '.md');
    const agentName = fileName.replace(/-/g, '_');

    // Extract description (content between first heading and ## Core Responsibilities or first substantial content)
    let description = '';
    const descriptionLines: string[] = [];
    let foundDescription = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      // Stop at the first ## heading or when we have enough content
      if (line.startsWith('##')) {
        break;
      }

      // Skip empty lines at the start
      if (!foundDescription && line.length === 0) {
        continue;
      }

      if (line.length > 0) {
        foundDescription = true;
        descriptionLines.push(line);

        // Stop after we have a reasonable description (first paragraph)
        if (descriptionLines.length > 0 && line.length > 0) {
          const nextLine = lines[i + 1]?.trim();
          if (!nextLine || nextLine.length === 0 || nextLine.startsWith('##')) {
            break;
          }
        }
      }
    }

    description = descriptionLines.join(' ').trim();

    if (!description) {
      description = `Specialized agent for ${displayName.toLowerCase()} tasks`;
    }

    // The entire markdown content becomes the system prompt
    const systemPrompt = content.trim();

    // Create the agent definition
    const agent: AgentDefinition = {
      name: agentName,
      displayName,
      description,
      inputConfig: {
        inputs: {
          task: {
            description:
              'The specific task or request for this agent to complete',
            type: 'string',
            required: true,
          },
        },
      },
      outputConfig: {
        outputName: 'result',
        description: "The result of the agent's work",
        schema: z.unknown(),
      },
      modelConfig: {
        model: DEFAULT_GEMINI_MODEL,
        temp: 0.2,
        top_p: 0.95,
        thinkingBudget: -1,
      },
      runConfig: {
        max_time_minutes: 5,
        max_turns: 10,
      },
      promptConfig: {
        systemPrompt,
        query: '${task}',
      },
    };

    return agent;
  }
}
