/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, GenerateContentConfig } from '@google/genai';
import type { GeminiClient } from '../core/client.js';
import type { BaseLlmClient } from '../core/baseLlmClient.js';
import type { EditToolParams } from '../tools/edit.js';
import { EditTool } from '../tools/edit.js';
import { WriteFileTool } from '../tools/write-file.js';
import { ReadFileTool } from '../tools/read-file.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { GrepTool } from '../tools/grep.js';
import { LruCache } from './LruCache.js';
import { DEFAULT_GEMINI_FLASH_LITE_MODEL } from '../config/models.js';
import {
  isFunctionResponse,
  isFunctionCall,
} from '../utils/messageInspectors.js';
import * as fs from 'node:fs';
import { promptIdContext } from './promptIdContext.js';
import {
  findPythonMatchWithFlexibleIndentation,
  isPythonFile,
  applyPythonMatch,
} from './pythonIndentMatcher.js';

const EDIT_MODEL = DEFAULT_GEMINI_FLASH_LITE_MODEL;
const EDIT_CONFIG: GenerateContentConfig = {
  thinkingConfig: {
    thinkingBudget: 0,
  },
};

const CODE_CORRECTION_SYSTEM_PROMPT = `
You are an expert code-editing assistant. Your task is to analyze a failed edit attempt and provide a corrected version of the text snippets.
The correction should be as minimal as possible, staying very close to the original.
Focus ONLY on fixing issues like whitespace, indentation, line endings, or incorrect escaping.
Do NOT invent a completely new edit. Your job is to fix the provided parameters to make the edit succeed.
Return ONLY the corrected snippet in the specified JSON format.
`.trim();

function getPromptId(): string {
  return promptIdContext.getStore() ?? `edit-corrector-${Date.now()}`;
}

const MAX_CACHE_SIZE = 50;

// Cache for ensureCorrectEdit results
const editCorrectionCache = new LruCache<string, CorrectedEditResult>(
  MAX_CACHE_SIZE,
);

// Cache for ensureCorrectFileContent results
const fileContentCorrectionCache = new LruCache<string, string>(MAX_CACHE_SIZE);

// Track failed edit attempts to provide better error messages and prevent loops
interface FailedEditAttempt {
  filePath: string;
  oldString: string;
  timestamp: number;
  attemptNumber: number;
}

const MAX_FAILED_ATTEMPTS_TRACKED = 100;
const FAILED_EDIT_WINDOW_MS = 60000; // Track failures within 60 seconds
const failedEditAttempts = new LruCache<string, FailedEditAttempt[]>(
  MAX_FAILED_ATTEMPTS_TRACKED,
);

/**
 * Records a failed edit attempt for tracking purposes.
 */
function recordFailedEditAttempt(
  filePath: string,
  oldString: string,
): number {
  const now = Date.now();
  const key = filePath;

  // Get existing attempts for this file
  let attempts = failedEditAttempts.get(key) || [];

  // Clean up old attempts outside the time window
  attempts = attempts.filter(
    (attempt) => now - attempt.timestamp < FAILED_EDIT_WINDOW_MS,
  );

  // Count attempts with similar old_string (using first 100 chars as approximation)
  const oldStringPrefix = oldString.substring(0, 100);
  const similarAttempts = attempts.filter((attempt) =>
    attempt.oldString.substring(0, 100).includes(oldStringPrefix) ||
    oldStringPrefix.includes(attempt.oldString.substring(0, 100)),
  );

  const attemptNumber = similarAttempts.length + 1;

  // Add new attempt
  attempts.push({
    filePath,
    oldString,
    timestamp: now,
    attemptNumber,
  });

  // Store updated attempts
  failedEditAttempts.set(key, attempts);

  return attemptNumber;
}

/**
 * Gets information about recent failed attempts for a file.
 */
