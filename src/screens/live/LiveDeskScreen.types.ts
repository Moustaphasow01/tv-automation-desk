import type { ReactNode } from "react";
import type { DeskSession, TimelineEvent } from "@/types";

export interface LiveTabDefinition {
  id: string;
  label: string;
}

export interface LiveDeskScreenActions {
  openJournal: () => void;
  openSetup: () => void;
  openThesis: () => void;
  openAudit: () => void;
  openTimelineEvent: (event: TimelineEvent) => void;
  onChangeTab: (tabId: string) => void;
}

export interface LiveDeskScreenProps {
  data: DeskSession;
  phaseLabel: string;
  refreshing: boolean;
  dataUpdatedAt: number;
  onRefresh: () => void;
  actions: LiveDeskScreenActions;
  tabs: LiveTabDefinition[];
  activeTab: string;
  activeTabContent: ReactNode;
  executionContent: ReactNode;
}
