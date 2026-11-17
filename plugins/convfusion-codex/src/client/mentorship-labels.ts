import type { MentorshipDirection, ProposalRole } from './mentorship-view.js'

export interface ProgressProposalLike {
  status: string
  direction: MentorshipDirection
  /** 非 owner 侧的文件数；缺失或 null 表示未知。 */
  reviewFiles?: number | null
  /** owner 侧最后一次上传的时间。 */
  workspaceUpdatedAt?: string | null
  createdAt?: string | null
}

export interface ProgressViewerLike {
  myRole: ProposalRole
}

/**
 * 导师出题时，只有晚于提案创建的 owner 侧上传才算指导进展。
 * 初次发布早于提案；缺失或无法解析的时间也不能视为已上传。
 */
function mentorUploadedAfterProposal({ workspaceUpdatedAt, createdAt }: ProgressProposalLike): boolean {
  if (typeof workspaceUpdatedAt !== 'string' || typeof createdAt !== 'string') return false
  return Date.parse(workspaceUpdatedAt) > Date.parse(createdAt)
}

/** 关系建立后显示交付进展，其他阶段由调用方显示提案状态。 */
export function acceptedProgressKey(
  proposal: ProgressProposalLike,
  viewer: ProgressViewerLike,
): string | null {
  if (proposal.status !== 'ACCEPTED') return null
  const prefix = 'community.mentor.progress.'
  const nonOwnerDelivered = typeof proposal.reviewFiles === 'number' && proposal.reviewFiles > 0
  const seekingMentor = proposal.direction === 'SEEK_MENTOR'

  if (viewer.myRole === 'mentor') {
    // 两个方向都显示导师自己的进展；导师出题时，reviewFiles 数的是学生的交付。
    const guided = seekingMentor ? nonOwnerDelivered : mentorUploadedAfterProposal(proposal)
    return prefix + (guided ? 'iGuided' : 'iToGuide')
  }

  return prefix + (seekingMentor
    ? (nonOwnerDelivered ? 'mentorGuided' : 'awaitingMentor')
    : (nonOwnerDelivered ? 'iDelivered' : 'iToDeliver'))
}
