import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box } from 'ink';
import { Notifications } from '../components/Notifications.js';
import { MainContent } from '../components/MainContent.js';
import { DialogManager } from '../components/DialogManager.js';
import { Composer } from '../components/Composer.js';
import { ExitWarning } from '../components/ExitWarning.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useFlickerDetector } from '../hooks/useFlickerDetector.js';
export const DefaultAppLayout = () => {
    const uiState = useUIState();
    const { rootUiRef, terminalHeight } = uiState;
    useFlickerDetector(rootUiRef, terminalHeight);
    return (_jsxs(Box, { flexDirection: "column", width: uiState.mainAreaWidth, ref: uiState.rootUiRef, children: [_jsx(MainContent, {}), _jsxs(Box, { flexDirection: "column", ref: uiState.mainControlsRef, children: [_jsx(Notifications, {}), uiState.dialogsVisible ? (_jsx(DialogManager, { terminalWidth: uiState.mainAreaWidth, addItem: uiState.historyManager.addItem })) : (_jsx(Composer, {})), _jsx(ExitWarning, {})] })] }));
};
//# sourceMappingURL=DefaultAppLayout.js.map