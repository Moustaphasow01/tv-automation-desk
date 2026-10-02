// Read the installed study's native renderer, not CSS titles or a guessed dashboard size.
export function panelProofScript(viewId) {
  return `var i=s.paneIndex(),panes=c.getPanes(),p=panes[i],w=c._chartWidget._paneWidgets.value()[i];
    var t=oosTables(),rect=w?.getElement().getBoundingClientRect(),canvas=w?.getElement().querySelector('canvas');
    if(!p||!rect||!canvas)return {smc398_found:true,pane_count:panes.length,pane_index:i,
      dedicated_panel:false,maximized:false,native_table:false,complete_table:false,table_contained_in_pane:false,
      clipped_cells:null,rendered_tables:[],rows:t.map(x=>x.rows),columns:t.map(x=>x.columns),bounds:null,
      view:s.getInputValues().find(x=>x.id===${JSON.stringify(viewId)})?.value,title:null,
      loading:s.isLoading(),engine_error:s.hasError(),minimum_font_size:null};
    var cr=canvas?.getBoundingClientRect(),sx=canvas?.width/cr?.width,sy=canvas?.height/cr?.height;
    var rendered=s._study._paneViews.filter(v=>Array.isArray(v._renderers)).flatMap(v=>v._renderers)
      .filter(r=>r._data?.table).map(r=>{var d=r._data,q=r._precalculated;
        if(!q&&typeof r._precalculateData==='function')q=r._precalculateData({
          mediaSize:{width:cr.width,height:cr.height},bitmapSize:{width:canvas.width,height:canvas.height},
          horizontalPixelRatio:sx,verticalPixelRatio:sy});
        if(!q||!cr)return {id:d.table.id,complete:false};
        var clipped=d.cells.filter(v=>!v.merged&&v.cell.text).map(v=>{
          var width=r._cellWidth({mediaSize:{width:cr.width}},{...v,cell:{...v.cell,widthInPercentsOfPaneWidth:null}},d),
            allocated=q.cells[v.cell.row]?.[v.cell.column]?.width/sx;
          return {row:v.cell.row,column:v.cell.column,required_width:width,allocated_width:allocated};
        }).filter(v=>!Number.isFinite(v.allocated_width)||v.required_width>v.allocated_width+1);
        var b={x:cr.x+(q.position.x-2)/sx,y:cr.y+(q.position.y-2)/sy,width:(q.totalWidth+4)/sx,height:(q.totalHeight+4)/sy};
        var contained=!!rect&&b.x>=rect.x&&b.y>=rect.y&&b.x+b.width<=rect.x+rect.width&&b.y+b.height<=rect.y+rect.height;
        return {id:d.table.id,rows:q.cells.length,columns:q.cells[0]?.length,clipped_cells:clipped.length,
          clipped_cell_details:clipped,width:q.totalWidth/sx,height:q.totalHeight/sy,content_bounds:b,
          contained_in_pane:contained,complete:contained&&clipped.length===0};});
    var native=!s._study.tables().hasExternalViews().value()&&t.length>0&&t.every(table=>
      rendered.some(r=>r.id===table.id&&r.rows===table.rows&&r.columns===table.columns));
    var cells=t.flatMap(x=>x.cells),title=cells.some(v=>v.text==='AUDIT FIN SESSION')?'AUDIT FIN SESSION':null;
    return {smc398_found:true,pane_count:panes.length,pane_index:i,dedicated_panel:i>0&&!!p&&!p.hasMainSeries(),
      maximized:!!p&&p.isMaximized(),view:s.getInputValues().find(x=>x.id===${JSON.stringify(viewId)})?.value,title,
      rows:t.map(x=>x.rows),columns:t.map(x=>x.columns),native_table:native,rendered_tables:rendered,
      expected_tables:t.map(x=>({id:x.id,rows:x.rows,columns:x.columns})),
      clipped_cells:rendered.reduce((n,r)=>n+(r.clipped_cells||0),0),
      table_contained_in_pane:rendered.length>0&&rendered.every(r=>r.contained_in_pane===true),
      complete_table:native&&rendered.every(r=>r.complete),loading:s.isLoading(),engine_error:s.hasError(),
      bounds:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,
      minimum_font_size:Math.min(...cells.filter(c=>c.text).map(c=>c.fontSize))};`;
}

export function panelFailureReasons(panel, view) {
  const p = panel || {};
  const checks = [
    [!p.dedicated_panel || !p.maximized, "DISTINCT_MAXIMIZED_PANE_UNPROVEN"],
    [!p.native_table, "NATIVE_ENGINE_TABLE_UNPROVEN"],
    [!p.table_contained_in_pane, "TABLE_OUTSIDE_PANE"],
    [p.clipped_cells !== 0, "CLIPPED_CELLS"],
    [!p.complete_table, "INCOMPLETE_TABLE"],
    [!(p.minimum_font_size >= 12), "TEXT_UNREADABLE"],
    [p.loading || p.engine_error, "ENGINE_NOT_READY"],
    [view === "AUDIT" && (p.view !== "AUTO" || p.title !== "AUDIT FIN SESSION"), "FINAL_AUDIT_VIEW_UNPROVEN"],
    [view === "POSITIONS" && p.view !== "POSITIONS", "POSITIONS_VIEW_UNPROVEN"]
  ];
  return checks.filter(([failed]) => failed).map(([, reason]) => reason);
}

export function panelCaptureGeometry(panel, layout) {
  const factor = layout.cssVisualViewport.zoom;
  const scale = layout.layoutViewport.clientWidth / layout.cssLayoutViewport.clientWidth / factor;
  if (!Number.isFinite(scale) || factor <= 0 || panel.minimum_font_size * factor * scale < 12) {
    throw Object.assign(new Error("TV_CAPTURE_SCALE_UNPROVEN"), { code: "TV_CAPTURE_SCALE_UNPROVEN" });
  }
  const tables = panel.rendered_tables.map(t => t.content_bounds);
  const x = Math.min(...tables.map(t => t.x)), y = Math.min(...tables.map(t => t.y));
  const bounds = { x, y, width: Math.max(...tables.map(t => t.x + t.width)) - x,
    height: Math.max(...tables.map(t => t.y + t.height)) - y };
  return { factor, scale, clip: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, value * factor])) };
}