function getFailedAttemptInfo(filePath: string, oldString: string): {
  recentAttempts: number;
  shouldStop: boolean;
  errorMessage: string | null;
} {
  const now = Date.now();
  const key = filePath;

  const attempts = failedEditAttempts.get(key) || [];
  const recentAttempts = attempts.filter(
    (attempt) => now - attempt.timestamp < FAILED_EDIT_WINDOW_MS,
  );

  if (recentAttempts.length === 0) {
    return { recentAttempts: 0, shouldStop: false, errorMessage: null };
  }

  // Check for similar attempts
  const oldStringPrefix = oldString.substring(0, 100);
  const similarAttempts = recentAttempts.filter((attempt) =>
    attempt.oldString.substring(0, 100).includes(oldStringPrefix) ||
    oldStringPrefix.includes(attempt.oldString.substring(0, 100)),
  );

  const count = similarAttempts.length;

  if (count >= 3) {
    const firstAttempt = similarAttempts[0];
    const timeSinceFirst = ((now - firstAttempt.timestamp) / 1000).toFixed(1);

    const errorMessage = `
CRITICAL: Edit tool has failed ${count} times on file ${filePath} in the last ${timeSinceFirst} seconds.

Previous failed attempts:
${similarAttempts.map((attempt, i) => `${i + 1}. Attempt at ${new Date(attempt.timestamp).toISOString().substring(11, 19)} - old_string started with: "${attempt.oldString.substring(0, 60).replace(/\n/g, '\\n')}..."`).join('\n')}

STOP trying to edit this location. The edit tool cannot find a match for your old_string.

Recommended actions:
1. STOP immediately - do not attempt this edit again
2. Use the read_file tool to re-read lines around the area you're trying to edit
3. Carefully verify the EXACT content including all whitespace and indentation
4. If this is Python code, ensure your indentation exactly matches the file
5. Consider if the file content has changed since you last read it
6. If multiple attempts fail, the issue may be with your understanding of the file content - read it again

Do NOT retry the same edit. The loop detection system will terminate the conversation if you continue.
`.trim();

    return {
      recentAttempts: count,
      shouldStop: true,
      errorMessage,
    };
  } else if (count === 2) {
    const errorMessage = `
Warning: Edit tool has failed ${count} times on file ${filePath} for similar content.

This is your LAST attempt before the system will block further edits to this location.

Before trying again:
1. Use read_file to verify the exact file content
2. Ensure your old_string matches EXACTLY (including all whitespace)
3. For Python files, verify the indentation matches precisely
`.trim();

    return {
      recentAttempts: count,
      shouldStop: false,
      errorMessage,
    };
  }

  return { recentAttempts: count, shouldStop: false, errorMessage: null };
}

/**
 * Defines the structure of the parameters within CorrectedEditResult
 */
interface CorrectedEditParams {
  file_path: string;
  old_string: string;
  new_string: string;
}

/**
 * Defines the result structure for ensureCorrectEdit.
 */
export interface CorrectedEditResult {
  params: CorrectedEditParams;
  occurrences: number;
  errorMessage?: string; // Optional enhanced error message for repeated failures
}

/**
 * Extracts the timestamp from the .id value, which is in format
 * <tool.name>-<timestamp>-<uuid>
 * @param fcnId the ID value of a functionCall or functionResponse object
 * @returns -1 if the timestamp could not be extracted, else the timestamp (as a number)
 */
function getTimestampFromFunctionId(fcnId: string): number {
  const idParts = fcnId.split('-');
  if (idParts.length > 2) {
    const timestamp = parseInt(idParts[1], 10);
    if (!isNaN(timestamp)) {
      return timestamp;
    }
  }
  return -1;
}

/**
 * Will look through the gemini client history and determine when the most recent
 * edit to a target file occurred. If no edit happened, it will return -1
 * @param filePath the path to the file
 * @param client the geminiClient, so that we can get the history
 * @returns a DateTime (as a number) of when the last edit occurred, or -1 if no edit was found.
 */
