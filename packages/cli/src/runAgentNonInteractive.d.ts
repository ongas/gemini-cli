/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@google/gemini-cli-core';
import type { LoadedSettings } from './config/settings.js';
/**
 * Runs an agent non-interactively using the AgentExecutor.
 * This provides proper agent execution with complete_task tool and multi-turn support.
 *
 * @param config The runtime configuration
 * @param settings The loaded settings
 * @param agentFilePath Path to the agent markdown file
 * @param userTask The task to give to the agent
 */
export declare function runAgentNonInteractive(
  config: Config,
  _settings: LoadedSettings,
  agentFilePath: string,
  userTask: string,
): Promise<void>;
