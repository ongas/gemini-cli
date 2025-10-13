/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Parses an error object to check if it's a structured Google API error
 * and extracts all details.
 *
 * This function can handle two formats:
 * 1. Standard Google API errors where `details` is a top-level field.
 * 2. Errors where the entire structured error object is stringified inside
 *    the `message` field of a wrapper error.
 *
 * @param error The error object to inspect.
 * @returns A GoogleApiError object if the error matches, otherwise null.
 */
export function parseGoogleApiError(error) {
    if (!error) {
        return null;
    }
    let errorObj = error;
    // If error is a string, try to parse it.
    if (typeof errorObj === 'string') {
        try {
            errorObj = JSON.parse(errorObj);
        }
        catch (_) {
            // Not a JSON string, can't parse.
            return null;
        }
    }
    if (typeof errorObj !== 'object' || errorObj === null) {
        return null;
    }
    const gaxiosError = errorObj;
    let outerError;
    if (gaxiosError.response?.data) {
        if (typeof gaxiosError.response.data === 'string') {
            try {
                const parsedData = JSON.parse(gaxiosError.response.data);
                // Handle case where data is an array like [{ error: {...} }]
                if (Array.isArray(parsedData) &&
                    parsedData.length > 0 &&
                    parsedData[0].error) {
                    outerError = parsedData[0].error;
                }
                else if (parsedData.error) {
                    outerError = parsedData.error;
                }
            }
            catch (_) {
                // Not a JSON string, or doesn't contain .error
            }
        }
        else if (typeof gaxiosError.response.data === 'object' &&
            gaxiosError.response.data !== null) {
            outerError = gaxiosError.response.data.error;
        }
    }
    const responseStatus = gaxiosError.response?.status;
    if (!outerError) {
        // If the gaxios structure isn't there, check for a top-level `error` property.
        if (gaxiosError.error) {
            outerError = gaxiosError.error;
        }
        else {
            return null;
        }
    }
    let currentError = outerError;
    let depth = 0;
    const maxDepth = 10;
    // Handle cases where the actual error object is stringified inside the message
    // by drilling down until we find an error that doesn't have a stringified message.
    while (typeof currentError.message === 'string' && depth < maxDepth) {
        try {
            const parsedMessage = JSON.parse(currentError.message);
            if (parsedMessage.error) {
                currentError = parsedMessage.error;
                depth++;
            }
            else {
                // The message is a JSON string, but not a nested error object.
                break;
            }
        }
        catch (_) {
            // It wasn't a JSON string, so we've drilled down as far as we can.
            break;
        }
    }
    const code = responseStatus ?? currentError.code ?? gaxiosError.code;
    const message = currentError.message;
    const errorDetails = currentError.details;
    if (Array.isArray(errorDetails) && code && message) {
        const details = [];
        for (const detail of errorDetails) {
            if (detail && typeof detail === 'object' && '@type' in detail) {
                // We can just cast it; the consumer will have to switch on @type
                details.push(detail);
            }
        }
        if (details.length > 0) {
            return {
                code,
                message,
                details,
            };
        }
    }
    return null;
}
//# sourceMappingURL=googleErrors.js.map