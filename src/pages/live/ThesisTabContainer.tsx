import { deskDetailScope, useThesisConditionsDetail, useThesisDetail } from "@/hooks/useDesk";
import { ThesisTab } from "@/screens/live/tabs/ThesisTab";
import type { DeskSession } from "@/types";

export function ThesisTabContainer({ data: initialData }: { data: DeskSession }) {
  const scope = deskDetailScope(initialData);
  const thesisQuery = useThesisDetail(initialData.thesis.id, scope);
  const conditionsQuery = useThesisConditionsDetail(initialData.thesis.id, scope);
  const data = {
    ...initialData,
    thesis: thesisQuery.data?.thesis || initialData.thesis,
    levels: thesisQuery.data?.levels || initialData.levels
  };
  return <ThesisTab
    data={data}
    conditions={{
      monitorId: conditionsQuery.data?.monitorId ?? undefined,
      go: conditionsQuery.data?.go || initialData.monitors.at(-1)?.goConditions || [],
      invalidations: conditionsQuery.data?.invalidations || initialData.monitors.at(-1)?.invalidationConditions || []
    }}
  />;
}
