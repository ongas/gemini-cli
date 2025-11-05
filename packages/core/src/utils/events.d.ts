/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
/**
 * Defines the severity level for user-facing feedback.
 * This maps loosely to UI `MessageType`
 */
export type FeedbackSeverity = 'info' | 'warning' | 'error';
/**
 * Payload for the 'user-feedback' event.
 */
export interface UserFeedbackPayload {
    /**
     * The severity level determines how the message is rendered in the UI
     * (e.g. colored text, specific icon).
     */
    severity: FeedbackSeverity;
    /**
     * The main message to display to the user in the chat history or stdout.
     */
    message: string;
    /**
     * The original error object, if applicable.
     * Listeners can use this to extract stack traces for debug logging
     * or verbose output, while keeping the 'message' field clean for end users.
     */
    error?: unknown;
}
export declare enum CoreEvent {
    UserFeedback = "user-feedback"
}
export declare class CoreEventEmitter extends EventEmitter {
    private _feedbackBacklog;
    private static readonly MAX_BACKLOG_SIZE;
    constructor();
    /**
     * Sends actionable feedback to the user.
     * Buffers automatically if the UI hasn't subscribed yet.
     */
    emitFeedback(severity: FeedbackSeverity, message: string, error?: unknown): void;
    /**
     * Flushes buffered messages. Call this immediately after primary UI listener
     * subscribes.
     */
    drainFeedbackBacklog(): void;
    on(event: CoreEvent.UserFeedback, listener: (payload: UserFeedbackPayload) => void): this;
    off(event: CoreEvent.UserFeedback, listener: (payload: UserFeedbackPayload) => void): this;
    emit(event: CoreEvent.UserFeedback, payload: UserFeedbackPayload): boolean;
}
export declare const coreEvents: CoreEventEmitter;
