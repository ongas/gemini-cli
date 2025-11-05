/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool } from './tools.js';
import type { Config } from '../config/config.js';
/**
 * Checks if `rg` exists, if not then attempt to download it.
 */
export declare function canUseRipgrep(): Promise<boolean>;
/**
 * Ensures `rg` is downloaded, or throws.
 */
export declare function ensureRgPath(): Promise<string>;
/**
 * Parameters for the GrepTool
 */
export interface RipGrepToolParams {
    /**
     * The regular expression pattern to search for in file contents
     */
    pattern: string;
    /**
     * The directory to search in (optional, defaults to current directory relative to root)
     */
    path?: string;
    /**
     * File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")
     */
    include?: string;
}
/**
 * Implementation of the Grep tool logic (moved from CLI)
 */
export declare class RipGrepTool extends BaseDeclarativeTool<RipGrepToolParams, ToolResult> {
    private readonly config;
    static readonly Name = "search_file_content";
    constructor(config: Config, messageBus?: MessageBus);
    /**
     * Checks if a path is within the root directory and resolves it.
     * @param relativePath Path relative to the root directory (or undefined for root).
     * @returns The absolute path if valid and exists, or null if no path specified (to search all directories).
     * @throws {Error} If path is outside root, doesn't exist, or isn't a directory.
     */
    private resolveAndValidatePath;
    /**
     * Escapes regex special characters in a string to make it literal
     * @param str The string to escape
     * @returns The escaped string safe for use in a regex
     */
    private escapeRegexSpecialChars;
    /**
     * Attempts to fix common regex errors by escaping special characters
     * @param pattern The original pattern
     * @returns The sanitized pattern that should work as a regex
     */
    private sanitizePattern;
    /**
     * Validates the parameters for the tool
     * @param params Parameters to validate
     * @returns An error message string if invalid, null otherwise
     */
    validateToolParams(params: RipGrepToolParams): string | null;
    protected createInvocation(params: RipGrepToolParams, messageBus?: MessageBus, _toolName?: string, _toolDisplayName?: string): ToolInvocation<RipGrepToolParams, ToolResult>;
}
