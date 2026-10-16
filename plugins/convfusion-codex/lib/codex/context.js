import { collectResearchContext, renderResearchContext, RESEARCH_GUIDE_TEXT } from '../research/context.js';
import { effectiveSkillContentById } from '../research/library.js';
import { researchWorkspaceOf } from '../research/workspace.js';
/** One context path for native hooks and explicit MCP refreshes, including effective methods. */
export function codexResearchContext(root, input, store) {
    const context = renderResearchContext(collectResearchContext({
        workspace: researchWorkspaceOf(root), sessionWorkspace: root, userInput: input,
        skillContent: (id) => effectiveSkillContentById(id, store),
    }), input);
    if (!context)
        return '';
    const guide = RESEARCH_GUIDE_TEXT.replace('read that skill file', 'load its effective content with `research_methods`');
    return `${guide}\n\n${context.replace('the native skill list', '`research_methods` (list or read an id; user customizations are included)')}`;
}
//# sourceMappingURL=context.js.map