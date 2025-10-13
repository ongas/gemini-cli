/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolResult, ToolInvocation } from './tools.js';
import { BaseDeclarativeTool } from './tools.js';
import type { Config } from '../config/config.js';
interface TaskToolParams {
  description: string;
  prompt: string;
  tools?: string[];
  max_time_minutes?: number;
  max_turns?: number;
}
export declare class TaskTool extends BaseDeclarativeTool<
  TaskToolParams,
  ToolResult
> {
  private readonly config;
  static readonly Name: string;
  constructor(config: Config);
  protected validateToolParamValues(params: TaskToolParams): string | null;
  protected createInvocation(
    params: TaskToolParams,
  ): ToolInvocation<TaskToolParams, ToolResult>;
}
export {};
