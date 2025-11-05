/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
interface ProjectStandards {
    codeStyle?: string;
    bestPractices?: string;
    techStack?: string;
    languageSpecific?: {
        [key: string]: string;
    };
}
interface TaskDetectionResult {
    taskType: 'coding' | 'planning' | 'testing' | 'git' | 'general';
    languages: string[];
    needsStandards: boolean;
}
/**
 * Detect task type and relevant languages from user prompt
 */
export declare function detectTaskContext(prompt: string): TaskDetectionResult;
/**
 * Find .project-standards directory in current working directory or parent directories
 */
export declare function findProjectStandardsDirectory(startDir: string): Promise<string | null>;
/**
 * Load project standards files
 */
export declare function loadProjectStandards(projectStandardsDir: string): Promise<ProjectStandards>;
/**
 * Build context string from relevant standards based on task detection
 */
export declare function buildContextFromStandards(standards: ProjectStandards, taskContext: TaskDetectionResult): string;
/**
 * Main function to inject project standards context into a prompt
 */
export declare function injectProjectStandards(userPrompt: string, workingDirectory: string): Promise<string>;
/**
 * Get project standards context as a separate system message (alternative approach)
 */
export declare function getProjectStandardsSystemMessage(userPrompt: string, workingDirectory: string): Promise<string | null>;
export {};
