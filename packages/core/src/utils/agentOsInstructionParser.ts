/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parses Agent OS instructions and converts Claude Code-specific syntax
 * to Gemini CLI-compatible syntax.
 *
 * This parser handles:
 * - <step subagent="..."> directives
 * - Claude Code Task tool references
 * - Agent invocation syntax differences
 */

/**
 * Converts Agent OS instructions from Claude Code format to Gemini format.
 *
 * Key transformations:
 * 1. <step subagent="agent-name"> -> Instructions to use the agent_name tool
 * 2. "Use the X subagent" -> "Use the x tool to invoke the X subagent"
 * 3. Claude-specific directives -> Gemini tool call patterns
 *
 * @param content The original instruction content
 * @returns Transformed content compatible with Gemini CLI
 */
export function convertAgentOsInstructions(content: string): string {
  let converted = content;

  // Pattern 1: Convert <step subagent="agent-name"> attributes
  // Example: <step number="2" subagent="context-fetcher" name="context_analysis">
  // The subagent name is converted to snake_case for the tool name
  converted = converted.replace(
    /<step([^>]*?)subagent="([^"]+)"([^>]*?)>/g,
    (match, before, agentName, after) => {
      const toolName = agentName.replace(/-/g, '_');
      // Keep the original step tag but add a comment about the tool
      return `<step${before}${after}>\n<!-- Gemini: Use the ${toolName} tool to invoke this subagent -->`;
    },
  );

  // Pattern 2: Convert "Use the X subagent" instructions - IMPERATIVE
  // Example: "Use the context-fetcher subagent to gather..."
  // -> "You MUST call the context_fetcher tool. Use it to gather..."
  converted = converted.replace(
    /Use the ([a-z-]+) subagent\s+to\s+/gi,
    (match, agentName) => {
      const toolName = agentName.replace(/-/g, '_');
      return `You MUST call the ${toolName} tool. Use it to `;
    },
  );

  // Pattern 2b: Handle "Use the X subagent" without "to"
  converted = converted.replace(
    /Use the ([a-z-]+) subagent(?!\s+to)/gi,
    (match, agentName) => {
      const toolName = agentName.replace(/-/g, '_');
      return `You MUST call the ${toolName} tool`;
    },
  );

  // Pattern 3: Convert ACTION/REQUEST directives for subagents - IMPERATIVE
  // Example: "ACTION: Use context-fetcher subagent to:"
  // -> "ACTION: You MUST call the context_fetcher tool to:"
  converted = converted.replace(
    /ACTION:\s*Use\s+([a-z-]+)\s+subagent/gi,
    (match, agentName) => {
      const toolName = agentName.replace(/-/g, '_');
      return `ACTION: You MUST call the ${toolName} tool`;
    },
  );

  // Pattern 4: Add Gemini-specific guidance at the beginning if subagents are mentioned
  if (converted.includes('subagent') || converted.includes('<!-- Gemini:')) {
    const geminiGuidance = `
## CRITICAL INSTRUCTIONS FOR GEMINI

**TOOL INVOCATION REQUIREMENTS:**
When these instructions say "You MUST call the [tool_name] tool", this is a REQUIRED action, not optional.
You must invoke the specified tool using the function calling mechanism.

**Subagent Tools Available:**
Each "subagent" mentioned in this workflow is a real tool you can call:
- **context_fetcher**: Retrieves documentation and context files
- **file_creator**: Creates files and directories with proper templates
- **git_workflow**: Manages git branches, commits, and operations
- **test_runner**: Executes tests and reports results
- **date_checker**: Validates and formats dates
- **project_manager**: Manages project tasks and updates

**How to use subagent tools:**
1. When you see "You MUST call the X tool", invoke that tool immediately
2. Pass the 'task' parameter with the specific request
3. Wait for the tool's response before continuing
4. Use the tool's output to proceed with the next step

**Example:**
If instructions say "You MUST call the context_fetcher tool to get the product pitch",
you should invoke: \`context_fetcher(task: "Get product pitch from mission-lite.md")\`

---

`;

    // Insert after the first heading or at the start
    const firstHeadingMatch = converted.match(/^#[^#]/m);
    if (firstHeadingMatch && firstHeadingMatch.index !== undefined) {
      const insertPos = converted.indexOf('\n', firstHeadingMatch.index) + 1;
      converted =
        converted.slice(0, insertPos) +
        '\n' +
        geminiGuidance +
        converted.slice(insertPos);
    } else {
      converted = geminiGuidance + converted;
    }
  }

  return converted;
}

/**
 * Checks if content appears to contain Agent OS instructions
 * that need conversion.
 *
 * @param content The content to check
 * @returns true if conversion is likely needed
 */
export function needsAgentOsConversion(content: string): boolean {
  return (
    content.includes('subagent') ||
    content.includes('<step') ||
    content.includes('@.agent-os/') ||
    content.includes('@.project-standards/')
  );
}

/**
 * Converts content from a file if it appears to be Agent OS instructions.
 * Otherwise returns content unchanged.
 *
 * @param content The file content
 * @param filePath The path to the file (for context)
 * @returns Converted or original content
 */
export function maybeConvertAgentOsInstructions(
  content: string,
  filePath: string,
): string {
  // Only convert files that appear to be in the .agent-os or .project-standards directory
  // or contain Agent OS syntax (backward compatibility for .agent-os)
  const isAgentOsFile =
    filePath.includes('.agent-os/') ||
    filePath.includes('/.agent-os/') ||
    filePath.includes('.project-standards/') ||
    filePath.includes('/.project-standards/');

  if (isAgentOsFile && needsAgentOsConversion(content)) {
    return convertAgentOsInstructions(content);
  }

  return content;
}
