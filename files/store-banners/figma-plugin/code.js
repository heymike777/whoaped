// Native, editable artwork. Run in the dedicated WhoAped store banner file.
async function main() {
  const fonts = await figma.listAvailableFontsAsync();
  const font = (style) => {
    const found = fonts.find(f => f.fontName.family === 'Space Grotesk' && f.fontName.style === style);
    if (!found) throw new Error('Required font unavailable: Space Grotesk ' + style);
    return found.fontName;
  };
  const regular = font('Regular'), bold = font('Bold'), medium = font('Medium');
  await Promise.all([regular, bold, medium].map(f => figma.loadFontAsync(f)));
  const page = figma.currentPage;
  if (page.children.some(n => n.name === '01 — Apple · Product page header · 3840×1646'))
    throw new Error('Artwork already exists. This command does not create duplicate banners.');
  if (page.children.length) throw new Error('Please run in the empty WhoAped banner page.');
  page.name = 'Store banners · EN';
  page.backgrounds = [{type:'SOLID',color:{r:.80,g:.81,b:.79}}];
  const created = [];
  function record(n) { created.push(n.id); return n; }
  const hex = (v) => ({r:parseInt(v.slice(1,3),16)/255,g:parseInt(v.slice(3,5),16)/255,b:parseInt(v.slice(5,7),16)/255});
  const palette = {paper:'#F4F4EF',sheet:'#FFFFFF',ink:'#111313',quiet:'#5A605D',orange:'#F04B2F',green:'#137A52',blue:'#4055D9',rule:'#D8DCD5',darkRule:'#343B36',darkQuiet:'#B5BFB7'};
  const collection = figma.variables.createVariableCollection('WhoAped · The Live Ledger');
  const variables = {};
  for (const [name,value] of Object.entries(palette)) {
    const v = figma.variables.createVariable(name,collection,'COLOR');
    v.scopes = ['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR'];
    v.setValueForMode(collection.defaultModeId,hex(value));
    variables[name] = v;
  }
  const paint = name => figma.variables.setBoundVariableForPaint({type:'SOLID',color:hex(palette[name])},'color',variables[name]);
  function rect(parent,name,x,y,w,h,color) {
    const n=record(figma.createRectangle()); n.name=name; parent.appendChild(n); n.resize(w,h); n.x=x;n.y=y;n.fills=[paint(color)];return n;
  }
  function text(parent,name,copy,size,color='ink',weight='regular') {
    const n=record(figma.createText()); n.fontName=weight==='bold'?bold:weight==='medium'?medium:regular;
    n.name=name;n.fontSize=size;n.lineHeight={unit:'PERCENT',value:108};n.letterSpacing={unit:'PERCENT',value:-3};
    n.characters=copy;n.fills=[paint(color)];parent.appendChild(n);return n;
  }
  function stack(parent,name,x,y,w,gap) {
    const n=record(figma.createFrame());n.name=name;n.fills=[];n.layoutMode='VERTICAL';
    n.primaryAxisSizingMode='AUTO';n.counterAxisSizingMode='FIXED';n.resize(w,1);n.itemSpacing=gap;
    parent.appendChild(n);n.x=x;n.y=y;return n;
  }
  function widthText(parent,name,copy,size,color,weight,w) {
    const n=text(parent,name,copy,size,color,weight);n.textAutoResize='HEIGHT';n.resize(w,n.height);return n;
  }
  function banner(name,x,y,w,h,color,filename) {
    const n=record(figma.createFrame());n.name=name;n.resize(w,h);n.x=x;n.y=y;n.fills=[paint(color)];n.clipsContent=true;
    n.exportSettings=[{format:'JPG',constraint:{type:'SCALE',value:1},suffix:''}];
    return n;
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none"><rect width="1024" height="1024" fill="#111313"/><path d="M362 204H250C224 204 204 224 204 250V362M662 204H774C800 204 820 224 820 250V362M362 820H250C224 820 204 800 204 774V662M662 820H774C800 820 820 800 820 774V662" stroke="#F4F4EF" stroke-width="76" stroke-linecap="round"/><path d="M322 512C370 426 432 382 512 382C592 382 654 426 702 512C654 598 592 642 512 642C432 642 370 598 322 512Z" stroke="#F4F4EF" stroke-width="66" stroke-linejoin="round"/><circle cx="512" cy="512" r="58" fill="#F04B2F"/></svg>';
  const mark = record(figma.createComponent());mark.name='Brand / Detected mark';mark.description='Exact WhoAped Detected mark from files/whoaped-app-icon.svg. Preserve geometry and source colors.';
  mark.resize(1024,1024);mark.fills=[];mark.x=8400;mark.y=0;
  const vector=record(figma.createNodeFromSvg(svg));mark.appendChild(vector);vector.x=0;vector.y=0;
  vector.findAll(()=>true).forEach(n=>created.push(n.id));
  function logo(parent,x,y,size) {const n=record(mark.createInstance());parent.appendChild(n);n.rescale(size/1024);n.x=x;n.y=y;return n;}
  function wordmark(parent,x,y,size,color='ink') {const n=text(parent,'WhoAped / Wordmark','WhoAped',size,color,'bold');n.x=x;n.y=y;return n;}
  function rule(parent,x,y,w,color='rule') {return rect(parent,'Ledger rule',x,y,w,2,color);}
  function dot(parent,x,y,size,color) {const n=record(figma.createEllipse());parent.appendChild(n);n.name='Activity signal';n.resize(size,size);n.x=x;n.y=y;n.fills=[paint(color)];return n;}
  const exports=[];
  // Apple template safe zone: x1097 y493 w1646 h661.
  const header=banner('01 — Apple · Product page header · 3840×1646',0,0,3840,1646,'ink');exports.push(header);
  for (const y of [245,410,1236,1401]) rule(header,0,y,3840,'darkRule');
  rect(header,'Ledger margin / left',780,0,2,1646,'darkRule');
  rect(header,'Ledger margin / right',3060,0,2,1646,'darkRule');
  logo(header,1104,600,440);
  const hero=stack(header,'Brand and promise / inside Apple safe area',1604,582,1090,30);
  widthText(hero,'WhoAped / Wordmark','WhoAped',174,'paper','bold',1090);
  widthText(hero,'Brand promise','Every wallet move.\nClearly.',92,'paper','medium',1090);
  // Search template safe zone: x836 y765 w2168 h1030.
  const search=banner('02 — Apple · Search results · 3840×2560',0,2000,3840,2560,'paper');exports.push(search);
  for(const y of [480,650,1910,2080]) rule(search,0,y,3840);
  rect(search,'Ledger margin / left',600,0,2,2560,'rule');rect(search,'Ledger margin / right',3240,0,2,2560,'rule');
  wordmark(search,896,794,76);
  const title=stack(search,'Purpose and value / inside Apple safe area',896,987,1310,70);
  widthText(title,'Search headline','Wallet activity.\nIn plain sight.',168,'ink','bold',1310);
  widthText(title,'Primary feature','Track Solana wallets.\nGet live alerts.',57,'quiet','regular',1310);
  const track=stack(search,'Decoded activity / editorial categories',2330,846,580,44);
  logo(track,0,0,250);
  const categories=stack(track,'Activity categories',0,0,580,30);
  for (const label of ['Swaps','Yield','Launches']) {
    const row=record(figma.createFrame());row.name='Activity / '+label;row.layoutMode='HORIZONTAL';row.primaryAxisSizingMode='FIXED';row.counterAxisSizingMode='AUTO';row.resize(580,1);row.fills=[];row.itemSpacing=28;row.counterAxisAlignItems='CENTER';categories.appendChild(row);
    dot(row,0,0,14,label==='Swaps'?'blue':label==='Yield'?'green':'orange');text(row,label,label,60,'ink','medium');
  }
  const safety=text(search,'Watch-only product statement','Watch-only. No private keys.',43,'quiet');safety.x=896;safety.y=1670;
  // dApp listing: keep the bottom band clear for store-owned app icon overlays.
  const solana=banner('03 — Solana · Listing banner · 1200×600',4300,0,1200,600,'paper');exports.push(solana);
  wordmark(solana,72,64,44);
  const st=stack(solana,'Solana banner copy',72,172,700,28);
  widthText(st,'Headline','Follow wallets.\nRead every move.',69,'ink','bold',700);
  widthText(st,'Description','Solana activity, decoded.',29,'quiet','regular',700);
  logo(solana,830,88,300);
  rule(solana,72,451,1056);
  // Editor's Choice is a placement label only; do not claim an award in artwork.
  const square=banner('04 — Solana · Editors Choice feature graphic · 1200×1200',4300,950,1200,1200,'ink');exports.push(square);
  wordmark(square,80,66,54,'paper');
  const sq=stack(square,'Editorial headline',80,221,1040,20);
  widthText(sq,'Headline','Keep up with\nwallets.',102,'paper','bold',1040);
  logo(square,360,550,480);
  rule(square,80,1068,1040,'darkRule');
  const foot=text(square,'Purpose','Solana wallet activity, decoded.',35,'paper');foot.x=80;foot.y=1100;
  // Separate guide copies: never included in delivery exports.
  const guides=[{node:header,x:1097,y:493,w:1646,h:661},{node:search,x:836,y:765,w:2168,h:1030}];
  const guideFrames=[];
  for (const g of guides) {
    const clone=record(g.node.clone());clone.name='GUIDE ONLY — '+g.node.name;clone.x=9000;clone.y=g.node.y;clone.exportSettings=[];
    clone.findAll(()=>true).forEach(n=>created.push(n.id));
    const safe=record(figma.createRectangle());safe.name='Apple official art safe area — hidden before export';safe.resize(g.w,g.h);safe.x=g.x;safe.y=g.y;
    safe.fills=[{type:'SOLID',color:{r:0,g:.8,b:.5},opacity:.06}];safe.strokes=[{type:'SOLID',color:{r:0,g:.8,b:.5}}];safe.strokeWeight=5;clone.appendChild(safe);guideFrames.push(clone);
  }
  const notes=stack(page,'Specifications and handoff · not an export',4300,2500,1650,36);notes.paddingTop=72;notes.paddingRight=72;notes.paddingBottom=72;notes.paddingLeft=72;notes.fills=[paint('sheet')];
  widthText(notes,'Title','WhoAped\nStore artwork',88,'ink','bold',1506);
  widthText(notes,'Context','Four original English compositions · The Live Ledger\nPrepared 7 November 2026 · Personal Team',31,'quiet','regular',1506);
  const info=[
    ['Apple — Product page header','3840 × 1646 px · 21:9\nOfficial safe area: x1097, y493, 1646 × 661 px.'],
    ['Apple — Search results','3840 × 2560 px · 3:2\nOfficial safe area: x836, y765, 2168 × 1030 px.'],
    ['Solana — Listing banner','1200 × 600 px · 2:1\nLower band intentionally clear for the store app icon overlay.'],
    ['Solana — Feature graphic','1200 × 1200 px · 1:1\nPrepared for editorial featuring. Placement is subject to Solana Mobile selection.'],
    ['Export','Select the four numbered frames and export at 1× JPG.\nOpaque sRGB artwork; no alpha channel. Guide copies are separate.\nAll type is editable Space Grotesk. Logo is an editable vector component.'],
    ['Sources','developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications\ndeveloper.apple.com/app-store/asset-best-practices/\ndocs.solanamobile.com/dapp-store/listing-page-guidelines\ngithub.com/solana-mobile/dapp-publishing/blob/main/publishing-spec/SPEC.md'],
    ['Safe areas','Guide copies to the right use the art-safe-area bounds read from Apple’s official Photoshop templates. All critical Apple content is inside these bounds.']
  ];
  for(const [heading,copy] of info) {const s=stack(notes,heading,0,0,1506,16);widthText(s,'Heading',heading,37,'ink','bold',1506);widthText(s,'Details',copy,28,'quiet','regular',1506);}
  const report=exports.map(f=>{
    const all=f.findAll(()=>true),counts={};for(const n of all)counts[n.type]=(counts[n.type]||0)+1;
    const texts=all.filter(n=>n.type==='TEXT');
    return {id:f.id,name:f.name,width:f.width,height:f.height,counts,fonts:[...new Set(texts.map(n=>n.fontName.family))],imageFilledNodes:all.filter(n=>Array.isArray(n.fills)&&n.fills.some(p=>p.type==='IMAGE')).map(n=>n.id)};
  });
  figma.currentPage.selection=exports;
  figma.viewport.scrollAndZoomIntoView(exports);
  figma.showUI('<html><body style="font:14px system-ui;padding:20px;background:#f4f4ef;color:#111313"><h2>WhoAped artwork created</h2><p>4 editable banners · Space Grotesk · vector logo · JPG export at 1×.</p><p>All critical Apple content fits the official template safe areas. Green guide copies on the right are separate from exports.</p><pre style="white-space:pre-wrap;font-size:11px">'+JSON.stringify({createdNodeIds:created,frames:report},null,2)+'</pre><button onclick="parent.postMessage({pluginMessage:{type:\'close\'}},\'*\')">Close</button></body></html>',{width:600,height:600});
  figma.ui.onmessage=msg=>{if(msg.type==='close')figma.closePlugin();};
}
main().catch(error=>{figma.showUI('<p style="font:15px system-ui;padding:24px">'+String(error.message).replace(/</g,'&lt;')+'</p>',{width:500,height:240});});
