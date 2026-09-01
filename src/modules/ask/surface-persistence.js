// Restore structured Ask surfaces from durable assistant-message metadata.
// This bridges saved conversation rows back into the same ordered surface queue
// used for live responses without coupling main.js to individual surface types.
(() => {
  if(window.__collectishAskSurfacePersistenceInstalled)return;
  window.__collectishAskSurfacePersistenceInstalled=true;
  window.__CollectishAskSurfaceQueue=window.__CollectishAskSurfaceQueue||[];
  const nativeRest=window.rest;
  if(typeof nativeRest!=='function')return;
  const isMessageHistory=path=>/^ask_collectish_messages\?/.test(String(path||''))&&/\bmetadata\b/.test(String(path||''));
  window.rest=async function(path,options){
    const result=await nativeRest(path,options);
    if(!isMessageHistory(path)||!Array.isArray(result))return result;
    // loadConversation renders only assistant bubbles through the structured-surface
    // listener. Queue one entry per assistant message, including empty placeholders,
    // so a later rich surface can never attach to an earlier plain-text answer.
    for(const row of result){
      if(String(row?.role||'')!=='assistant')continue;
      const metadata=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
      const surfaces=Array.isArray(metadata.surfaces)?metadata.surfaces:[];
      window.__CollectishAskSurfaceQueue.push({
        schema:String(metadata.surface_schema||''),
        surfaces,
        persisted:true,
        message_id:row?.id||null
      });
    }
    return result;
  };
})();