async function findLastEditTimestamp(
  filePath: string,
  client: GeminiClient,
): Promise<number> {
  const history = (await client.getHistory()) ?? [];

  // Tools that may reference the file path in their FunctionResponse `output`.
  const toolsInResp = new Set([
    WriteFileTool.Name,
    EditTool.Name,
    ReadManyFilesTool.Name,
    GrepTool.Name,
  ]);
  // Tools that may reference the file path in their FunctionCall `args`.
  const toolsInCall = new Set([...toolsInResp, ReadFileTool.Name]);

  // Iterate backwards to find the most recent relevant action.
  for (const entry of history.slice().reverse()) {
    if (!entry.parts) continue;

    for (const part of entry.parts) {
      let id: string | undefined;
      let content: unknown;

      // Check for a relevant FunctionCall with the file path in its arguments.
      if (
        isFunctionCall(entry) &&
        part.functionCall?.name &&
        toolsInCall.has(part.functionCall.name)
      ) {
        id = part.functionCall.id;
        content = part.functionCall.args;
      }
      // Check for a relevant FunctionResponse with the file path in its output.
      else if (
        isFunctionResponse(entry) &&
        part.functionResponse?.name &&
        toolsInResp.has(part.functionResponse.name)
      ) {
        const { response } = part.functionResponse;
        if (response && !('error' in response) && 'output' in response) {
          id = part.functionResponse.id;
          content = response['output'];
        }
      }

      if (!id || content === undefined) continue;

      // Use the "blunt hammer" approach to find the file path in the content.
      // Note that the tool response data is inconsistent in their formatting
      // with successes and errors - so, we just check for the existence
      // as the best guess to if error/failed occurred with the response.
      const stringified = JSON.stringify(content);
      if (
        !stringified.includes('Error') && // only applicable for functionResponse
        !stringified.includes('Failed') && // only applicable for functionResponse
        stringified.includes(filePath)
      ) {
        return getTimestampFromFunctionId(id);
      }
    }
  }

  return -1;
}

/**
 * Attempts to correct edit parameters if the original old_string is not found.
 * It tries unescaping, and then LLM-based correction.
 * Results are cached to avoid redundant processing.
 *
 * @param currentContent The current content of the file.
 * @param originalParams The original EditToolParams
 * @param client The GeminiClient for LLM calls.
 * @returns A promise resolving to an object containing the (potentially corrected)
 *          EditToolParams (as CorrectedEditParams) and the final occurrences count.
 */
