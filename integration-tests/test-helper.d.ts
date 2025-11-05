/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as pty from '@lydell/node-pty';
export declare function poll(predicate: () => boolean, timeout: number, interval: number): Promise<boolean>;
export declare function createToolCallErrorMessage(expectedTools: string | string[], foundTools: string[], result: string): string;
export declare function printDebugInfo(rig: TestRig, result: string, context?: Record<string, unknown>): {
    toolRequest: {
        name: string;
        args: string;
        success: boolean;
        duration_ms: number;
    };
}[];
export declare function validateModelOutput(result: string, expectedContent?: string | (string | RegExp)[] | null, testName?: string): boolean;
interface ParsedLog {
    attributes?: {
        'event.name'?: string;
        function_name?: string;
        function_args?: string;
        success?: boolean;
        duration_ms?: number;
        request_text?: string;
    };
    scopeMetrics?: {
        metrics: {
            descriptor: {
                name: string;
            };
        }[];
    }[];
}
export declare class InteractiveRun {
    ptyProcess: pty.IPty;
    output: string;
    constructor(ptyProcess: pty.IPty);
    expectText(text: string, timeout?: number): Promise<void>;
    type(text: string): Promise<void>;
    sendKeys(text: string): Promise<void>;
    kill(): Promise<void>;
    expectExit(): Promise<number>;
}
export declare class TestRig {
    bundlePath: string;
    testDir: string | null;
    testName?: string;
    _lastRunStdout?: string;
    fakeResponsesPath?: string;
    constructor();
    setup(testName: string, options?: {
        settings?: Record<string, unknown>;
        fakeResponsesPath?: string;
    }): void;
    createFile(fileName: string, content: string): string;
    mkdir(dir: string): void;
    sync(): void;
    /**
     * The command and args to use to invoke Gemini CLI. Allows us to switch
     * between using the bundled gemini.js (the default) and using the installed
     * 'gemini' (used to verify npm bundles).
     */
    private _getCommandAndArgs;
    run(promptOrOptions: string | {
        prompt?: string;
        stdin?: string;
        stdinDoesNotEnd?: boolean;
        yolo?: boolean;
    }, ...args: string[]): Promise<string>;
    runCommand(args: string[], options?: {
        stdin?: string;
    }): Promise<string>;
    readFile(fileName: string): string;
    cleanup(): Promise<void>;
    waitForTelemetryReady(): Promise<void>;
    waitForTelemetryEvent(eventName: string, timeout?: number): Promise<boolean>;
    waitForToolCall(toolName: string, timeout?: number, matchArgs?: (args: string) => boolean): Promise<boolean>;
    expectToolCallSuccess(toolNames: string[], timeout?: number, matchArgs?: (args: string) => boolean): Promise<void>;
    waitForAnyToolCall(toolNames: string[], timeout?: number): Promise<boolean>;
    _parseToolLogsFromStdout(stdout: string): {
        timestamp: number;
        toolRequest: {
            name: string;
            args: string;
            success: boolean;
            duration_ms: number;
        };
    }[];
    private _readAndParseTelemetryLog;
    readToolLogs(): {
        toolRequest: {
            name: string;
            args: string;
            success: boolean;
            duration_ms: number;
        };
    }[];
    readLastApiRequest(): ParsedLog | null;
    waitForMetric(metricName: string, timeout?: number): Promise<boolean>;
    readMetric(metricName: string): Record<string, unknown> | null;
    runInteractive(...args: string[]): Promise<InteractiveRun>;
}
export {};
