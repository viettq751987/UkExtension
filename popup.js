// popup.js - UK Listing Optimizer v1.0.3
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  tab: null,
  product: null,
  aiResult: null,
  imageFiles: [],
  zipBlob: null,
  updateResult: null,
  settings: {
    openrouterKey: '',
    defaultModel: 'deepseek/deepseek-chat',
    outputFolder: 'UKListing',
    exportMode: 'zip',
    updateCheckEnabled: true,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (...els) => els.forEach((el) => el?.classList.remove('hidden'));
const hide = (...els) => els.forEach((el) => el?.classList.add('hidden'));
const esc  = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function fmt(b) {
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b/1024).toFixed(1) + 'KB';
  return (b/1048576).toFixed(1) + 'MB';
}

function timeAgo(ts) {
  const m = Math.floor((Date.now()-ts)/60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return m + ' phút trước';
  const h = Math.floor(m/60);
  if (h < 24) return h + ' giờ trước';
  return Math.floor(h/24) + ' ngày trước';
}

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(id)?.classList.add('active');
}

function setStatus(type, text) {
  const bar = $('statusBar');
  if (bar) bar.className = 'status-bar status-' + type;
  const icons = { idle:'○', ready:'●', working:'◆', done:'✓', error:'✕' };
  const ic = $('statusIcon'); if (ic) ic.textContent = icons[type]||'○';
  const tx = $('statusText'); if (tx) tx.textContent = text;
}

function setStep(id, status, note) {
  const el = $(id);
  if (!el) return;
  el.className = 'progress-step ' + status;
  const icons = { pending:'⬡', active:'◇', done:'◈', error:'✕' };
  const ic = el.querySelector('.step-icon'); if (ic) ic.textContent = icons[status]||'⬡';
  const st = el.querySelector('.step-status'); if (st && note) st.textContent = note;
}

function setProgress(pct, msg) {
  const bar = $('progressBar'); if (bar) bar.style.width = Math.min(100,pct) + '%';
  const tx  = $('progressMsg'); if (tx && msg) tx.textContent = msg;
}

function sendMsg(action, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...extra }, (r) => {
      resolve(chrome.runtime.lastError ? null : r);
    });
  });
}

function upgradeImg(url) {
  if (!url) return '';
  return url.replace(/\._[A-Z0-9_,]+_\./gi,'.').replace(/(\.(jpg|jpeg|png|webp))$/i,'._SL3000_$1');
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['openrouterKey','defaultModel','outputFolder','exportMode','updateCheckEnabled'], (d) => {
      state.settings = { ...state.settings, ...d };
      const v = chrome.runtime.getManifest().version;
      const el = $('headerVersion'); if (el) el.textContent = 'v' + v;
      const sv = $('settingsVersion'); if (sv) sv.textContent = 'v' + v;
      const cv = $('currentVersionDisplay'); if (cv) cv.textContent = 'v' + v;
      if ($('inputApiKey'))    $('inputApiKey').value    = state.settings.openrouterKey || '';
      if ($('inputFolder'))    $('inputFolder').value    = state.settings.outputFolder  || 'UKListing';
      if ($('settingsModel'))  $('settingsModel').value  = state.settings.defaultModel  || 'deepseek/deepseek-chat';
      if ($('modelSelect'))    $('modelSelect').value    = state.settings.defaultModel  || 'deepseek/deepseek-chat';
      if ($('toggleAutoUpdate')) $('toggleAutoUpdate').checked = state.settings.updateCheckEnabled !== false;
      const em = state.settings.exportMode || 'zip';
      const modeEl = document.querySelector(`input[name="exportMode"][value="${em}"]`);
      if (modeEl) modeEl.checked = true;
      // Live folder preview
      const fi = $('inputFolder');
      const fp = $('folderPreview');
      if (fi && fp) {
        fp.textContent = fi.value || 'UKListing';
        fi.addEventListener('input', () => { if(fp) fp.textContent = fi.value || 'UKListing'; });
      }
      resolve();
    });
  });
}