export async function ensureCorrectEdit(
  filePath: string,
  currentContent: string,
  originalParams: EditToolParams, // This is the EditToolParams from edit.ts, without \'corrected\'
  geminiClient: GeminiClient,
  baseLlmClient: BaseLlmClient,
  abortSignal: AbortSignal,
): Promise<CorrectedEditResult> {
  const cacheKey = `${currentContent}---${originalParams.old_string}---${originalParams.new_string}`;
  const cachedResult = editCorrectionCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // Check for repeated failures before attempting correction
  const failureInfo = getFailedAttemptInfo(filePath, originalParams.old_string);
  if (failureInfo.shouldStop && failureInfo.errorMessage) {
    // Return result with 0 occurrences and the enhanced error message
    const result: CorrectedEditResult = {
      params: { ...originalParams },
      occurrences: 0,
      errorMessage: failureInfo.errorMessage,
    };
    return result;
  }

  let finalNewString = originalParams.new_string;
  const newStringPotentiallyEscaped =
    unescapeStringForGeminiBug(originalParams.new_string) !==
    originalParams.new_string;

  const expectedReplacements = originalParams.expected_replacements ?? 1;

  let finalOldString = originalParams.old_string;
  let occurrences = countOccurrences(currentContent, finalOldString);

  if (occurrences === expectedReplacements) {
    if (newStringPotentiallyEscaped) {
      finalNewString = await correctNewStringEscaping(
        baseLlmClient,
        finalOldString,
        originalParams.new_string,
        abortSignal,
      );
    }
  } else if (occurrences > expectedReplacements) {
    const expectedReplacements = originalParams.expected_replacements ?? 1;

    // If user expects multiple replacements, return as-is
    if (occurrences === expectedReplacements) {
      const result: CorrectedEditResult = {
        params: { ...originalParams },
        occurrences,
      };
      editCorrectionCache.set(cacheKey, result);
      return result;
    }

    // If user expects 1 but found multiple, try to correct (existing behavior)
    if (expectedReplacements === 1) {
      const result: CorrectedEditResult = {
        params: { ...originalParams },
        occurrences,
      };
      editCorrectionCache.set(cacheKey, result);
      return result;
    }

    // If occurrences don't match expected, return as-is (will fail validation later)
    const result: CorrectedEditResult = {
      params: { ...originalParams },
      occurrences,
    };
    editCorrectionCache.set(cacheKey, result);
    return result;
  } else {
    // occurrences is 0 or some other unexpected state initially
    const unescapedOldStringAttempt = unescapeStringForGeminiBug(
      originalParams.old_string,
    );
    occurrences = countOccurrences(currentContent, unescapedOldStringAttempt);

    if (occurrences === expectedReplacements) {
      finalOldString = unescapedOldStringAttempt;
      if (newStringPotentiallyEscaped) {
        finalNewString = await correctNewString(
          baseLlmClient,
          originalParams.old_string, // original old
          unescapedOldStringAttempt, // corrected old
          originalParams.new_string, // original new (which is potentially escaped)
          abortSignal,
        );
      }
    } else if (occurrences === 0) {
      // Try Python-specific indentation-flexible matching before LLM correction
      if (filePath && isPythonFile(filePath)) {
        console.log(
          `[Python Edit] Attempting flexible indentation matching for ${filePath}`,
        );
        console.log(
          `[Python Edit] old_string has ${unescapedOldStringAttempt.split('\n').length} lines`,
        );
        console.log(
          `[Python Edit] File has ${currentContent.split('\n').length} total lines`,
        );

        const pythonMatch = findPythonMatchWithFlexibleIndentation(
          currentContent,
          unescapedOldStringAttempt,
          originalParams.new_string,
          true, // Enable debug logging
        );

        if (pythonMatch) {
          const { actualOldString, actualNewString } = applyPythonMatch(
            currentContent,
            pythonMatch,
          );

          // Found a match with flexible indentation!
          finalOldString = actualOldString;
          finalNewString = actualNewString;
          occurrences = 1; // We found exactly one match

          console.log(
            `[Python Edit] ✓ Found match with flexible indentation adjustment (base indent: ${pythonMatch.fileIndent} spaces)`,
          );

          const result: CorrectedEditResult = {
            params: {
              file_path: originalParams.file_path,
              old_string: finalOldString,
              new_string: finalNewString,
            },
            occurrences,
          };
          editCorrectionCache.set(cacheKey, result);
          return result;
        } else {
          console.log(
            `[Python Edit] ✗ No match found with flexible indentation`,
          );
          console.log(
            `[Python Edit] First line of old_string (trimmed): "${unescapedOldStringAttempt.split('\n')[0].trim()}"`,
          );
          console.log(
            `[Python Edit] Last line of old_string (trimmed): "${unescapedOldStringAttempt.split('\n').slice(-1)[0].trim()}"`,
          );
        }
      }

      if (filePath) {
        // In order to keep from clobbering edits made outside our system,
        // let's check if there was a more recent edit to the file than what
        // our system has done
        const lastEditedByUsTime = await findLastEditTimestamp(
          filePath,
          geminiClient,
        );

        // Add a 1-second buffer to account for timing inaccuracies. If the file
        // was modified more than a second after the last edit tool was run, we
        // can assume it was modified by something else.
        if (lastEditedByUsTime > 0) {
          const stats = fs.statSync(filePath);
          const diff = stats.mtimeMs - lastEditedByUsTime;
          if (diff > 2000) {
            // Hard coded for 2 seconds
            // This file was edited sooner
            recordFailedEditAttempt(filePath, originalParams.old_string);

            const failureWarning = getFailedAttemptInfo(filePath, originalParams.old_string);
            const result: CorrectedEditResult = {
              params: { ...originalParams },
              occurrences: 0, // Explicitly 0 as LLM failed
              errorMessage: failureWarning.errorMessage ?? undefined,
            };
            editCorrectionCache.set(cacheKey, result);
            return result;
          }
        }
      }

      console.log(
        `[Edit Corrector] Attempting LLM-based old_string correction for ${filePath}`,
      );
      const llmCorrectedOldString = await correctOldStringMismatch(
        baseLlmClient,
        currentContent,
        unescapedOldStringAttempt,
        abortSignal,
      );
      console.log(
        `[Edit Corrector] LLM correction completed for ${filePath}`,
      );
      const llmOldOccurrences = countOccurrences(
        currentContent,
        llmCorrectedOldString,
      );

      if (llmOldOccurrences === expectedReplacements) {
        finalOldString = llmCorrectedOldString;
        occurrences = llmOldOccurrences;

        if (newStringPotentiallyEscaped) {
          const baseNewStringForLLMCorrection = unescapeStringForGeminiBug(
            originalParams.new_string,
          );
          finalNewString = await correctNewString(
            baseLlmClient,
            originalParams.old_string, // original old
            llmCorrectedOldString, // corrected old
            baseNewStringForLLMCorrection, // base new for correction
            abortSignal,
          );
        }
      } else {
        // LLM correction also failed for old_string
        recordFailedEditAttempt(filePath, originalParams.old_string);

        const failureWarning = getFailedAttemptInfo(filePath, originalParams.old_string);
        const result: CorrectedEditResult = {
          params: { ...originalParams },
          occurrences: 0, // Explicitly 0 as LLM failed
          errorMessage: failureWarning.errorMessage ?? undefined,
        };
        editCorrectionCache.set(cacheKey, result);
        return result;
      }
    } else {
      // Unescaping old_string resulted in > 1 occurrence
      const result: CorrectedEditResult = {
        params: { ...originalParams },
        occurrences, // This will be > 1
      };
      editCorrectionCache.set(cacheKey, result);
      return result;
    }
  }

  const { targetString, pair } = trimPairIfPossible(
    finalOldString,
    finalNewString,
    currentContent,
    expectedReplacements,
  );
  finalOldString = targetString;
  finalNewString = pair;

  // Final result construction
  const result: CorrectedEditResult = {
    params: {
      file_path: originalParams.file_path,
      old_string: finalOldString,
      new_string: finalNewString,
    },
    occurrences: countOccurrences(currentContent, finalOldString), // Recalculate occurrences with the final old_string
  };
  editCorrectionCache.set(cacheKey, result);
  return result;
}

