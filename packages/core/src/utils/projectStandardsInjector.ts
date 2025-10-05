/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project Standards Injector
 *
 * Automatically discovers and injects project standards from .agent-os/ directories
 * into Gemini prompts based on task detection, similar to Claude Code's behavior.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...args: any[]) =>
    console.debug('[DEBUG] [ProjectStandards]', ...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn: (...args: any[]) => console.warn('[WARN] [ProjectStandards]', ...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...args: any[]) =>
    console.error('[ERROR] [ProjectStandards]', ...args),
};

interface ProjectStandards {
  codeStyle?: string;
  bestPractices?: string;
  techStack?: string;
  languageSpecific?: { [key: string]: string };
}

interface TaskDetectionResult {
  taskType: 'coding' | 'planning' | 'testing' | 'git' | 'general';
  languages: string[];
  needsStandards: boolean;
}

/**
 * Detect task type and relevant languages from user prompt
 */
export function detectTaskContext(prompt: string): TaskDetectionResult {
  const lowerPrompt = prompt.toLowerCase();

  // Detect languages
  const languages: string[] = [];
  const languagePatterns: { [key: string]: RegExp } = {
    python: /python|\.py\b|pip\b|django|flask/,
    javascript: /javascript|\.js\b|node\.?js|npm|typescript|\.ts\b/,
    java: /\bjava\b|\.java\b|spring|maven/,
    ruby: /ruby|\.rb\b|rails|gem\b/,
    go: /\bgo\b|golang|\.go\b/,
    rust: /rust|\.rs\b|cargo/,
    php: /php|\.php\b|laravel|composer/,
    html: /html|\.html\b|markup/,
    css: /css|\.css\b|stylesheet|tailwind|sass|scss/,
  };

  for (const [lang, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(lowerPrompt)) {
      languages.push(lang);
    }
  }

  // Detect task type
  if (
    /\b(write|create|implement|add|build|code|function|class|method)\b/.test(
      lowerPrompt,
    )
  ) {
    return { taskType: 'coding', languages, needsStandards: true };
  }

  if (/\b(plan|design|architect|spec|roadmap|feature)\b/.test(lowerPrompt)) {
    return { taskType: 'planning', languages, needsStandards: true };
  }

  if (/\b(test|pytest|jest|mocha|spec|unit test)\b/.test(lowerPrompt)) {
    return { taskType: 'testing', languages, needsStandards: true };
  }

  if (/\b(git|commit|branch|push|pull|merge)\b/.test(lowerPrompt)) {
    return { taskType: 'git', languages, needsStandards: false };
  }

  return { taskType: 'general', languages, needsStandards: false };
}

/**
 * Find .agent-os directory in current working directory or parent directories
 */
export async function findProjectStandardsDirectory(
  startDir: string,
): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const agentOsPath = path.join(currentDir, '.agent-os');
    try {
      const stats = await fs.stat(agentOsPath);
      if (stats.isDirectory()) {
        logger.debug(`Found .agent-os at: ${agentOsPath}`);
        return agentOsPath;
      }
    } catch {
      // Directory doesn't exist, continue searching
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return null;
}

/**
 * Load project standards files
 */
export async function loadProjectStandards(
  agentOsDir: string,
): Promise<ProjectStandards> {
  const standardsDir = path.join(agentOsDir, 'standards');
  const standards: ProjectStandards = {
    languageSpecific: {},
  };

  try {
    // Load core standards files
    const codeStylePath = path.join(standardsDir, 'code-style.md');
    try {
      standards.codeStyle = await fs.readFile(codeStylePath, 'utf-8');
      logger.debug('Loaded code-style.md');
    } catch {
      logger.debug('No code-style.md found');
    }

    const bestPracticesPath = path.join(standardsDir, 'best-practices.md');
    try {
      standards.bestPractices = await fs.readFile(bestPracticesPath, 'utf-8');
      logger.debug('Loaded best-practices.md');
    } catch {
      logger.debug('No best-practices.md found');
    }

    const techStackPath = path.join(standardsDir, 'tech-stack.md');
    try {
      standards.techStack = await fs.readFile(techStackPath, 'utf-8');
      logger.debug('Loaded tech-stack.md');
    } catch {
      logger.debug('No tech-stack.md found');
    }

    // Load language-specific standards
    const codeStyleSubdir = path.join(standardsDir, 'code-style');
    try {
      const files = await fs.readdir(codeStyleSubdir);
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('-style.md')) {
          const langName = file
            .replace('-style.md', '')
            .replace('.md', '')
            .toLowerCase();
          const filePath = path.join(codeStyleSubdir, file);
          standards.languageSpecific![langName] = await fs.readFile(
            filePath,
            'utf-8',
          );
          logger.debug(`Loaded language-specific standard: ${file}`);
        }
      }
    } catch {
      logger.debug('No code-style subdirectory found');
    }
  } catch (error) {
    logger.warn('Error loading project standards:', error);
  }

  return standards;
}

