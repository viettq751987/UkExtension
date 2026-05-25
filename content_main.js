// content_main.js - MAIN world, document_start
// Dùng MutationObserver watch twister init (giống CoTik)
(function() {
  'use strict';
  window.__ULO__ = { ready: false };

  function getTwister() {
    try {
      const tvm = window.twisterController?.twisterCore?.tvm;
      if (!tvm || !tvm.dimCombinations || !Object.keys(tvm.dimCombinations).length) return null;
      return {
        combos:  JSON.parse(JSON.stringify(tvm.dimCombinations)),
        valMap:  JSON.parse(JSON.stringify(tvm.dimtoValueMap  || {})),
        dimList: JSON.parse(JSON.stringify(tvm.dimensionList  || [])),
      };
    } catch(e) { return null; }
  }

  function getVariantCount() {
    const d = getTwister();
    return d ? Object.keys(d.combos).length : 0;
  }

  // Lắng nghe lệnh từ isolated world
  window.addEventListener('__ulo_cmd__', function(e) {
    const cmd = e.detail; if (!cmd?.id) return;
    let r = null;
    try {
      switch(cmd.action) {
        case 'GET_TWISTER': r = getTwister(); break;
        case 'GET_COUNT':   r = getVariantCount(); break;
        default:            r = {err:'unknown:'+cmd.action};
      }
    } catch(ex) { r = {err:ex.message}; }
    window.dispatchEvent(new CustomEvent('__ulo_cb__', {detail:{id:cmd.id,result:r}}));
  });

  window.__ULO__.getTwister      = getTwister;
  window.__ULO__.getVariantCount = getVariantCount;
  window.__ULO__.ready           = true;
  window.dispatchEvent(new CustomEvent('__ulo_ready__'));
})();