export async function ensureCorrectFileContent(
  content: string,
  baseLlmClient: BaseLlmClient,
  abortSignal: AbortSignal,
): Promise<string> {
  const cachedResult = fileContentCorrectionCache.get(content);
  if (cachedResult) {
    return cachedResult;
  }

  const contentPotentiallyEscaped =
    unescapeStringForGeminiBug(content) !== content;
  if (!contentPotentiallyEscaped) {
    fileContentCorrectionCache.set(content, content);
    return content;
  }

  const correctedContent = await correctStringEscaping(
    content,
    baseLlmClient,
    abortSignal,
  );
  fileContentCorrectionCache.set(content, correctedContent);
  return correctedContent;
}

// Define the expected JSON schema for the LLM response for old_string correction
const OLD_STRING_CORRECTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    corrected_target_snippet: {
      type: 'string',
      description:
        'The corrected version of the target snippet that exactly and uniquely matches a segment within the provided file content.',
    },
  },
  required: ['corrected_target_snippet'],
};

export async function correctOldStringMismatch(
  baseLlmClient: BaseLlmClient,
  fileContent: string,
  problematicSnippet: string,
  abortSignal: AbortSignal,
): Promise<string> {
  const prompt = `
Context: A process needs to find an exact literal, unique match for a specific text snippet within a file's content. The provided snippet failed to match exactly. This is most likely because it has been overly escaped.

Task: Analyze the provided file content and the problematic target snippet. Identify the segment in the file content that the snippet was *most likely* intended to match. Output the *exact*, literal text of that segment from the file content. Focus *only* on removing extra escape characters and correcting formatting, whitespace, or minor differences to achieve a PERFECT literal match. The output must be the exact literal text as it appears in the file.

Problematic target snippet:
\`\`\`
${problematicSnippet}
\`\`\`

File Content:
\`\`\`
${fileContent}
\`\`\`

For example, if the problematic target snippet was "\\\\\\nconst greeting = \`Hello \\\\\`\${name}\\\\\`\`;" and the file content had content that looked like "\nconst greeting = \`Hello ${'\\`'}\${name}${'\\`'}\`;", then corrected_target_snippet should likely be "\nconst greeting = \`Hello ${'\\`'}\${name}${'\\`'}\`;" to fix the incorrect escaping to match the original file content.
If the differences are only in whitespace or formatting, apply similar whitespace/formatting changes to the corrected_target_snippet.

Return ONLY the corrected target snippet in the specified JSON format with the key 'corrected_target_snippet'. If no clear, unique match can be found, return an empty string for 'corrected_target_snippet'.
`.trim();

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

  try {
    const result = await baseLlmClient.generateJson({
      contents,
      schema: OLD_STRING_CORRECTION_SCHEMA,
      abortSignal,
      model: EDIT_MODEL,
      config: EDIT_CONFIG,
      systemInstruction: CODE_CORRECTION_SYSTEM_PROMPT,
      promptId: getPromptId(),
    });

    if (
      result &&
      typeof result['corrected_target_snippet'] === 'string' &&
      result['corrected_target_snippet'].length > 0
    ) {
      return result['corrected_target_snippet'];
    } else {
      return problematicSnippet;
    }
  } catch (error) {
    if (abortSignal.aborted) {
      throw error;
    }

    console.error(
      'Error during LLM call for old string snippet correction:',
      error,
    );

    return problematicSnippet;
  }
}

