/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Session information for display and selection purposes.
 */
export interface SessionInfo {
    /** Unique session identifier (filename without .json) */
    id: string;
    /** Full filename including .json extension */
    fileName: string;
    /** ISO timestamp when session was last updated */
    lastUpdated: string;
    /** Whether this is the currently active session */
    isCurrentSession: boolean;
}
/**
 * Represents a session file, which may be valid or corrupted.
 */
export interface SessionFileEntry {
    /** Full filename including .json extension */
    fileName: string;
    /** Parsed session info if valid, null if corrupted */
    sessionInfo: SessionInfo | null;
}
/**
 * Loads all session files (including corrupted ones) from the chats directory.
 * @returns Array of session file entries, with sessionInfo null for corrupted files
 */
export declare const getAllSessionFiles: (chatsDir: string, currentSessionId?: string) => Promise<SessionFileEntry[]>;
/**
 * Loads all valid session files from the chats directory and converts them to SessionInfo.
 * Corrupted files are automatically filtered out.
 */
export declare const getSessionFiles: (chatsDir: string, currentSessionId?: string) => Promise<SessionInfo[]>;
