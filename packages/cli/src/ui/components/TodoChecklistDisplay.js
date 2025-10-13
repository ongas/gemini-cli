import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
const TodoItemDisplay = ({ item, level = 0, }) => {
    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed':
                return '✓';
            case 'in_progress':
                return '⋯';
            case 'pending':
                return '○';
        }
    };
    const getStatusColor = (status) => {
        switch (status) {
            case 'completed':
                return theme.status.success;
            case 'in_progress':
                return theme.text.accent;
            case 'pending':
                return theme.text.secondary;
        }
    };
    const indent = '  '.repeat(level);
    const displayText = item.status === 'in_progress' ? item.activeForm : item.content;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { children: _jsxs(Text, { color: getStatusColor(item.status), children: [indent, getStatusIcon(item.status), " ", displayText] }) }), item.subtasks &&
                item.subtasks.map((subtask) => (_jsx(TodoItemDisplay, { item: subtask, level: level + 1 }, subtask.id)))] }));
};
export const TodoChecklistDisplay = ({ checklist, }) => {
    if (!checklist || checklist.todos.length === 0) {
        return null;
    }
    return (_jsxs(Box, { paddingLeft: 0, paddingY: 1, flexDirection: "column", children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: theme.text.primary, bold: true, children: "Tasks:" }) }), checklist.todos.map((todo) => (_jsx(TodoItemDisplay, { item: todo }, todo.id)))] }));
};
//# sourceMappingURL=TodoChecklistDisplay.js.map