// Define the expected JSON schema for the new_string correction LLM response
const NEW_STRING_CORRECTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    corrected_new_string: {
      type: 'string',
      description:
        'The original_new_string adjusted to be a suitable replacement for the corrected_old_string, while maintaining the original intent of the change.',
    },
  },
  required: ['corrected_new_string'],
};

/**
 * Adjusts the new_string to align with a corrected old_string, maintaining the original intent.
 */
export async function correctNewString(
  baseLlmClient: BaseLlmClient,
  originalOldString: string,
  correctedOldString: string,
  originalNewString: string,
  abortSignal: AbortSignal,
): Promise<string> {
  if (originalOldString === correctedOldString) {
    return originalNewString;
  }

  const prompt = `
Context: A text replacement operation was planned. The original text to be replaced (original_old_string) was slightly different from the actual text in the file (corrected_old_string). The original_old_string has now been corrected to match the file content.
We now need to adjust the replacement text (original_new_string) so that it makes sense as a replacement for the corrected_old_string, while preserving the original intent of the change.

original_old_string (what was initially intended to be found):
\`\`\`
${originalOldString}
\`\`\`

corrected_old_string (what was actually found in the file and will be replaced):
\`\`\`
${correctedOldString}
\`\`\`

original_new_string (what was intended to replace original_old_string):
\`\`\`
${originalNewString}
\`\`\`

Task: Based on the differences between original_old_string and corrected_old_string, and the content of original_new_string, generate a corrected_new_string. This corrected_new_string should be what original_new_string would have been if it was designed to replace corrected_old_string directly, while maintaining the spirit of the original transformation.

For example, if original_old_string was "\\\\\\nconst greeting = \`Hello \\\\\`\${name}\\\\\`\`;" and corrected_old_string is "\nconst greeting = \`Hello ${'\\`'}\${name}${'\\`'}\`;", and original_new_string was "\\\\\\nconst greeting = \`Hello \\\\\`\${name} \${lastName}\\\\\`\`;", then corrected_new_string should likely be "\nconst greeting = \`Hello ${'\\`'}\${name} \${lastName}${'\\`'}\`;" to fix the incorrect escaping.
If the differences are only in whitespace or formatting, apply similar whitespace/formatting changes to the corrected_new_string.

Return ONLY the corrected string in the specified JSON format with the key 'corrected_new_string'. If no adjustment is deemed necessary or possible, return the original_new_string.
  `.trim();

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

  try {
    const result = await baseLlmClient.generateJson({
      contents,
      schema: NEW_STRING_CORRECTION_SCHEMA,
      abortSignal,
      model: EDIT_MODEL,
      config: EDIT_CONFIG,
      systemInstruction: CODE_CORRECTION_SYSTEM_PROMPT,
      promptId: getPromptId(),
    });

    if (
      result &&
      typeof result['corrected_new_string'] === 'string' &&
      result['corrected_new_string'].length > 0
    ) {
      return result['corrected_new_string'];
    } else {
      return originalNewString;
    }
  } catch (error) {
    if (abortSignal.aborted) {
      throw error;
    }

    console.error('Error during LLM call for new_string correction:', error);
    return originalNewString;
  }
}

