import { jsx as _jsx } from "react/jsx-runtime";
import { ToolMessage } from './ToolMessage.js';
import { StreamingState, ToolCallStatus } from '../../types.js';
import { StreamingContext } from '../../contexts/StreamingContext.js';
import { renderWithProviders } from '../../../test-utils/render.js';
describe('<ToolMessage /> - Raw Markdown Display Snapshots', () => {
    const baseProps = {
        callId: 'tool-123',
        name: 'test-tool',
        description: 'A tool for testing',
        resultDisplay: 'Test **bold** and `code` markdown',
        status: ToolCallStatus.Success,
        terminalWidth: 80,
        confirmationDetails: undefined,
        emphasis: 'medium',
    };
    it.each([
        { renderMarkdown: true, description: '(default)' },
        {
            renderMarkdown: false,
            description: '(raw markdown with syntax highlighting, no line numbers)',
        },
    ])('renders with renderMarkdown=$renderMarkdown $description', ({ renderMarkdown }) => {
        const { lastFrame } = renderWithProviders(_jsx(StreamingContext.Provider, { value: StreamingState.Idle, children: _jsx(ToolMessage, { ...baseProps }) }), {
            uiState: { renderMarkdown, streamingState: StreamingState.Idle },
        });
        expect(lastFrame()).toMatchSnapshot();
    });
});
//# sourceMappingURL=ToolMessageRawMarkdown.test.js.map