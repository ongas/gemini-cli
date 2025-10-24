/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { AuthType } from '../core/contentGenerator.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { logFlashFallback, FlashFallbackEvent } from '../telemetry/index.js';

export async function handleFallback(
  config: Config,
  failedModel: string,
  authType?: string,
  error?: unknown,
): Promise<string | boolean | null> {
  console.log('[FALLBACK DEBUG] handleFallback called', {
    failedModel,
    authType,
    isInFallbackMode: config.isInFallbackMode(),
  });

  // Applicability Checks
  if (authType !== AuthType.LOGIN_WITH_GOOGLE) {
    console.log('[FALLBACK DEBUG] Not OAuth user, returning null');
    return null;
  }

  const fallbackModel = DEFAULT_GEMINI_FLASH_MODEL;

  if (failedModel === fallbackModel) {
    console.log('[FALLBACK DEBUG] Already using fallback model, returning null');
    return null;
  }

  // Consult UI Handler for Intent
  const fallbackModelHandler = config.fallbackModelHandler;
  if (typeof fallbackModelHandler !== 'function') {
    console.log('[FALLBACK DEBUG] No fallback handler registered, returning null');
    return null;
  }

  try {
    console.log('[FALLBACK DEBUG] Calling fallbackModelHandler');
    // Pass the specific failed model to the UI handler.
    const intent = await fallbackModelHandler(
      failedModel,
      fallbackModel,
      error,
    );

    console.log('[FALLBACK DEBUG] Received intent:', intent);

    // Process Intent and Update State
    switch (intent) {
      case 'retry':
        console.log('[FALLBACK DEBUG] Activating fallback mode and returning true');
        // Activate fallback mode. The NEXT retry attempt will pick this up.
        activateFallbackMode(config, authType);
        return true; // Signal retryWithBackoff to continue.

      case 'stop':
        console.log('[FALLBACK DEBUG] Activating fallback mode and returning false');
        activateFallbackMode(config, authType);
        return false;

      case 'auth':
        console.log('[FALLBACK DEBUG] Auth intent, returning false');
        return false;

      default:
        throw new Error(
          `Unexpected fallback intent received from fallbackModelHandler: "${intent}"`,
        );
    }
  } catch (handlerError) {
    console.error('[FALLBACK DEBUG] Fallback UI handler failed:', handlerError);
    return null;
  }
}

function activateFallbackMode(config: Config, authType: string | undefined) {
  if (!config.isInFallbackMode()) {
    config.setFallbackMode(true);
    if (authType) {
      logFlashFallback(config, new FlashFallbackEvent(authType));
    }
  }
}