async function saveSettings() {
  const checkedMode = document.querySelector('input[name="exportMode"]:checked');
  const s = {
    openrouterKey:     ($('inputApiKey')?.value || '').trim(),
    defaultModel:       $('settingsModel')?.value || 'deepseek/deepseek-chat',
    outputFolder:      ($('inputFolder')?.value  || 'UKListing').trim(),
    exportMode:         checkedMode?.value || 'zip',
    updateCheckEnabled: $('toggleAutoUpdate')?.checked !== false,
  };
  state.settings = { ...state.settings, ...s };
  await new Promise((r) => chrome.storage.sync.set(s, r));
  const saved = $('settingsSaved');
  if (saved) { saved.classList.remove('hidden'); setTimeout(() => saved.classList.add('hidden'), 2000); }
}

// ─── Page Detection ───────────────────────────────────────────────────────────

async function detectPage() {
  const tabs = await chrome.tabs.query({ active:true, currentWindow:true }).catch(() => []);
  const tab  = tabs[0];
  if (!tab) return;
  state.tab = tab;

  if (!tab.url?.includes('amazon.co.uk')) {
    setStatus('idle', 'Mở trang sản phẩm Amazon UK'); return;
  }
  if (!tab.url.match(/\/dp\/[A-Z0-9]{10}/)) {
    setStatus('idle', 'Điều hướng đến trang chi tiết sản phẩm'); return;
  }

  setStatus('working', 'Đang phát hiện sản phẩm...');
  const ping = await chrome.tabs.sendMessage(tab.id, { action:'PING' }).catch(() => null);
  if (!ping?.isProduct) { setStatus('idle', 'Không phát hiện sản phẩm'); return; }

  setStatus('ready', 'Phát hiện sản phẩm Amazon UK');
  if ($('productAsin'))   $('productAsin').textContent   = 'ASIN: ' + ping.asin;
  if ($('productTitle'))  $('productTitle').textContent  = ping.title || 'Product detected';
  if ($('badgeVariants')) $('badgeVariants').textContent = (ping.variantCount||0) + ' variants';
  if ($('badgeImages'))   $('badgeImages').textContent   = (ping.imageCount||0) + ' images';
  if ($('badgeStock'))    $('badgeStock').textContent    = ping.stock || ping.price || '—';
  show($('productCard'), $('optionPanel'), $('ctaPanel'));
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function startExport() {
  const opts = {
    images: $('optImages')?.checked,
    ai:     $('optAI')?.checked,
    excel:  $('optExcel')?.checked,
    zip:    $('optZip')?.checked,
    model:  $('modelSelect')?.value,
  };
  if (opts.ai && !state.settings.openrouterKey) {
    showError('Cần OpenRouter API key.\nVào Settings để thêm key.'); return;
  }
  hide($('optionPanel'),$('ctaPanel'),$('productCard'),$('errorPanel'),$('resultPanel'));
  show($('progressPanel'));
  setStatus('working','Đang xuất...');
  ['step-scrape','step-images','step-ai','step-excel','step-zip'].forEach((s) => setStep(s,'pending'));
  setProgress(0,'Khởi tạo...');

  try {
    // 1. Scrape
    setStep('step-scrape','active'); setProgress(5,'Đang scrape...');
    const sr = await chrome.tabs.sendMessage(state.tab.id, { action:'SCRAPE' });
    if (!sr?.success) throw new Error('Scrape lỗi: ' + (sr?.error||'unknown'));
    state.product = sr.data;
    const vCount = state.product.variants?.length || 0;
    const imgCount = state.product.images?.length || 0;
    setStep('step-scrape','done', vCount + ' variants, ' + imgCount + ' imgs');
    setProgress(20,'Scraped: ' + state.product.asin + ' (' + vCount + ' variants)');
    if ($('badgeImages')) $('badgeImages').textContent = (state.product.images?.length||0) + ' images';
    if ($('badgeStock'))  $('badgeStock').textContent  = state.product.stock?.status||'Unknown';

    // 2. Images
    if (opts.images) {
      setStep('step-images','active'); setProgress(25,'Tải ảnh...');
      const ir = await downloadImages(state.product, (p) =>
        setProgress(25+Math.round(p.done/p.total*20), 'Ảnh: '+p.done+'/'+p.total));
      state.imageFiles = ir.files;
      setStep('step-images','done', ir.downloaded+'/'+ir.total);
      setProgress(45,'Tải xong '+ir.downloaded+' ảnh');
    } else { setStep('step-images','done','Bỏ qua'); }

    // 3. AI
    if (opts.ai) {
      setStep('step-ai','active'); setProgress(50,'AI rewrite...');
      state.aiResult = await callAI(state.product, opts.model);
      setStep('step-ai','done', opts.model.split('/')[0]);
      setProgress(70,'AI xong');
    } else { state.aiResult = null; setStep('step-ai','done','Bỏ qua'); }

    // 4. Excel
    let excelBlob = null;
    if (opts.excel) {
      setStep('step-excel','active'); setProgress(75,'Tạo Excel...');
      excelBlob = buildExcel(state.product, state.aiResult);
      setStep('step-excel','done','product.xlsx'); setProgress(85,'Excel xong');
    } else { setStep('step-excel','done','Bỏ qua'); }

    // 5. ZIP
    if (opts.zip) {
      setStep('step-zip','active'); setProgress(88,'Đóng gói ZIP...');
      state.zipBlob = await buildZip(state.product, state.aiResult, state.imageFiles, excelBlob);
      setStep('step-zip','done', fmt(state.zipBlob.size)); setProgress(100,'Hoàn tất!');
    } else { setStep('step-zip','done','Bỏ qua'); }

    setStatus('done','Xuất hoàn tất');
    showResult();
  } catch(e) {
    setStatus('error','Thất bại'); showError(e.message);
  }
}

async function downloadImages(product, onProgress) {
  const all = [
    ...(product.images||[]).map((u,i) => ({ url:upgradeImg(u), path:`images/main/${i===0?'main':i}.jpg` })),
    ...(product.variants||[]).filter(v=>v.image).map(v => ({
      url: upgradeImg(v.image),
      path: `images/variants/${(v.value||'x').replace(/\s+/g,'-').toUpperCase()}/main.jpg`
    })),
  ];
  const files = [];
  for (let i = 0; i < all.length; i++) {
    try {
      const blob = await (async (url, tries=3) => {
        for (let t=0; t<tries; t++) {
          try { const r=await fetch(url); if(!r.ok) throw 0; return await r.blob(); }
          catch { if(t===tries-1) throw new Error('fail'); await sleep(600*(t+1)); }
        }
      })(all[i].url);
      const b64 = await new Promise((res,rej) => {
        const fr=new FileReader(); fr.onload=()=>res(fr.result.split(',')[1]); fr.onerror=rej; fr.readAsDataURL(blob);
      });
      files.push({ path:all[i].path, data:b64, type:blob.type||'image/jpeg' });
    } catch(_) {}
    onProgress({ done:i+1, total:all.length });
  }
  return { files, total:all.length, downloaded:files.length };
}

async function callAI(product, model) {
  const prompt = `Rewrite this Amazon UK product for eBay UK. Respond ONLY in JSON (no markdown):
{
  "seoTitle": "",
  "subtitle": "",
  "ebayCategory": "",
  "itemSpecifics": {},
  "bulletPoints": ["","","","",""],
  "htmlDescription": "",
  "searchTags": ["","","","","","","",""],
  "conditionDescription": ""
}

Title: ${product.title}
Brand: ${product.brand||'N/A'}
Bullets:\n${(product.bullets||[]).slice(0,5).join('\n')}
Description: ${(product.description||'').substring(0,400)}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+state.settings.openrouterKey,
      'HTTP-Referer':'https://uk-listing-optimizer.ext',
      'X-Title':'UK Listing Optimizer',
    },
    body: JSON.stringify({ model, max_tokens:2000,
      messages:[
        {role:'system', content:'You are an eBay UK SEO expert. Respond ONLY in valid JSON.'},
        {role:'user', content:prompt}
      ]
    }),
  });
  if (!res.ok) throw new Error('OpenRouter '+res.status);
  const d = await res.json();
  const t = (d.choices?.[0]?.message?.content||'').replace(/```json\s*/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(t); } catch { const m=t.match(/\{[\s\S]*\}/); return m?JSON.parse(m[0]):({}); }
}

