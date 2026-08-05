import { PositionCard, SetupCard } from "@/components/deskCards";
import { OperatorCommandPanel } from "@/components/OperatorCommandPanel";
import { deskDetailScope, useSetupDetail } from "@/hooks/useDesk";
import type { DeskSession } from "@/types";

export function SetupExecutionContainer({ data: initialData }: { data: DeskSession }) {
  const query = useSetupDetail(initialData.setup.id, deskDetailScope(initialData));
  const data = {
    ...initialData,
    setup: query.data?.setup || initialData.setup,
    levels: query.data?.levels || initialData.levels
  };
  return <>
    <div className="setup-control-grid">
      <SetupCard data={data}/>
      <section id="position"><PositionCard data={data}/></section>
    </div>
    <OperatorCommandPanel data={data}/>
  </>;
}
