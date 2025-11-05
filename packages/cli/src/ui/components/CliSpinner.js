import { jsx as _jsx } from "react/jsx-runtime";
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import Spinner from 'ink-spinner';
import { useEffect } from 'react';
// A top-level field to track the total number of active spinners.
export let debugNumSpinners = 0;
export const CliSpinner = (props) => {
    useEffect(() => {
        debugNumSpinners++;
        return () => {
            debugNumSpinners--;
        };
    }, []);
    return _jsx(Spinner, { ...props });
};
//# sourceMappingURL=CliSpinner.js.map