const CORRECT_NEW_STRING_ESCAPING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    corrected_new_string_escaping: {
      type: 'string',
      description:
        'The new_string with corrected escaping, ensuring it is a proper replacement for the old_string, especially considering potential over-escaping issues from previous LLM generations.',
    },
  },
  required: ['corrected_new_string_escaping'],
};

export async function correctNewStringEscaping(
  baseLlmClient: BaseLlmClient,
  oldString: string,
  potentiallyProblematicNewString: string,
  abortSignal: AbortSignal,
): Promise<string> {
  const prompt = `
Context: A text replacement operation is planned. The text to be replaced (old_string) has been correctly identified in the file. However, the replacement text (new_string) might have been improperly escaped by a previous LLM generation (e.g. too many backslashes for newlines like \\n instead of \n, or unnecessarily quotes like \\"Hello\\" instead of "Hello").

old_string (this is the exact text that will be replaced):
\`\`\`
${oldString}
\`\`\`

potentially_problematic_new_string (this is the text that should replace old_string, but MIGHT have bad escaping, or might be entirely correct):
\`\`\`
${potentiallyProblematicNewString}
\`\`\`

Task: Analyze the potentially_problematic_new_string. If it's syntactically invalid due to incorrect escaping (e.g., "\n", "\t", "\\", "\\'", "\\""), correct the invalid syntax. The goal is to ensure the new_string, when inserted into the code, will be a valid and correctly interpreted.

For example, if old_string is "foo" and potentially_problematic_new_string is "bar\\nbaz", the corrected_new_string_escaping should be "bar\nbaz".
If potentially_problematic_new_string is console.log(\\"Hello World\\"), it should be console.log("Hello World").

Return ONLY the corrected string in the specified JSON format with the key 'corrected_new_string_escaping'. If no escaping correction is needed, return the original potentially_problematic_new_string.
  `.trim();

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

  try {
    const result = await baseLlmClient.generateJson({
      contents,
      schema: CORRECT_NEW_STRING_ESCAPING_SCHEMA,
      abortSignal,
      model: EDIT_MODEL,
      config: EDIT_CONFIG,
      systemInstruction: CODE_CORRECTION_SYSTEM_PROMPT,
      promptId: getPromptId(),
    });

    if (
      result &&
      typeof result['corrected_new_string_escaping'] === 'string' &&
      result['corrected_new_string_escaping'].length > 0
    ) {
      return result['corrected_new_string_escaping'];
    } else {
      return potentiallyProblematicNewString;
    }
  } catch (error) {
    if (abortSignal.aborted) {
      throw error;
    }

    console.error(
      'Error during LLM call for new_string escaping correction:',
      error,
    );
    return potentiallyProblematicNewString;
  }
}

const CORRECT_STRING_ESCAPING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    corrected_string_escaping: {
      type: 'string',
      description:
        'The string with corrected escaping, ensuring it is valid, specially considering potential over-escaping issues from previous LLM generations.',
    },
  },
  required: ['corrected_string_escaping'],
};

export async function correctStringEscaping(
  potentiallyProblematicString: string,
  baseLlmClient: BaseLlmClient,
  abortSignal: AbortSignal,
): Promise<string> {
  const prompt = `
Context: An LLM has just generated potentially_problematic_string and the text might have been improperly escaped (e.g. too many backslashes for newlines like \\n instead of \n, or unnecessarily quotes like \\"Hello\\" instead of "Hello").

potentially_problematic_string (this text MIGHT have bad escaping, or might be entirely correct):
\`\`\`
${potentiallyProblematicString}
\`\`\`

Task: Analyze the potentially_problematic_string. If it's syntactically invalid due to incorrect escaping (e.g., "\n", "\t", "\\", "\\'", "\\""), correct the invalid syntax. The goal is to ensure the text will be a valid and correctly interpreted.

For example, if potentially_problematic_string is "bar\\nbaz", the corrected_new_string_escaping should be "bar\nbaz".
If potentially_problematic_string is console.log(\\"Hello World\\"), it should be console.log("Hello World").

Return ONLY the corrected string in the specified JSON format with the key 'corrected_string_escaping'. If no escaping correction is needed, return the original potentially_problematic_string.
  `.trim();

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

  try {
    const result = await baseLlmClient.generateJson({
      contents,
      schema: CORRECT_STRING_ESCAPING_SCHEMA,
      abortSignal,
      model: EDIT_MODEL,
      config: EDIT_CONFIG,
      systemInstruction: CODE_CORRECTION_SYSTEM_PROMPT,
      promptId: getPromptId(),
    });

    if (
      result &&
      typeof result['corrected_string_escaping'] === 'string' &&
      result['corrected_string_escaping'].length > 0
    ) {
      return result['corrected_string_escaping'];
    } else {
      return potentiallyProblematicString;
    }
  } catch (error) {
    if (abortSignal.aborted) {
      throw error;
    }

    console.error(
      'Error during LLM call for string escaping correction:',
      error,
    );
    return potentiallyProblematicString;
  }
}

