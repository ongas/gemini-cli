/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Parses workflow instructions and converts Claude Code-specific syntax
 * to Gemini CLI-compatible syntax.
 *
 * This parser provides compatibility for workflows written for Claude Code
 * (Anthropic's official CLI), allowing them to work with Gemini CLI.
 *
 * This parser handles:
 * - <step subagent="..."> directives
 * - Claude Code Task tool references
 * - Agent invocation syntax differences
 */
/**
 * Converts workflow instructions from Claude Code format to Gemini CLI format.
 *
 * Key transformations:
 * 1. <step subagent="agent-name"> -> Instructions to use the agent_name tool
 * 2. "Use the X subagent" -> "Use the x tool to invoke the X subagent"
 * 3. Claude-specific directives -> Gemini tool call patterns
 *
 * @param content The original instruction content
 * @returns Transformed content compatible with Gemini CLI
 */
export declare function convertClaudeCodeInstructions(content: string): string;
/**
 * Checks if content appears to contain Claude Code workflow syntax
 * that needs conversion.
 *
 * @param content The content to check
 * @returns true if conversion is likely needed
 */
export declare function needsClaudeCodeConversion(content: string): boolean;
/**
 * Converts content from a file if it appears to contain Claude Code workflow syntax.
 * Otherwise returns content unchanged.
 *
 * @param content The file content
 * @param filePath The path to the file (for context)
 * @returns Converted or original content
 */
export declare function maybeConvertClaudeCodeInstructions(content: string, filePath: string): string;
