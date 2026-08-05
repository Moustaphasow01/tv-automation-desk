import { deskDetailScope, useMasterDetail } from "@/hooks/useDesk";
import { MasterTab } from "@/screens/live/tabs/MasterTab";
import type { DeskSession } from "@/types";

export function MasterTabContainer({ data: initialData }: { data: DeskSession }) {
  const query = useMasterDetail(initialData.master.id, deskDetailScope(initialData));
  const data = { ...initialData, master: query.data?.master || initialData.master };
  return <MasterTab data={data}/>;
}