function trimPairIfPossible(
  target: string,
  trimIfTargetTrims: string,
  currentContent: string,
  expectedReplacements: number,
) {
  const trimmedTargetString = target.trim();
  if (target.length !== trimmedTargetString.length) {
    const trimmedTargetOccurrences = countOccurrences(
      currentContent,
      trimmedTargetString,
    );

    if (trimmedTargetOccurrences === expectedReplacements) {
      const trimmedReactiveString = trimIfTargetTrims.trim();
      return {
        targetString: trimmedTargetString,
        pair: trimmedReactiveString,
      };
    }
  }

  return {
    targetString: target,
    pair: trimIfTargetTrims,
  };
}

/**
 * Unescapes a string that might have been overly escaped by an LLM.
 */
export function unescapeStringForGeminiBug(inputString: string): string {
  // Regex explanation:
  // \\ : Matches exactly one literal backslash character.
  // (n|t|r|'|"|`|\\|\n) : This is a capturing group. It matches one of the following:
  //   n, t, r, ', ", ` : These match the literal characters 'n', 't', 'r', single quote, double quote, or backtick.
  //                       This handles cases like "\\n", "\\`", etc.
  //   \\ : This matches a literal backslash. This handles cases like "\\\\" (escaped backslash).
  //   \n : This matches an actual newline character. This handles cases where the input
  //        string might have something like "\\\n" (a literal backslash followed by a newline).
  // g : Global flag, to replace all occurrences.

  return inputString.replace(
    /\\+(n|t|r|'|"|`|\\|\n)/g,
    (match, capturedChar) => {
      // 'match' is the entire erroneous sequence, e.g., if the input (in memory) was "\\\\`", match is "\\\\`".
      // 'capturedChar' is the character that determines the true meaning, e.g., '`'.

      switch (capturedChar) {
        case 'n':
          return '\n'; // Correctly escaped: \n (newline character)
        case 't':
          return '\t'; // Correctly escaped: \t (tab character)
        case 'r':
          return '\r'; // Correctly escaped: \r (carriage return character)
        case "'":
          return "'"; // Correctly escaped: ' (apostrophe character)
        case '"':
          return '"'; // Correctly escaped: " (quotation mark character)
        case '`':
          return '`'; // Correctly escaped: ` (backtick character)
        case '\\': // This handles when 'capturedChar' is a literal backslash
          return '\\'; // Replace escaped backslash (e.g., "\\\\") with single backslash
        case '\n': // This handles when 'capturedChar' is an actual newline
          return '\n'; // Replace the whole erroneous sequence (e.g., "\\\n" in memory) with a clean newline
        default:
          // This fallback should ideally not be reached if the regex captures correctly.
          // It would return the original matched sequence if an unexpected character was captured.
          return match;
      }
    },
  );
}

/**
 * Counts occurrences of a substring in a string
 */
export function countOccurrences(str: string, substr: string): number {
  if (substr === '') {
    return 0;
  }
  let count = 0;
  let pos = str.indexOf(substr);
  while (pos !== -1) {
    count++;
    pos = str.indexOf(substr, pos + substr.length); // Start search after the current match
  }
  return count;
}

export function resetEditCorrectorCaches_TEST_ONLY() {
  editCorrectionCache.clear();
  fileContentCorrectionCache.clear();
}
