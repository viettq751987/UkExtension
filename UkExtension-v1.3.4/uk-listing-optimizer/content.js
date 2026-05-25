// content.js - UK Listing Optimizer v1.2.3
// document_start + MutationObserver = detect nhanh như CoTik
(function() {
  'use strict';

  const PANEL_ID = '__ulo_panel__';
  const EXT_URL  = chrome.runtime.getURL('');

  // Inject XLSX + JSZip via background scripting (reliable cross-context injection)
  async function ensureLibs() {
    if (typeof XLSX !== 'undefined' && typeof JSZip !== 'undefined') return;
    await new Promise((resolve, reject) => {
      // Refresh exportMode dataset khi settings thay đổi
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.exportMode) {
        const b = document.getElementById('__ulo_ex');
        if (b) b.dataset.exportMode = changes.exportMode.newValue || 'zip';
      }
    });

    chrome.runtime.sendMessage({ action: 'INJECT_LIBS' }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    });
    // Wait for globals to be available
    for (let i = 0; i < 20; i++) {
      if (typeof XLSX !== 'undefined' && typeof JSZip !== 'undefined') return;
      await new Promise(r => setTimeout(r, 100));
    }
    if (typeof XLSX === 'undefined') throw new Error('XLSX library failed to load');
    if (typeof JSZip === 'undefined') throw new Error('JSZip library failed to load');
  }

  // ── Bridge MAIN world ──────────────────────────────────────────────────────
  function callMain(action, extra) {
    return new Promise(resolve => {
      const id = '__ulo_' + Math.random().toString(36).slice(2);
      const h = e => { if (e.detail?.id===id){window.removeEventListener('__ulo_cb__',h);resolve(e.detail.result);} };
      window.addEventListener('__ulo_cb__', h);
      window.dispatchEvent(new CustomEvent('__ulo_cmd__', {detail:{id,action,...(extra||{})}}));
      setTimeout(()=>{window.removeEventListener('__ulo_cb__',h);resolve(null);}, 5000);
    });
  }

  function waitForMain(ms) {
    return new Promise(resolve => {
      if (window.__ULO__?.ready){resolve(true);return;}
      const h=()=>{window.removeEventListener('__ulo_ready__',h);resolve(true);};
      window.addEventListener('__ulo_ready__', h);
      setTimeout(()=>{window.removeEventListener('__ulo_ready__',h);resolve(false);}, ms||4000);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MutationObserver — detect ngay khi DOM elements xuất hiện (document_start)
  // ══════════════════════════════════════════════════════════════════════════

  function watchAndDetect() {
    const asin = getASIN();
    if (!asin || !/\/dp\/[A-Z0-9]{10}/.test(location.pathname)) return;

    // Nếu DOM đã có title → inject ngay
    if (document.querySelector('#productTitle')) {
      scheduleDetect();
      return;
    }

    // Chưa có → dùng MutationObserver watch
    const observer = new MutationObserver(() => {
      if (document.querySelector('#productTitle')) {
        observer.disconnect();
        scheduleDetect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Fallback sau 5s
    setTimeout(() => { observer.disconnect(); scheduleDetect(); }, 5000);
  }

  let detectScheduled = false;
  async function scheduleDetect() {
    if (detectScheduled || document.getElementById(PANEL_ID)) return;
    detectScheduled = true;

    // Lấy data từ DOM ngay lập tức
    const asin       = getASIN();
    const title      = getTitle();
    const imageCount = getDOMImages().length;
    const stock      = getDOMStock().status;
    const price      = getDOMPrice().sale;

    // Inject panel ngay — hiện thông tin cơ bản trước
    injectPanel({ asin, title, variantCount: 0, imageCount, stock, price });

    // Đợi MAIN world + twister
    await waitForMain(3000);
    const variantCount = await callMain('GET_COUNT') || 0;

    // Update badge variants
    const sv = document.getElementById('__u_sv');
    if (sv) sv.textContent = variantCount + ' variants';

    // Nếu twister chưa load (variantCount=0), retry
    if (!variantCount) {
      let tries = 0;
      const retry = setInterval(async () => {
        tries++;
        const count = await callMain('GET_COUNT');
        if (count || tries >= 10) {
          clearInterval(retry);
          const el = document.getElementById('__u_sv');
          if (el && count) el.textContent = count + ' variants';
        }
      }, 500);
    }

    chrome.runtime.sendMessage({
      action: 'PRODUCT_DETECTED', asin, title, variantCount, imageCount, stock, price
    }).catch(()=>{});
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DOM HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  const getASIN = () => {
    const m = location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
    return m ? m[1] : document.querySelector('#ASIN')?.value || null;
  };

  const getTitle = () =>
    document.querySelector('#productTitle')?.textContent?.trim() || document.title;

  const getBrand = () =>
    (document.querySelector('#bylineInfo')||document.querySelector('.po-brand .a-span9 span')||{textContent:''})
    .textContent.trim().replace(/^(Visit the|Brand:|Store:|by)\s*/i,'').replace(/\s+Store$/i,'').trim();

  const getBullets = () => {
    const b = [];
    document.querySelectorAll('#feature-bullets ul li:not(.aok-hidden) span.a-list-item').forEach(el => {
      const t = el.textContent.trim();
      if (t && t.length > 10 && !t.includes('Make sure') && !t.includes('return') && !t.includes('Your orders')) b.push(t);
    });
    return b;
  };

  const getDescription = () => {
    const selectors = [
      '#productDescription p',
      '#productDescription',
      '#dpx-aplus-product-description_feature_div p',
      '#aplus p',
    ];
    for (const sel of selectors) {
      const t = document.querySelector(sel)?.textContent?.trim();
      if (t && t.length > 50) return t.substring(0, 3000);
    }
    // A+ text fallback
    const parts = [];
    document.querySelectorAll('#aplus .a-size-base, #aplus p, #aplus span[class*="text"]').forEach(el => {
      const t = el.textContent.trim();
      if (t.length > 30 && !t.includes('{') && !t.includes('function')) parts.push(t);
    });
    return parts.join(' ').substring(0, 3000);
  };

  const getCategory = () => {
    const c = [];
    document.querySelectorAll('#wayfinding-breadcrumbs_feature_div li a').forEach(a => {
      const t = a.textContent.trim();
      if (t && t !== '›') c.push(t);
    });
    return c.join(' > ');
  };

  const getSpecs = () => {
    const s = {};
    document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr').forEach(r => {
      const k=(r.querySelector('th')||{textContent:''}).textContent.trim();
      const v=(r.querySelector('td')||{textContent:''}).textContent.replace(/\s+/g,' ').trim();
      if (k && v) s[k]=v;
    });
    document.querySelectorAll('#detailBullets_feature_div li').forEach(li => {
      const sp=li.querySelectorAll('span');
      if (sp.length>=2) {
        const k=sp[0].textContent.replace(/[:\u200f\u200e\s]+$/,'').trim();
        const v=sp[1].textContent.trim();
        if (k&&v&&!k.includes('Customer')&&!k.includes('Best Seller')) s[k]=v;
      }
    });
    return s;
  };

  const getRating = () => ({
    rating:(document.querySelector('#acrPopover .a-icon-alt')||{textContent:''}).textContent.split(' ')[0]||'',
    count: (document.querySelector('#acrCustomerReviewText')||{textContent:''}).textContent.trim()||'',
  });

  const getDOMImages = () => {
    const imgs=[], seen={};
    const add=url=>{
      if(!url)return;
      const c=url.split('?')[0].replace(/\._[A-Z0-9_,]+_\./gi,'.');
      const u=c.replace(/\.(jpg|jpeg|png|webp)$/i,'._SL3000_.$1');
      if(u.startsWith('http')&&!seen[u]){seen[u]=1;imgs.push(u);}
    };
    const d=document.querySelector('#landingImage[data-a-dynamic-image]');
    if(d){try{Object.entries(JSON.parse(d.getAttribute('data-a-dynamic-image'))).sort((a,b)=>b[1][0]*b[1][1]-a[1][0]*a[1][1]).forEach(([u])=>add(u));}catch(_){add(d.src||'');}}
    document.querySelectorAll('#altImages li.item img').forEach(img=>add(img.src||''));
    return imgs.slice(0,9);
  };

  const getDOMPrice = () => {
    const sels=[
      '#corePriceDisplay_desktop_feature_div .a-price[data-a-color="price"] .a-offscreen',
      '#corePrice_feature_div .a-price[data-a-color="price"] .a-offscreen',
      '.a-price[data-a-color="price"] .a-offscreen',
      '#priceblock_ourprice','#price_inside_buybox','.a-price .a-offscreen',
    ];
    let sale='';
    for(const s of sels){const t=document.querySelector(s)?.textContent?.trim();if(t){sale=t;break;}}
    const orig=document.querySelector('.a-text-price .a-offscreen')?.textContent?.trim()||'';
    return {sale,original:orig};
  };

  const getDOMStock = () => {
    const txt=(document.querySelector('#availability span')||{textContent:''}).textContent.trim();
    if(/in stock/i.test(txt))       return{status:'In Stock',   quantity:99};
    if(/only\s+(\d+)/i.test(txt))   {const m=txt.match(/only\s+(\d+)/i);return{status:'Low Stock',quantity:parseInt(m[1])};}
    if(/out of stock/i.test(txt))   return{status:'Out of Stock',quantity:0};
    return{status:txt||'Unknown',quantity:0};
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FETCH SCRAPER
  // ══════════════════════════════════════════════════════════════════════════

  function parseVariantHTML(html, asin) {
    const imgs=[...new Set(
      [...html.matchAll(/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.jpg)"/g)]
      .map(m=>m[1].replace(/_AC_SL\d+_/,'_AC_SL3000_'))
    )].slice(0,9);

    let sale='',original='';
    const pm=html.match(/"priceAmount"\s*:\s*([\d.]+)/);
    if(pm)sale='£'+pm[1];
    if(!sale){const pm2=html.match(/id="priceblock_ourprice"[^>]*>(£[\d.,]+)/);if(pm2)sale=pm2[1];}
    const om=html.match(/"strikePrice"\s*:\s*"([^"]+)"/);
    if(om)original=om[1];

    let status='Unknown',quantity=0;
    const sm=html.match(/id="availability"[^>]*>[\s\S]*?<span[^>]*>\s*([^<]+?)\s*<\/span>/);
    const txt=sm?sm[1].trim():'';
    if(/in stock/i.test(txt))       {status='In Stock';quantity=99;}
    else if(/only\s+(\d+)/i.test(txt)){const m=txt.match(/only\s+(\d+)/i);status='Low Stock';quantity=parseInt(m[1]);}
    else if(/out of stock/i.test(txt)){status='Out of Stock';quantity=0;}
    else if(txt)                     {status=txt.substring(0,40);}

    return {asin,images:imgs,price:{sale,original},stock:{status,quantity}};
  }

  async function fetchVariant(asin) {
    const res=await fetch(`https://www.amazon.co.uk/dp/${asin}?th=1&psc=1`,{
      credentials:'include',headers:{'Accept':'text/html,*/*','Accept-Language':'en-GB,en;q=0.9'},
    });
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    return parseVariantHTML(await res.text(),asin);
  }

  async function scrapeProduct(onProgress) {
    const asin=getASIN();
    if(!asin)throw new Error('Không tìm thấy ASIN');
    await waitForMain(3000);
    const twister=await callMain('GET_TWISTER');

    if(onProgress)onProgress({done:0,total:1,label:'Fetching...'});
    const cur=await fetchVariant(asin);

    const base={
      asin,url:location.href,
      title:getTitle(),brand:getBrand(),category:getCategory(),
      bullets:getBullets(),description:getDescription(),
      itemSpecifics:getSpecs(),rating:getRating(),
      scrapedAt:new Date().toISOString(),
      price:cur.price,stock:cur.stock,images:cur.images,variants:[],
    };

    if(!twister||Object.keys(twister.combos).length<=1){
      if(onProgress)onProgress({done:1,total:1});
      return base;
    }

    const{combos,valMap,dimList}=twister;
    const entries=Object.entries(combos);
    const total=entries.length;
    if(onProgress)onProgress({done:0,total});

    const defs=entries.map(([comboKey,vASIN])=>{
      const idx=comboKey.split(':').map(Number);
      const dims={};
      dimList.forEach((dim,di)=>{dims[dim]=(valMap[dim]||[])[idx[di]]||'';});
      return{comboKey,asin:vASIN,dimensions:dims,label:dimList.map(d=>dims[d]).filter(Boolean).join(' / ')};
    });

    let done=0;
    const fetched=await Promise.all(defs.map(async v=>{
      const data=await fetchVariant(v.asin).catch(()=>({
        asin:v.asin,images:[],price:{sale:'',original:''},stock:{status:'Unknown',quantity:0}
      }));
      done++;
      if(onProgress)onProgress({done,total,label:v.label});
      return{...v,...data};
    }));

    base.variants=fetched.map(v=>({
      comboKey:v.comboKey,dimensions:v.dimensions,label:v.label,
      asin:v.asin,price:v.price,stock:v.stock,images:v.images,
      type:dimList[dimList.length-1]||'variant',
      value:v.dimensions[dimList[dimList.length-1]]||v.label,
    }));

    const orig=base.variants.find(v=>v.asin===asin);
    if(orig){
      if(orig.images.length)base.images=orig.images;
      if(orig.price.sale)base.price=orig.price;
    }
    return base;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANEL
  // ══════════════════════════════════════════════════════════════════════════

  function injectPanel(info) {
    document.getElementById(PANEL_ID)?.remove();
    const el=document.createElement('div');
    el.id=PANEL_ID;
    el.innerHTML=`
<style>
#__ulo_w{position:fixed;top:70px;right:14px;z-index:2147483647;width:230px;
  background:#0d0f11;border:1.5px solid #f0c040;border-radius:10px;
  box-shadow:0 4px 20px rgba(0,0,0,.7);font-family:'Courier New',monospace;
  animation:__uIn .18s ease;}
@keyframes __uIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
#__ulo_h{background:#141618;padding:8px 10px;display:flex;align-items:center;
  gap:7px;border-bottom:1px solid #2a2e35;cursor:move;border-radius:9px 9px 0 0;}
.u-ic{font-size:14px;filter:drop-shadow(0 0 3px #f0c040);}
.u-nm{color:#f0c040;font-size:10px;font-weight:700;letter-spacing:.08em;flex:1;}
.u-cl{color:#5c6370;background:none;border:none;font-size:12px;cursor:pointer;padding:0 3px;font-family:inherit;}
.u-cl:hover{color:#f87171;}
#__ulo_b{padding:8px 10px;}
.u-as{color:#f0c040;font-size:9px;letter-spacing:.05em;margin-bottom:2px;}
.u-ti{color:#9aa0aa;font-size:10px;line-height:1.35;margin-bottom:6px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.u-st{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;}
.u-s{padding:2px 6px;border-radius:99px;font-size:9px;border:1px solid #2a2e35;
  color:#9aa0aa;background:#1c1f22;white-space:nowrap;}
.u-s.y{color:#f0c040;border-color:#a8841c;background:rgba(240,192,64,.08);}
.u-s.g{color:#34d399;border-color:#1a6b4b;background:rgba(52,211,153,.08);}
.u-s.b{color:#60a5fa;border-color:#1e40af;background:rgba(96,165,250,.08);}
#__ulo_ex{width:100%;padding:8px;background:#f0c040;color:#0d0f11;border:none;
  border-radius:6px;font-family:inherit;font-size:11px;font-weight:700;
  letter-spacing:.05em;cursor:pointer;text-transform:uppercase;transition:all .15s;}
#__ulo_ex:hover:not(:disabled){background:#ffd060;box-shadow:0 3px 10px rgba(240,192,64,.3);}
#__ulo_ex:disabled{background:#1c1f22;color:#5c6370;cursor:not-allowed;}
#__ulo_pg{display:none;margin-top:7px;}
.u-bw{background:#1c1f22;border-radius:99px;height:3px;overflow:hidden;}
.u-br{height:100%;background:linear-gradient(90deg,#f0c040,#34d399);width:0;transition:width .2s;}
.u-mg{color:#5c6370;font-size:9px;text-align:center;margin-top:3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
</style>
<div id="__ulo_w">
  <div id="__ulo_h">
    <span class="u-ic">⚡</span>
    <span class="u-nm">UK LISTING OPTIMIZER</span>
    <button class="u-cl" id="__ulo_cl">✕</button>
  </div>
  <div id="__ulo_b">
    <div class="u-as">ASIN: ${info.asin}</div>
    <div class="u-ti">${info.title}</div>
    <div class="u-st">
      <span class="u-s y" id="__u_sv">${info.variantCount} variants</span>
      <span class="u-s g" id="__u_si">${info.imageCount} images</span>
      <span class="u-s b" id="__u_ss">${info.stock||info.price||'—'}</span>
    </div>
    <button id="__ulo_ex">▶ EXPORT</button>
    <div id="__ulo_pg">
      <div class="u-bw"><div class="u-br" id="__u_bar"></div></div>
      <div class="u-mg" id="__u_msg">Đang xử lý...</div>
    </div>
  </div>
</div>`;
    document.body.appendChild(el);

    // Draggable
    const wrap=document.getElementById('__ulo_w');
    let drag=false,ox=0,oy=0;
    document.getElementById('__ulo_h').addEventListener('mousedown',e=>{
      if(e.target.id==='__ulo_cl')return;
      drag=true;const r=wrap.getBoundingClientRect();ox=e.clientX-r.left;oy=e.clientY-r.top;
      wrap.style.transition='none';e.preventDefault();
    });
    document.addEventListener('mousemove',e=>{
      if(!drag)return;
      wrap.style.right='auto';wrap.style.bottom='auto';
      wrap.style.left=(e.clientX-ox)+'px';wrap.style.top=(e.clientY-oy)+'px';
    });
    document.addEventListener('mouseup',()=>{drag=false;});
    document.getElementById('__ulo_cl').addEventListener('click',()=>el.remove());
    // Store exportMode in button dataset — đọc không cần await khi click
    chrome.storage.sync.get(['exportMode'], d => {
      const b = document.getElementById('__ulo_ex');
      if (b) b.dataset.exportMode = d.exportMode || 'zip';
    });
    document.getElementById('__ulo_ex').addEventListener('click', runExport);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ══════════════════════════════════════════════════════════════════════════

  async function runExport() {
    const btn=document.getElementById('__ulo_ex');
    const prog=document.getElementById('__ulo_pg');
    const bar=document.getElementById('__u_bar');
    const msg=document.getElementById('__u_msg');
    btn.disabled=true; prog.style.display='block';
    const setP=(pct,text)=>{
      if(bar)bar.style.width=Math.min(100,pct)+'%';
      if(msg){msg.textContent=text;msg.title=text;}
    };

    try {
      // ── Folder mode: gọi showDirectoryPicker TRƯỚC MỌI await ──
      // Phải nằm ngay trong synchronous click handler context
      // Đọc exportMode từ panel attribute (không cần await storage)
      const savedMode = document.getElementById('__ulo_ex')?.dataset?.exportMode || 'zip';
      let dirHandle = null;
      if (savedMode === 'folder') {
        try {
          dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
        } catch(e) {
          if (e.name === 'AbortError') { setP(0,'Đã huỷ'); btn.disabled=false; btn.textContent='▶ EXPORT'; prog.style.display='none'; return; }
          throw e;
        }
      }

      const settings=await new Promise(r=>chrome.storage.sync.get(['openrouterKey','defaultModel','outputFolder','exportMode'],r));
      // Default API key nếu chưa set
      // API key: user must set in Settings
      if (!settings.defaultModel)  settings.defaultModel  = 'deepseek/deepseek-chat';
      if (!settings.outputFolder)  settings.outputFolder  = 'UKListing';
      if (!settings.exportMode)    settings.exportMode    = savedMode;
      // Use dirHandle from above if folder mode
      if (savedMode === 'folder' && !dirHandle) { setP(0,'Lỗi: không có folder handle'); return; }
      // Default API key nếu chưa set
      // API key: user must set in Settings
      if (!settings.defaultModel)  settings.defaultModel  = 'deepseek/deepseek-chat';
      if (!settings.outputFolder)  settings.outputFolder  = 'UKListing';
      if (!settings.exportMode)    settings.exportMode    = 'zip';

      // 1. SCRAPE
      setP(5,'Đang scrape...');
      let product=null;
      product=await scrapeProduct(p=>{
        const pct=5+Math.round((p.done/Math.max(p.total,1))*30);
        setP(pct,`Variant ${p.done}/${p.total}${p.label?' — '+p.label:''}`);
      });
      document.getElementById('__u_sv').textContent=(product.variants?.length||0)+' variants';
      document.getElementById('__u_si').textContent=(product.images?.length||0)+' images';
      document.getElementById('__u_ss').textContent=product.stock?.status||'';
      setP(35,`✓ ${product.variants?.length||0} variants`);

      // 2. IMAGES
      setP(38,'Tải ảnh...');
      const allImgItems=[
        ...product.images.map((u,i)=>({url:u,path:`main/${String(i+1).padStart(2,'0')}.jpg`})),
        ...(product.variants||[]).flatMap(v=>
          (v.images||[]).map((u,i)=>({url:u,
            path:`variants/${(v.value||'x').replace(/[^a-zA-Z0-9]/g,'-').toUpperCase()}/${String(i+1).padStart(2,'0')}.jpg`
          }))
        ),
      ];
      const imgFiles=[];
      let imgDone=0;
      await Promise.all(allImgItems.map(async item=>{
        try{
          const blob=await fetch(item.url).then(r=>r.blob());
          const b64=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result.split(',')[1]);fr.onerror=rej;fr.readAsDataURL(blob);});
          imgFiles.push({path:item.path,data:b64,type:blob.type});
        }catch(_){}
        imgDone++;
        setP(38+Math.round(imgDone/Math.max(allImgItems.length,1)*22),`Ảnh ${imgDone}/${allImgItems.length}`);
      }));
      setP(60,`✓ ${imgFiles.length} ảnh`);

      // 3. AI
      let ai=null;
      if(settings.openrouterKey){
        setP(63,'AI đang viết...');
        try{
          const prompt = [
            'You are an eBay UK SEO expert. Return ONLY valid JSON, no markdown.',
            '',
            'TITLE RULES (max 80 chars, British English):',
            'Formula: [Brand] [Main Keyword] [Variant/Spec] [Key Feature] [UK Search Term]',
            'Example: "Ninja Dual Zone Air Fryer 9.5L Black Oil-Free Cooker UK Seller"',
            'No symbols, no ALL CAPS, natural order, high-search keywords first.',
            '',
            'DESCRIPTION (plain text, structured for eBay):',
            'Format exactly like this (use these exact separators):',
            '── About This Product ──',
            '2-3 sentences: key benefit, who it is for, brand credibility.',
            '',
            '── Key Features ──',
            '• Feature 1: explanation',
            '• Feature 2: explanation',
            '(5-8 bullet points)',
            '',
            '── Specifications ──',
            '• Spec: Value',
            '(key specs only)',
            '',
            '── Why Buy From Us ──',
            '1 sentence: delivery/quality/UK seller reassurance.',
            'British English. No Amazon mentions. No HTML tags.',
            '',
            'Return JSON:',
            '{"seoTitle":"","description":"","ebayCategory":"","itemSpecifics":{},"bulletPoints":["","","","",""],"searchTags":["","","","","","","",""]}',
            '',
            'PRODUCT:',
            `Title: ${product.title}`,
            `Brand: ${product.brand||'N/A'}`,
            `Category: ${product.category||'N/A'}`,
            'Features:',
            ...(product.bullets||[]).slice(0,6).map(b=>`- ${b}`),
            `Description: ${(product.description||'').substring(0,500)}`,
          ].join('\n');
          const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+settings.openrouterKey,'HTTP-Referer':'https://uk-listing-optimizer.ext','X-Title':'UK Listing Optimizer'},
            body:JSON.stringify({model:settings.defaultModel||'deepseek/deepseek-chat',max_tokens:2000,
              messages:[{role:'system',content:'eBay UK SEO expert. JSON only.'},{role:'user',content:prompt}]}),
          });
          const d=await res.json();
          const t=(d.choices?.[0]?.message?.content||'').replace(/```json\s*/gi,'').replace(/```/g,'').trim();
          try{ai=JSON.parse(t);}catch{const m=t.match(/\{[\s\S]*\}/);if(m)ai=JSON.parse(m[0]);}
        }catch(_){}
        setP(75,ai?'✓ AI xong':'AI lỗi, tiếp tục...');
      } else setP(75,'AI: bỏ qua');

      // 4. EXCEL — 3 sheets, layout khoa học
      setP(78,'Tạo Excel...');
      await ensureLibs();
      let excelBlob=null;
      if(typeof XLSX!=='undefined'){
        const wb    = XLSX.utils.book_new();
        const sUrl  = asin => `amazon.co.uk/dp/${asin}`;
        const blts  = ai?.bulletPoints?.length ? ai.bulletPoints : (product.bullets||[]);
        const vDir  = v => `images/variants/${(v.value||'x').replace(/[^a-zA-Z0-9]/g,'-').toUpperCase()}/`;
        const dimKeys = Object.keys((product.variants||[])[0]?.dimensions||{});

        // ── SHEET 1: Overview (layout dọc Label | Value) ──────────────────
        const ov = [
          ['PRODUCT INFO',''],
          ['ASIN',              product.asin],
          ['Brand',             product.brand    || ''],
          ['Amazon URL',        sUrl(product.asin)],
          ['Amazon Category',   product.category || ''],
          ['Rating',            product.rating?.rating || ''],
          ['Reviews',           product.rating?.count  || ''],
          ['',''],
          ['PRICING & STOCK',''],
          ['Sale Price',        product.price?.sale     || ''],
          ['Original Price',    product.price?.original || ''],
          ['Stock Status',      product.stock?.status   || ''],
          ['Stock Qty',         product.stock?.quantity ?? ''],
          ['Total Variants',    (product.variants||[]).length],
          ['Total Images',      product.images?.length  || 0],
          ['',''],
          ['EBAY LISTING (AI)',''],
          ['eBay Title',        ai?.seoTitle     || product.title || ''],
          ['eBay Category',     ai?.ebayCategory || ''],
          ['Search Tags',       ai?.searchTags?.join(', ') || ''],
          ['',''],
          ['DESCRIPTION',''],
          ['',                  ai?.description || product.description || ''],
          ['',''],
          ['BULLET POINTS',''],
          ...blts.slice(0,8).map((b,i)=>[`• ${i+1}`,b]),
        ];
        const wsOv = XLSX.utils.aoa_to_sheet(ov);
        wsOv['!cols'] = [{wch:18},{wch:110}];
        // Bold section headers
        [0,8,16,21,24].forEach(r=>{
          const c=wsOv[XLSX.utils.encode_cell({r,c:0})];
          if(c){c.s={font:{bold:true,color:{rgb:'F0C040'}}};}
        });
        XLSX.utils.book_append_sheet(wb,wsOv,'📋 Overview');

        // ── SHEET 2: Variants (bảng ngang, freeze row 1) ─────────────────
        const vHdr = [
          '#','ASIN','Label',
          ...dimKeys,
          'Sale Price','Orig Price',
          'Stock','Qty',
          'Images','Image Folder',
          'eBay Title','URL',
        ];
        const vRows = [vHdr];
        const allVars = product.variants?.length ? product.variants : [{
          asin:product.asin, label:'Default', dimensions:{},
          price:product.price, stock:product.stock, images:product.images, value:'',
        }];
        allVars.forEach((v,i)=>{
          vRows.push([
            i+1,
            v.asin||product.asin,
            v.label||'',
            ...dimKeys.map(k=>v.dimensions?.[k]||''),
            v.price?.sale    ||'',
            v.price?.original||'',
            v.stock?.status  ||'',
            v.stock?.quantity??'',
            v.images?.length ||0,
            v.asin===product.asin?'images/main/':vDir(v),
            ai?.seoTitle?`${ai.seoTitle}${v.label?' — '+v.label:''}`:product.title||'',
            sUrl(v.asin||product.asin),
          ]);
        });
        const wsV = XLSX.utils.aoa_to_sheet(vRows);
        wsV['!cols']=[
          {wch:4},{wch:12},{wch:22},
          ...dimKeys.map(()=>({wch:13})),
          {wch:12},{wch:12},
          {wch:14},{wch:6},
          {wch:7},{wch:40},
          {wch:60},{wch:28},
        ];
        wsV['!freeze']={xSplit:0,ySplit:1};
        XLSX.utils.book_append_sheet(wb,wsV,'📦 Variants');

        // ── SHEET 3: SEO Content — plain text, layout rõ ràng ───────────
        // Strip HTML tags → plain text có cấu trúc
        function htmlToPlain(html) {
          if (!html) return '';
          return html
            .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n── $1 ──\n')
            .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n▸ $1\n')
            .replace(/<li[^>]*>(.*?)<\/li>/gi, '  • $1\n')
            .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '$1')
            .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
            .replace(/\n{3,}/g,'\n\n')
            .trim();
        }

        const rawDesc  = ai?.description || product.description || '';
        const plainDesc = htmlToPlain(rawDesc);

        // Đếm dòng thực tế để tính row height
        const descLineCount = plainDesc ? plainDesc.split('\n').length : 1;
        const descHpt = Math.min(500, Math.max(30, descLineCount * 16));

        // Tách description thành từng dòng riêng để dễ đọc trong Excel
        const descLines = plainDesc ? plainDesc.split('\n') : [''];

        // Build SEO rows
        const seoRows = [
          ['FIELD', 'CONTENT'],
          ['', ''],
          ['── LISTING INFO ──', ''],
          ['eBay Title (AI)',  ai?.seoTitle || product.title || ''],
          ['Title Length',     `${(ai?.seoTitle||product.title||'').length}/80 chars`],
          ['eBay Category',    ai?.ebayCategory || ''],
          ['Search Tags',      ai?.searchTags?.join(' | ') || ''],
          ['', ''],
          ['── DESCRIPTION ──', '(plain text, copy-paste vào eBay)'],
          ...descLines.map(line => ['', line]),
          ['', ''],
          ['── BULLET POINTS ──', ''],
          ...blts.map((b,i) => [`• ${i+1}`, b]),
          ['', ''],
          ['── ORIGINAL (Amazon) ──', ''],
          ['Original Title',   product.title || ''],
          ['Original Desc',    product.description ? htmlToPlain(product.description) : ''],
          ['Original Bullets', (product.bullets||[]).join('\n• ')],
        ];

        const wsSeo = XLSX.utils.aoa_to_sheet(seoRows);
        wsSeo['!cols'] = [{wch:22}, {wch:100}];
        wsSeo['!freeze'] = {xSplit:0, ySplit:1};

        // Row heights + wrap text cho tất cả
        const rowHeights = [];
        let inDescBlock = false;
        seoRows.forEach((row, i) => {
          const label = row[0] || '';
          const val   = row[1] || '';
          if (label.includes('DESCRIPTION')) { inDescBlock = true; rowHeights.push({hpt:16}); return; }
          if (label.includes('BULLET') || label.includes('ORIGINAL') || (label==='' && val==='' && inDescBlock)) { inDescBlock=false; }
          const lineLen = String(val).length;
          const wrapped = Math.ceil(lineLen / 95) || 1;
          rowHeights.push({hpt: Math.min(60, Math.max(16, wrapped*16))});
        });
        wsSeo['!rows'] = rowHeights;

        // Wrap text + vertical top trên cột B, tất cả rows
        seoRows.forEach((row, ri) => {
          const ref = XLSX.utils.encode_cell({r:ri, c:1});
          if (wsSeo[ref]) {
            wsSeo[ref].s = wsSeo[ref].s || {};
            wsSeo[ref].s.alignment = {wrapText: true, vertical: 'top'};
          }
          // Bold column A section headers
          const refA = XLSX.utils.encode_cell({r:ri, c:0});
          if (wsSeo[refA] && String(row[0]).startsWith('──')) {
            wsSeo[refA].s = {font:{bold:true}, alignment:{vertical:'center'}};
          }
        });

        XLSX.utils.book_append_sheet(wb, wsSeo, '✍️ SEO');

        excelBlob=new Blob([XLSX.write(wb,{bookType:'xlsx',type:'array'})],
          {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      }
      setP(85,'✓ Excel xong');

      // 5. EXPORT — ZIP hoặc Folder tùy setting
      const now=new Date();
      const mm=String(now.getMonth()+1).padStart(2,'0');
      const dd=String(now.getDate()).padStart(2,'0');
      const hh=String(now.getHours()).padStart(2,'0');
      const mn=String(now.getMinutes()).padStart(2,'0');
      const ts=`${mm}${dd}_${hh}${mn}`;
      const baseFolder=(settings.outputFolder||'UKListing')+'/'+product.asin+'_'+ts;

      // Helper: blob → download via <a> (createObjectURL works on Amazon pages)
      const dlViaAnchor = async (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href=url; a.download=filename; a.style.display='none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url), 10000);
        await new Promise(r=>setTimeout(r,200));
      };

      if (settings.exportMode==='folder' && dirHandle) {
        // ── FOLDER MODE: ghi thẳng vào folder user đã chọn ──
        setP(88,'Đang ghi files...');

        // Tạo subfolder ASIN_ts bên trong folder user chọn
        const subDir = await dirHandle.getDirectoryHandle(product.asin+'_'+ts, { create: true });

        // Helper: ghi file vào nested path
        const writeFile = async (baseHandle, pathParts, blob) => {
          let current = baseHandle;
          for (let i = 0; i < pathParts.length - 1; i++) {
            current = await current.getDirectoryHandle(pathParts[i], { create: true });
          }
          const fh = await current.getFileHandle(pathParts[pathParts.length-1], { create: true });
          const wr = await fh.createWritable();
          await wr.write(blob);
          await wr.close();
        };

        const tasks = [];
        if (excelBlob) tasks.push({ blob: excelBlob, parts: ['product.xlsx'] });
        tasks.push({ blob: new Blob([JSON.stringify(product,null,2)],{type:'application/json'}), parts: ['data','raw.json'] });
        if (ai) tasks.push({ blob: new Blob([JSON.stringify(ai,null,2)],{type:'application/json'}), parts: ['data','ai.json'] });
        for (const img of imgFiles) {
          const b = await fetch('data:'+img.type+';base64,'+img.data).then(r=>r.blob()).catch(()=>null);
          if (b) tasks.push({ blob: b, parts: ['images',...img.path.split('/')] });
        }

        let wDone = 0;
        for (const t of tasks) {
          await writeFile(subDir, t.parts, t.blob);
          wDone++;
          setP(88+Math.round(wDone/tasks.length*11), `Ghi ${wDone}/${tasks.length} files...`);
        }
        setP(100, `✓ Đã lưu ${tasks.length} files`);

      } else {
        // ── ZIP MODE ───────────────────────────────────────────────────────
        setP(88,'Đóng gói ZIP...');
        if(typeof JSZip!=='undefined'){
          const zip=new JSZip();
          const root=product.asin+'_'+ts+'/';
          if(excelBlob) zip.file(root+'product.xlsx',excelBlob);
          zip.file(root+'data/raw.json',JSON.stringify(product,null,2));
          if(ai) zip.file(root+'data/ai.json',JSON.stringify(ai,null,2));
          for(const img of imgFiles) zip.file(root+'images/'+img.path,img.data,{base64:true});
          const zipBlob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
          const fname=product.asin+'_'+ts+'.zip';
          setP(98,'Đang tải '+fname+'...');
          await dlViaAnchor(zipBlob, fname);
          setP(100,'✓ Đã tải: '+fname);
        }
      }

      setTimeout(()=>{
        btn.disabled=false; btn.textContent='▶ EXPORT AGAIN';
        prog.style.display='none'; if(bar)bar.style.width='0';
      },3000);

    }catch(err){
      setP(0,'✕ '+err.message);
      btn.disabled=false; btn.textContent='▶ EXPORT';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGES (popup extension)
  // ══════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    if(msg.action==='PING'){
      const asin=getASIN();
      const isProduct=!!asin&&/\/dp\/[A-Z0-9]{10}/.test(location.pathname);
      if(!isProduct){sendResponse({isProduct:false});return true;}
      callMain('GET_COUNT').then(count=>{
        sendResponse({isProduct:true,asin,title:getTitle(),variantCount:count||0});
      });
      return true;
    }
    if(msg.action==='SCRAPE'||msg.action==='SCRAPE_FROM_PANEL'){
      scrapeProduct(p=>chrome.runtime.sendMessage({action:'SCRAPE_PROGRESS',progress:p}).catch(()=>{}))
        .then(data=>sendResponse({success:true,data}))
        .catch(err=>sendResponse({success:false,error:err.message}));
      return true;
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BOOT — document_start, dùng MutationObserver
  // ══════════════════════════════════════════════════════════════════════════

  watchAndDetect();

})();
