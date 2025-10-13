/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Python-aware indentation-flexible matching for the Edit tool.
 *
 * This module provides functionality to match code blocks in Python files
 * while being flexible about absolute indentation levels, but strict about
 * relative indentation (which is syntactically significant in Python).
 */

interface IndentPattern {
  content: string;
  relativeIndent: number;
}

interface MatchResult {
  startLine: number;
  endLine: number;
  fileIndent: number;
  adjustedNewString: string;
}

/**
 * Counts the number of leading spaces in a string.
 * Tabs are counted as 4 spaces (Python standard).
 */
function getLeadingSpaces(line: string): number {
  let spaces = 0;
  for (const char of line) {
    if (char === ' ') {
      spaces++;
    } else if (char === '\t') {
      spaces += 4; // Python standard: 1 tab = 4 spaces
    } else {
      break;
    }
  }
  return spaces;
}

/**
 * Analyzes the indentation pattern of a code block.
 * Returns the content and relative indentation of each line.
 */
function analyzeIndentationPattern(text: string): {
  baseIndent: number;
  pattern: IndentPattern[];
} {
  const lines = text.split('\n');

  // Find the base indentation (first non-empty line)
  let baseIndent = 0;
  for (const line of lines) {
    if (line.trim().length > 0) {
      baseIndent = getLeadingSpaces(line);
      break;
    }
  }

  // Build pattern with relative indentation
  const pattern: IndentPattern[] = lines.map((line) => {
    const lineIndent = line.trim().length > 0 ? getLeadingSpaces(line) : 0;
    return {
      content: line.trim(),
      relativeIndent: lineIndent - baseIndent,
    };
  });

  return { baseIndent, pattern };
}

/**
 * Checks if two patterns match (same content and relative indentation).
 */