function buildExcel(product, ai) {
  const wb = XLSX.utils.book_new();
  const asin = product.asin||'UNKNOWN';
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['ASIN','SEO Title','Subtitle','Brand','Category','eBay Category','Orig Price','Sale Price','Stock','Rating','Amazon URL'],
    [asin, ai?.seoTitle||product.title||'', ai?.subtitle||'', product.brand||'',
     product.category||'', ai?.ebayCategory||'', product.price?.original||'',
     product.price?.sale||'', product.stock?.status||'', product.rating?.rating||'', product.url||''],
  ]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Parent Product');

  const varRows=[['SKU','Type','Value','Price','Stock','Image Path']];
  (product.variants||[]).forEach(v => varRows.push([
    `${asin}-${(v.type||'V').toUpperCase()}-${(v.value||'X').replace(/\s+/g,'-').toUpperCase()}`,
    v.type||'', v.value||'', product.price?.sale||'',
    v.selected?(product.stock?.quantity||99):0,
    `images/variants/${(v.value||'').replace(/\s+/g,'-').toUpperCase()}/main.jpg`,
  ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(varRows), 'Variants');

  const cont=[['Type','Content']];
  (ai?.bulletPoints||product.bullets||[]).forEach((b,i)=>cont.push(['Bullet '+(i+1),b]));
  if(ai?.searchTags?.length) cont.push(['Tags',ai.searchTags.join(', ')]);
  cont.push(['HTML',ai?.htmlDescription||product.description||'']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cont), 'SEO Content');

  const specs=[['Attribute','Value']];
  Object.entries({...(product.itemSpecifics||{}),...(ai?.itemSpecifics||{})}).forEach(([k,v])=>specs.push([k,v]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(specs), 'Item Specifics');

  return new Blob([XLSX.write(wb,{bookType:'xlsx',type:'array'})],
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

async function buildZip(product, ai, imgs, excelBlob) {
  const zip = new JSZip();
  const d   = new Date();
  const mon = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const cat = (product.category||'MISC').split('>')[0].trim().replace(/\s+/g,'-').toUpperCase().substring(0,20);
  const tit = (product.title||'P').split(' ').slice(0,3).join('-').replace(/[^A-Z0-9-]/gi,'').toUpperCase();
  const root= `EXPORTS/${mon}/${cat}/${product.asin}-${tit}/`;

  zip.file(root+'original-data.json', JSON.stringify(product,null,2));
  if(ai) zip.file(root+'seo-content/ebay-listing.json', JSON.stringify(ai,null,2));
  if(excelBlob) zip.file(root+'product.xlsx', excelBlob);
  for(const img of imgs) zip.file(root+img.path, img.data, {base64:true});
  zip.file(root+'logs/export.log',
    `Date: ${new Date().toISOString()}\nASIN: ${product.asin}\nImages: ${imgs.length}\nAI: ${ai?'Yes':'No'}`);
  return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
}

function showResult() {
  hide($('progressPanel')); show($('resultPanel'));
  const ai = state.aiResult;
  $('resultStats').innerHTML = [
    'ASIN: '+state.product.asin,
    'Ảnh: '+state.imageFiles.length+' đã tải',
    'Variants: '+(state.product.variants?.length||0),
    ai ? 'SEO Title: '+(ai.seoTitle?.length||0)+'/80 ký tự' : 'AI: Bỏ qua',
    state.zipBlob ? 'ZIP: '+fmt(state.zipBlob.size) : '',
  ].filter(Boolean).join('<br>');
  $('resultPreview').innerHTML = ai
    ? `<strong style="color:var(--accent)">Title:</strong> ${esc(ai.seoTitle||'')}<br><strong style="color:var(--accent)">Tags:</strong> ${esc((ai.searchTags||[]).join(', '))}`
    : 'Xuất không có AI rewrite';
}

function showError(msg) {
  hide($('progressPanel'),$('optionPanel'),$('ctaPanel'));
  show($('errorPanel'));
  const el=$('errorMsg'); if(el) el.textContent=msg;
  setStatus('error','Thất bại');
}

function downloadZip() {
  if(!state.zipBlob) return;
  const url=URL.createObjectURL(state.zipBlob);
  const a=document.createElement('a');
  a.href=url; a.download=(state.product?.asin||'export')+'-ebay-package.zip'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

function resetExport() {
  state.product=state.aiResult=state.zipBlob=null; state.imageFiles=[];
  hide($('resultPanel'),$('errorPanel'),$('progressPanel'));
  ['step-scrape','step-images','step-ai','step-excel','step-zip'].forEach(s=>setStep(s,'pending'));
  setProgress(0,''); detectPage();
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

async function initUpdater() {
  const cached = await sendMsg('GET_UPDATE_STATUS');
  state.updateResult = cached;
  renderUpdate(cached);
  if (cached?.hasUpdate && !cached.dismissed) showBanner(cached);
}

async function checkUpdateNow() {
  const btn = $('btnCheckNow');
  const sl  = $('updateStatusLine');
  if (btn) { btn.disabled=true; btn.textContent='↻ Đang kiểm tra...'; }
  if (sl)  { sl.textContent='Đang kết nối...'; sl.className='update-status-line'; }

  const result = await sendMsg('CHECK_UPDATE_NOW');
  state.updateResult = result;

  if (btn) { btn.disabled=false; btn.textContent='↻ Kiểm tra ngay'; }
  renderUpdate(result);
  if (result?.hasUpdate && !result.dismissed) showBanner(result);
  else hideBanner();
}

function renderUpdate(r) {
  if (!r) {
    const sl=$('updateStatusLine');
    if(sl){sl.textContent='Không có dữ liệu — nhấn Kiểm tra ngay';sl.className='update-status-line';}
    return;
  }
  const cur = chrome.runtime.getManifest().version;
  if($('currentVersionDisplay')) $('currentVersionDisplay').textContent = 'v'+cur;
  if($('newVersionDisplay'))     $('newVersionDisplay').textContent     = r.newVersion ? 'v'+r.newVersion : '—';

  const nbox=$('newVersionBox'), arrow=$('updateArrow');
  if(r.hasUpdate){ nbox?.classList.add('has-update'); arrow?.classList.add('active'); }
  else           { nbox?.classList.remove('has-update'); arrow?.classList.remove('active'); }

  const sl=$('updateStatusLine');
  if(sl){
    if(r.error)         { sl.textContent='✕ Lỗi: '+r.error;                      sl.className='update-status-line error'; }
    else if(r.forceUpdate){ sl.textContent='⚠ Bắt buộc cập nhật!';              sl.className='update-status-line error'; }
    else if(r.critical) { sl.textContent='⚡ Cập nhật bảo mật quan trọng';       sl.className='update-status-line update'; }
    else if(r.hasUpdate){ sl.textContent='↑ Có phiên bản mới: v'+r.newVersion;   sl.className='update-status-line update'; }
    else                { sl.textContent='✓ Đang dùng phiên bản mới nhất';        sl.className='update-status-line ok'; }
  }

  const rd=$('updateReleaseDate');
  if(rd && r.releaseDate) rd.textContent='Phát hành: '+new Date(r.releaseDate).toLocaleDateString('vi-VN');

  const cp=$('changelogPanel'), cl=$('changelogList');
  if(cp && cl && r.changelog?.length){
    cp.classList.remove('hidden');
    cl.innerHTML=r.changelog.map(i=>`<li>${esc(i)}</li>`).join('');
  }

  if(r.forceUpdate) $('forceUpdateWarning')?.classList.remove('hidden');

  const dlBtn=$('btnDownloadUpdate');
  if(dlBtn){
    if(r.hasUpdate && r.downloadUrl){ dlBtn.disabled=false; dlBtn.textContent='⬇ Tải v'+r.newVersion; }
    else if(!r.hasUpdate && !r.error){ dlBtn.disabled=true; dlBtn.textContent='✓ Đã là phiên bản mới nhất'; }
    else{ dlBtn.disabled=!r.downloadUrl; dlBtn.textContent='⬇ Tải về bản mới'; }
  }

  const lc=$('updateLastCheck');
  if(lc && r.checkedAt) lc.textContent='Kiểm tra lần cuối: '+timeAgo(r.checkedAt);

  const dot=$('headerUpdateDot');
  if(dot){
    if(r.hasUpdate && !r.dismissed){ dot.classList.remove('hidden'); dot.classList.toggle('critical',!!r.critical); }
    else dot.classList.add('hidden');
  }
}

function showBanner(r) {
  const banner=$('updateBanner'); if(!banner) return;
  banner.classList.remove('hidden');
  banner.classList.toggle('critical',!!(r.critical||r.forceUpdate));
  const bl=$('updateBadgeLabel');
  if(bl){ bl.textContent=r.forceUpdate?'URGENT':r.critical?'CRITICAL':'NEW'; }
  const bt=$('updateBannerTitle');
  if(bt) bt.textContent=r.forceUpdate?'Bắt buộc cập nhật':r.critical?'Cập nhật bảo mật':'Có phiên bản mới';
  const bs=$('updateBannerSub');
  if(bs) bs.textContent='v'+r.currentVersion+' → v'+r.newVersion;
  if(r.forceUpdate){ const db=$('btnDismissUpdate'); if(db) db.style.display='none'; }
}

function hideBanner() { $('updateBanner')?.classList.add('hidden'); }

async function downloadUpdate() {
  const r=state.updateResult;
  if(!r?.downloadUrl) return;
  const btn=$('btnDownloadUpdate');
  if(btn){ btn.disabled=true; btn.textContent='⬇ Đang tải...'; }
  const res=await sendMsg('DOWNLOAD_UPDATE',{url:r.downloadUrl,filename:'UkExtension-v'+r.newVersion+'.zip'});
  if(res?.ok){
    if(btn) btn.textContent='✓ Đã tải xong!';
    $('installGuide')?.classList.remove('hidden');
  } else {
    if(btn){ btn.disabled=false; btn.textContent='⬇ Thử lại'; }
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Main
  $('btnStart')?.addEventListener('click', startExport);
  $('btnDownload')?.addEventListener('click', downloadZip);
  $('btnReset')?.addEventListener('click', resetExport);
  $('btnRetry')?.addEventListener('click', resetExport);

  // Nav
  $('btnSettings')?.addEventListener('click', () => showView('viewSettings'));
  $('btnBack')?.addEventListener('click',     () => showView('viewMain'));
  $('btnUpdates')?.addEventListener('click',  () => {
    showView('viewUpdate');
    $('headerUpdateDot')?.classList.add('hidden');
    sendMsg('CLEAR_BADGE');
  });
  $('btnUpdateBack')?.addEventListener('click', () => showView('viewMain'));

  // Settings
  $('btnSaveSettings')?.addEventListener('click', saveSettings);
  $('btnReveal')?.addEventListener('click', () => {
    const i=$('inputApiKey'); if(i) i.type=i.type==='password'?'text':'password';
  });
  $('linkOpenRouter')?.addEventListener('click', ()=>chrome.tabs.create({url:'https://openrouter.ai/keys'}));
  $('linkDocs')?.addEventListener('click', ()=>chrome.tabs.create({url:'https://github.com/viettq751987/UkExtension'}));
  $('modelSelect')?.addEventListener('change', (e)=>{ state.settings.defaultModel=e.target.value; });

  // Nhận progress scrape variant từ content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'SCRAPE_PROGRESS') {
      const p = msg.progress;
      if (p.phase === 'detecting') {
        setProgress(6, 'Đang phát hiện variants...');
      } else if (p.phase === 'variants') {
        const pct = 6 + Math.round((p.done / Math.max(p.total, 1)) * 12);
        setProgress(pct, `Scraping variant ${p.done}/${p.total}...`);
        setStep('step-scrape', 'active', `${p.done}/${p.total} variants`);
      }
    }
  });

  // Update
  $('btnCheckNow')?.addEventListener('click', checkUpdateNow);
  $('btnDownloadUpdate')?.addEventListener('click', downloadUpdate);
  $('btnViewUpdate')?.addEventListener('click', () => { hideBanner(); showView('viewUpdate'); sendMsg('CLEAR_BADGE'); });
  $('btnDismissUpdate')?.addEventListener('click', () => {
    const ver=state.updateResult?.newVersion;
    if(ver) sendMsg('DISMISS_UPDATE',{version:ver});
    hideBanner();
    $('headerUpdateDot')?.classList.add('hidden');
  });
  $('btnOpenExtPage')?.addEventListener('click', ()=>chrome.tabs.create({url:'chrome://extensions/'}));
  $('toggleAutoUpdate')?.addEventListener('change', (e)=>chrome.storage.sync.set({updateCheckEnabled:e.target.checked}));

  // Nhận PRODUCT_DETECTED từ content script (auto-detect khi page load)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'PRODUCT_DETECTED') {
      // Cập nhật badge variants nếu popup đang mở
      const bv = $('badgeVariants');
      if (bv && msg.variantCount > 0) bv.textContent = msg.variantCount + ' variants';
    }
    if (msg.action === 'SCRAPE_PROGRESS') {
      const p = msg.progress;
      if (p.phase === 'detecting') {
        setProgress(6, 'Đang phát hiện variants...');
      } else if (p.phase === 'variants') {
        const pct = 6 + Math.round((p.done / Math.max(p.total,1)) * 12);
        setProgress(pct, 'Scraping variant ' + p.done + '/' + p.total + (p.label?' ('+p.label+')':''));
        setStep('step-scrape', 'active', p.done+'/'+p.total+' variants');
      }
    }
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await detectPage();
  bindEvents();
  await initUpdater();
});