/**
 * Build context string from relevant standards based on task detection
 */
export function buildContextFromStandards(
  standards: ProjectStandards,
  taskContext: TaskDetectionResult,
): string {
  if (!taskContext.needsStandards) {
    return '';
  }

  const contextParts: string[] = [];

  // Add header
  contextParts.push('# Project Standards\n');
  contextParts.push(
    'The following standards are automatically loaded from the .agent-os/ directory of this project.\n',
  );
  contextParts.push('Apply these standards to all work in this project.\n\n');

  // Add general code style
  if (standards.codeStyle && taskContext.taskType === 'coding') {
    contextParts.push('## Code Style Standards\n\n');
    contextParts.push(standards.codeStyle);
    contextParts.push('\n\n');
  }

  // Add best practices
  if (standards.bestPractices) {
    contextParts.push('## Best Practices\n\n');
    contextParts.push(standards.bestPractices);
    contextParts.push('\n\n');
  }

  // Add language-specific standards
  if (taskContext.languages.length > 0 && standards.languageSpecific) {
    for (const lang of taskContext.languages) {
      const langStandard = standards.languageSpecific[lang];
      if (langStandard) {
        contextParts.push(
          `## ${lang.charAt(0).toUpperCase() + lang.slice(1)} Specific Standards\n\n`,
        );
        contextParts.push(langStandard);
        contextParts.push('\n\n');
      }
    }
  }

  // Add tech stack for planning tasks
  if (standards.techStack && taskContext.taskType === 'planning') {
    contextParts.push('## Technology Stack\n\n');
    contextParts.push(standards.techStack);
    contextParts.push('\n\n');
  }

  if (contextParts.length <= 3) {
    // Only header was added
    return '';
  }

  return contextParts.join('');
}

/**
 * Main function to inject project standards context into a prompt
 */
export async function injectProjectStandards(
  userPrompt: string,
  workingDirectory: string,
): Promise<string> {
  console.log('[ProjectStandards] Starting context injection...');
  console.log('[ProjectStandards] Working directory:', workingDirectory);
  console.log('[ProjectStandards] User prompt:', userPrompt.substring(0, 100));

  // Detect task context
  const taskContext = detectTaskContext(userPrompt);
  console.log('[ProjectStandards] Detected task context:', taskContext);
  logger.debug('Detected task context:', taskContext);

  // Find .agent-os directory
  const agentOsDir = await findProjectStandardsDirectory(workingDirectory);
  console.log('[ProjectStandards] Found .agent-os directory:', agentOsDir);
  if (!agentOsDir) {
    console.log(
      '[ProjectStandards] No .agent-os directory found, skipping context injection',
    );
    logger.debug('No .agent-os directory found, skipping context injection');
    return userPrompt;
  }

  // Load standards
  const standards = await loadProjectStandards(agentOsDir);
  console.log('[ProjectStandards] Loaded standards:', Object.keys(standards));

  // Build context
  const context = buildContextFromStandards(standards, taskContext);
  console.log('[ProjectStandards] Built context length:', context.length);
  if (!context) {
    console.log('[ProjectStandards] No relevant standards found for this task');
    logger.debug('No relevant standards found for this task');
    return userPrompt;
  }

  // Inject context at the beginning of the prompt
  console.log(
    '[ProjectStandards] Injecting project standards context (',
    context.length,
    ' characters) into prompt',
  );
  logger.debug(
    `Injecting project standards context (${context.length} characters) into prompt`,
  );
  return `${context}\n---\n\n${userPrompt}`;
}

/**
 * Get project standards context as a separate system message (alternative approach)
 */
export async function getProjectStandardsSystemMessage(
  userPrompt: string,
  workingDirectory: string,
): Promise<string | null> {
  const taskContext = detectTaskContext(userPrompt);
  const agentOsDir = await findProjectStandardsDirectory(workingDirectory);

  if (!agentOsDir) {
    return null;
  }

  const standards = await loadProjectStandards(agentOsDir);
  const context = buildContextFromStandards(standards, taskContext);

  return context || null;
}
