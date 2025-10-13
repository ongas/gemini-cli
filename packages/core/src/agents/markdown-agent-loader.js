/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
    static async loadFromDirectory(agentsDir, debugMode = false) {
        const agents = [];
        try {
            const files = await fs.readdir(agentsDir);
            const mdFiles = files.filter((f) => f.endsWith('.md'));
            if (debugMode) {
                console.log(`[MarkdownAgentLoader] Found ${mdFiles.length} markdown files in ${agentsDir}`);
            }
            for (const file of mdFiles) {
                const filePath = path.join(agentsDir, file);
                try {
                    const agent = await this.loadFromFile(filePath, debugMode);
                    if (agent) {
                        agents.push(agent);
                        if (debugMode) {
                            console.log(`[MarkdownAgentLoader] Loaded agent '${agent.name}' from ${file}`);
                        }
                    }
                }
                catch (error) {
                    if (debugMode) {
                        console.warn(`[MarkdownAgentLoader] Failed to load agent from ${file}:`, error);
                    }
                }
            }
        }
        catch (error) {
            if (debugMode) {
                console.warn(`[MarkdownAgentLoader] Failed to read agents directory ${agentsDir}:`, error);
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
    static async loadFromFile(filePath, debugMode = false) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return this.parseMarkdownAgent(content, filePath, debugMode);
        }
        catch (error) {
            if (debugMode) {
                console.warn(`[MarkdownAgentLoader] Error reading file ${filePath}:`, error);
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
    static parseMarkdownAgent(content, filePath, debugMode) {
        const lines = content.trim().split('\n');
        if (lines.length === 0) {
            return null;
        }
        // Extract YAML frontmatter first if present (must be at the very start)
        const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
        const yamlContent = yamlMatch ? yamlMatch[1] : '';
        // If YAML frontmatter exists, skip past it to find the heading
        let contentAfterYaml = content;
        if (yamlMatch) {
            contentAfterYaml = content.substring(yamlMatch[0].length).trim();
        }
        // Extract agent name from first heading (after YAML if present)
        const firstLine = contentAfterYaml.split('\n')[0].trim();
        if (!firstLine.startsWith('#')) {
            if (debugMode) {
                console.warn(`[MarkdownAgentLoader] File ${filePath} doesn't have a heading after YAML frontmatter`);
            }
            return null;
        }
        const displayName = firstLine.replace(/^#+\s*/, '').trim();
        // Generate agent name from filename (remove .md extension and convert to snake_case)
        const fileName = path.basename(filePath, '.md');
        const agentName = fileName.replace(/-/g, '_');
        // Extract description (content between first heading and ## Core Responsibilities or first substantial content)
        let description = '';
        const descriptionLines = [];
        let foundDescription = false;
        const linesAfterYaml = contentAfterYaml.split('\n');
        for (let i = 1; i < linesAfterYaml.length; i++) {
            const line = linesAfterYaml[i].trim();
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
                    const nextLine = linesAfterYaml[i + 1]?.trim();
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
        // Enhance description to make it more actionable for Gemini's tool selection
        // Add "Use this tool when..." prefix to help Gemini understand when to invoke it
        if (!description.toLowerCase().includes('use this tool')) {
            const agentNameLower = agentName.toLowerCase();
            let useCaseHint = '';
            if (agentNameLower.includes('scaffold')) {
                useCaseHint =
                    'Use this tool when the user wants to create, scaffold, setup, or initialize a new project. ';
            }
            else if (agentNameLower.includes('review')) {
                useCaseHint =
                    'Use this tool when the user wants to review, audit, or analyze code. ';
            }
            else if (agentNameLower.includes('test')) {
                useCaseHint =
                    'Use this tool when the user wants to generate, write, or create tests. ';
            }
            else if (agentNameLower.includes('doc')) {
                useCaseHint =
                    'Use this tool when the user wants to generate or write documentation. ';
            }
            if (useCaseHint) {
                description = useCaseHint + description;
                if (debugMode) {
                    console.log(`[MarkdownAgentLoader] Enhanced description for ${agentName}: ${description.substring(0, 100)}...`);
                }
            }
        }
        // Parse tools if specified
        // Format: **Tools:** tool1, tool2, tool3 or YAML frontmatter Tools: tool1, tool2, tool3
        let toolsMatch = content.match(/\*\*Tools:\*\*\s*([^\n]+)/i);
        if (!toolsMatch && yamlContent) {
            toolsMatch = yamlContent.match(/^Tools:\s*([^\n]+)/im);
        }
        const tools = toolsMatch
            ? toolsMatch[1]
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
            : undefined;
        if (debugMode && tools) {
            console.log(`[MarkdownAgentLoader] Parsed ${tools.length} tools from ${filePath}:`, tools);
        }
        // Parse model configuration overrides
        // Support both bold markdown and YAML frontmatter formats
        // Format: **Temperature:** 0.7 or **Temp:** 0.7 or YAML Temperature: 0.7
        let tempMatch = content.match(/\*\*(?:Temperature|Temp):\*\*\s*([0-9.]+)/i);
        if (!tempMatch && yamlContent) {
            tempMatch = yamlContent.match(/^(?:Temperature|Temp):\s*([0-9.]+)/im);
        }
        const temperature = tempMatch ? parseFloat(tempMatch[1]) : 0.2;
        // Format: **Model:** gemini-2.0-flash-exp or YAML Model: gemini-2.0-flash-exp
        let modelMatch = content.match(/\*\*Model:\*\*\s*([^\n]+)/i);
        if (!modelMatch && yamlContent) {
            modelMatch = yamlContent.match(/^Model:\s*([^\n]+)/im);
        }
        const model = modelMatch ? modelMatch[1].trim() : DEFAULT_GEMINI_MODEL;
        // Format: **Provider:** ollama or YAML frontmatter Provider: ollama
        let providerMatch = content.match(/\*\*Provider:\*\*\s*([^\n]+)/i);
        if (!providerMatch && yamlContent) {
            providerMatch = yamlContent.match(/^Provider:\s*([^\n]+)/im);
        }
        const provider = providerMatch
            ? providerMatch[1].trim().toLowerCase()
            : undefined;
        if (debugMode && (tempMatch || modelMatch || providerMatch)) {
            console.log(`[MarkdownAgentLoader] Model config from ${filePath}: model=${model}, temp=${temperature}, provider=${provider || 'default'}`);
        }
        // The entire markdown content becomes the system prompt
        // Append completion instructions to ensure agents know how to finish
        const completionInstructions = `

---

## IMPORTANT: Task Completion

When you have COMPLETED your task, you **MUST** call the \`complete_task\` tool to signal completion.

**Required:** Call \`complete_task\` with your final output/result.

Example:
\`\`\`
complete_task(result="Task completed successfully. [summary of what was done]")
\`\`\`

**Do NOT stop calling tools without calling complete_task** - this will result in an error.`;
        const systemPrompt = content.trim() + completionInstructions;
        // Create the agent definition
        const agent = {
            name: agentName,
            displayName,
            description,
            inputConfig: {
                inputs: {
                    task: {
                        description: 'The specific task or request for this agent to complete',
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
                model,
                temp: temperature,
                top_p: 0.95,
                thinkingBudget: -1,
                ...(provider && { provider }),
            },
            runConfig: {
                max_time_minutes: 5,
                max_turns: 10,
            },
            promptConfig: {
                systemPrompt,
                query: '${task}',
            },
            ...(tools && { toolConfig: { tools } }),
        };
        return agent;
    }
}
//# sourceMappingURL=markdown-agent-loader.js.map