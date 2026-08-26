export const signalLabelFromActionClass=actionClass=>actionClass==='action_now'?'Action now':actionClass==='emerging_quick_turn'?'Emerging':'Watch';
export const signalKindFromActionClass=actionClass=>actionClass==='action_now'?'action':actionClass==='emerging_quick_turn'?'emerging':'watch';
export const signalKindFromIntelStage=stage=>stage==='leading'?'emerging':stage==='confirming'?'confirming':'watch';
export const signalKindLabel=kind=>kind==='action'?'Action now':kind==='emerging'?'Emerging':kind==='confirming'?'Confirming':'Watch';
export const SIGNAL_KIND_RANK={action:4,emerging:3,confirming:2,watch:1};
export const SIGNAL_SCAN_STAGES=[['all','All'],['action','Action'],['emerging','Emerging'],['confirming','Confirming'],['watch','Watch']];
