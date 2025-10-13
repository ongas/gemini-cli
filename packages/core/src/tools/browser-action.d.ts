/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool } from './tools.js';
import type { Config } from '../config/config.js';
/**
 * Parameters for the BrowserAction tool
 */
export interface BrowserActionToolParams {
    /**
     * Natural language task description for the browser agent
     */
    task: string;
    /**
     * Optional URL to navigate to before executing the task
     */
    url?: string;
    /**
     * Maximum number of steps the agent can take (default: 100)
     */
    max_steps?: number;
}
/**
 * Implementation of the BrowserAction tool logic
 */
export declare class BrowserActionTool extends BaseDeclarativeTool<BrowserActionToolParams, ToolResult> {
    private readonly config;
    static readonly Name: string;
    constructor(config: Config);
    protected validateToolParamValues(params: BrowserActionToolParams): string | null;
    protected createInvocation(params: BrowserActionToolParams): ToolInvocation<BrowserActionToolParams, ToolResult>;
}
