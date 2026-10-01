/** Read only installed ENGINE metadata/inputs. No Pine editor, plan, prices, logs or results. */
export async function readOosInstalledEngine(capture) {
  await capture.assertChart();
  return capture.evaluate(`(function(){var c=window.TradingViewApi._activeChartWidgetWV.value();
    var x=c.getAllStudies().find(x=>x.name==='SMC PRO 3.9.8 — Audit');
    if(!x)throw Error('ENGINE_MISSING');var s=c.getStudyById(x.id),m=s._study.metaInfo();
    var info=s.getInputsInfo().filter(x=>/^in_[0-9]+$/.test(x.id));
    return {name:x.name,pine:{digest:m.pine?.digest,version:m.pine?.version},
      inputs:info.map(x=>({id:x.id,name:x.name})),values:s.getInputValues().filter(x=>/^in_[0-9]+$/.test(x.id)&&
        info.find(i=>i.id===x.id)?.name!=='COLLER LE PLAN COMPACT ICI')};})()`);
}
