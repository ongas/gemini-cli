/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Config, type GeminiCLIExtension } from '@google/gemini-cli-core';
import type { Settings } from './settings.js';
import { type AgentSettings } from '../types.js';
export declare function loadConfig(settings: Settings, extensions: GeminiCLIExtension[], taskId: string): Promise<Config>;
export declare function mergeMcpServers(settings: Settings, extensions: GeminiCLIExtension[]): {
    [x: string]: import("@google/gemini-cli-core").MCPServerConfig;
};
export declare function setTargetDir(agentSettings: AgentSettings | undefined): string;
export declare function loadEnvironment(): void;
