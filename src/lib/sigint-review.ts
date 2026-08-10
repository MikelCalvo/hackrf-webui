import type { SigintReviewPriority, SigintReviewStatus } from "@/lib/sigint";

export function priorityForReviewStatus(
  status: SigintReviewStatus,
  priority: SigintReviewPriority,
): SigintReviewPriority {
  return status === "discarded" ? "normal" : priority;
}