function patternsMatch(
  pattern1: IndentPattern[],
  pattern2: IndentPattern[],
): boolean {
  if (pattern1.length !== pattern2.length) {
    return false;
  }

  for (let i = 0; i < pattern1.length; i++) {
    // Empty lines can have any indentation
    if (pattern1[i].content === '' && pattern2[i].content === '') {
      continue;
    }

    if (
      pattern1[i].content !== pattern2[i].content ||
      pattern1[i].relativeIndent !== pattern2[i].relativeIndent
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Adjusts the indentation of newString to match the file's indentation level.
 */
function adjustIndentation(
  newString: string,
  oldBaseIndent: number,
  fileBaseIndent: number,
): string {
  const lines = newString.split('\n');
  const indentDiff = fileBaseIndent - oldBaseIndent;

  return lines
    .map((line) => {
      if (line.trim().length === 0) {
        return ''; // Empty lines stay empty
      }

      const currentIndent = getLeadingSpaces(line);
      const newIndent = Math.max(0, currentIndent + indentDiff);
      const content = line.trimStart();

      return ' '.repeat(newIndent) + content;
    })
    .join('\n');
}

/**
 * Attempts to find a match for oldString in fileContent with flexible indentation.
 * If found, returns the match location and an adjusted newString with correct indentation.
 *
 * This is specifically designed for Python where relative indentation matters but
 * absolute indentation can vary.
 */
export function findPythonMatchWithFlexibleIndentation(
  fileContent: string,
  oldString: string,
  newString: string,
  debug = false,
): MatchResult | null {
  const fileLines = fileContent.split('\n');
  const { baseIndent: oldBaseIndent, pattern: oldPattern } =
    analyzeIndentationPattern(oldString);

  if (debug) {
    console.log(
      `[Python Matcher] Searching for pattern with ${oldPattern.length} lines`,
    );
    console.log(
      `[Python Matcher] old_string base indent: ${oldBaseIndent} spaces`,
    );
    console.log(
      `[Python Matcher] First line pattern: "${oldPattern[0].content}" (relative indent: ${oldPattern[0].relativeIndent})`,
    );
    if (oldPattern.length > 1) {
      console.log(
        `[Python Matcher] Last line pattern: "${oldPattern[oldPattern.length - 1].content}" (relative indent: ${oldPattern[oldPattern.length - 1].relativeIndent})`,
      );
    }
  }

  let bestPartialMatch = 0;
  let bestPartialMatchLine = -1;

  // Search through the file for a matching pattern
  for (let i = 0; i <= fileLines.length - oldPattern.length; i++) {
    const candidateLines = fileLines.slice(i, i + oldPattern.length);
    const candidateText = candidateLines.join('\n');

    const { baseIndent: candidateBaseIndent, pattern: candidatePattern } =
      analyzeIndentationPattern(candidateText);

    // Track best partial match for debugging
    if (debug) {
      let matchingLines = 0;
      for (let j = 0; j < Math.min(oldPattern.length, candidatePattern.length); j++) {
        if (
          oldPattern[j].content === candidatePattern[j].content &&
          oldPattern[j].relativeIndent === candidatePattern[j].relativeIndent
        ) {
          matchingLines++;
        } else {
          break;
        }
      }
      if (matchingLines > bestPartialMatch) {
        bestPartialMatch = matchingLines;
        bestPartialMatchLine = i;
      }
    }

    if (patternsMatch(oldPattern, candidatePattern)) {
      // Found a match! Adjust newString indentation to match the file
      const adjustedNewString = adjustIndentation(
        newString,
        oldBaseIndent,
        candidateBaseIndent,
      );

      if (debug) {
        console.log(
          `[Python Matcher] ✓ Found exact match at line ${i + 1} (file indent: ${candidateBaseIndent} spaces)`,
        );
      }

      return {
        startLine: i,
        endLine: i + oldPattern.length,
        fileIndent: candidateBaseIndent,
        adjustedNewString,
      };
    }
  }

  if (debug && bestPartialMatch > 0) {
    console.log(
      `[Python Matcher] Best partial match: ${bestPartialMatch}/${oldPattern.length} lines at line ${bestPartialMatchLine + 1}`,
    );
    // Show where the match diverged
    const candidateLines = fileLines.slice(
      bestPartialMatchLine,
      bestPartialMatchLine + oldPattern.length,
    );
    const candidateText = candidateLines.join('\n');
    const { pattern: candidatePattern } =
      analyzeIndentationPattern(candidateText);

    for (let j = 0; j < oldPattern.length; j++) {
      if (
        j >= candidatePattern.length ||
        oldPattern[j].content !== candidatePattern[j].content ||
        oldPattern[j].relativeIndent !== candidatePattern[j].relativeIndent
      ) {
        console.log(
          `[Python Matcher] Mismatch at line ${j + 1}:`,
        );
        console.log(
          `  Expected: "${oldPattern[j].content}" (rel indent: ${oldPattern[j].relativeIndent})`,
        );
        if (j < candidatePattern.length) {
          console.log(
            `  Got:      "${candidatePattern[j].content}" (rel indent: ${candidatePattern[j].relativeIndent})`,
          );
        } else {
          console.log(`  Got:      [end of candidate]`);
        }
        break;
      }
    }
  }

  return null;
}

/**
 * Checks if a file is likely a Python file based on its path.
 */
export function isPythonFile(filePath: string): boolean {
  return (
    filePath.endsWith('.py') ||
    filePath.endsWith('.pyw') ||
    filePath.endsWith('.pyi')
  );
}

/**
 * Applies the match result to get the actual old_string and new_string
 * that should be used for the replacement.
 */
export function applyPythonMatch(
  fileContent: string,
  matchResult: MatchResult,
): { actualOldString: string; actualNewString: string } {
  const fileLines = fileContent.split('\n');
  const actualOldString = fileLines
    .slice(matchResult.startLine, matchResult.endLine)
    .join('\n');

  return {
    actualOldString,
    actualNewString: matchResult.adjustedNewString,
  };
}
