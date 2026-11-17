import type { MentorshipDirection, ProposalRole } from './mentorship-view.js';
export interface ProgressProposalLike {
    status: string;
    direction: MentorshipDirection;
    /** 非 owner 侧的文件数；缺失或 null 表示未知。 */
    reviewFiles?: number | null;
    /** owner 侧最后一次上传的时间。 */
    workspaceUpdatedAt?: string | null;
    createdAt?: string | null;
}
export interface ProgressViewerLike {
    myRole: ProposalRole;
}
/** 关系建立后显示交付进展，其他阶段由调用方显示提案状态。 */
export declare function acceptedProgressKey(proposal: ProgressProposalLike, viewer: ProgressViewerLike): string | null;
