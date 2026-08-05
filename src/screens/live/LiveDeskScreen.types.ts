import type { DeskSession, TimelineEvent } from "@/types";

export interface LiveDeskScreenActions {
  openJournal: () => void;
  openSetup: () => void;
  openThesis: () => void;
  openAudit: () => void;
  openNews: () => void;
  openTimelineEvent: (event: TimelineEvent) => void;
}

export interface LiveDeskScreenProps {
  data: DeskSession;
  phaseLabel: string;
  refreshing: boolean;
  dataUpdatedAt: number;
  onRefresh: () => void;
  actions: LiveDeskScreenActions;
}
