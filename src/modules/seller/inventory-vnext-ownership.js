function syncWorkspaceVisibility(){
  const host=document.getElementById('cxInventory');
  const workspace=document.getElementById('cxInventoryWorkspace');
  if(!host||!workspace)return;
  workspace.hidden=host.classList.contains('cx-iv-scan-mode');
}

document.addEventListener('collectish:inventory-workspace-rendered',syncWorkspaceVisibility);
document.addEventListener('collectish:inventory-modules-ready',()=>queueMicrotask(syncWorkspaceVisibility));
document.addEventListener('collectish:page-change',event=>{if(event.detail?.page==='inventory')setTimeout(syncWorkspaceVisibility,0)});
queueMicrotask(syncWorkspaceVisibility);

window.CollectishInventoryVnextOwnership={sync:syncWorkspaceVisibility};
