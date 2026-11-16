// Marketing composition around real screenshots, explicitly requested by the user.
// No network access; screenshot pixels are embedded from local capture files.
const DATA = __SCREENSHOT_DATA__;

async function buildScreenshotSeries() {
  const fonts=await figma.listAvailableFontsAsync();
  const findFont=style=>{
    const found=fonts.find(f=>f.fontName.family==='Space Grotesk'&&f.fontName.style===style);
    if(!found)throw new Error('Missing font: Space Grotesk '+style);
    return found.fontName;
  };
  const regular=findFont('Regular'),medium=findFont('Medium'),bold=findFont('Bold');
  await Promise.all([regular,medium,bold].map(f=>figma.loadFontAsync(f)));
  let page=figma.root.children.find(p=>p.name==='Store screenshots · EN');
  if(page)await figma.setCurrentPageAsync(page);
  else {page=figma.createPage();page.name='Store screenshots · EN';await figma.setCurrentPageAsync(page);}
  const existing = new Map(page.children
    .filter(node => node.type === 'FRAME' && node.name.startsWith('SCREENSHOT / '))
    .map(node => [node.name, node]));
  const expected = Object.entries(DATA.storyboard.platforms).reduce((count, [platform]) =>
    count + DATA.available[platform].length, 0);
  const created=[];
  const own=n=>{created.push(n.id);return n;};
  const brandMarkName = 'WhoAped / Brand mark';
  const brandMarkVersion = 'scaled-vector-v1';
  function applyBrandMark(parent, x, y, size) {
    const previous = parent.children.find(node => node.name === brandMarkName);
    if (previous?.getPluginData('brand-mark-render') === brandMarkVersion) return previous;

    const mark = own(figma.createNodeFromSvg(DATA.brandSvg));
    // Scale the strokes along with the paths. Resizing the SVG frame leaves the strokes too wide.
    mark.rescale(size / mark.width);
    const strokes = mark.children.filter(node => node.type === 'VECTOR' && node.strokes.length > 0);
    if (strokes.length !== 2 || strokes.some(node => typeof node.strokeWeight !== 'number' || node.strokeWeight > size / 10)) {
      mark.remove();
      throw new Error('WhoAped logo strokes did not scale correctly.');
    }
    mark.name = brandMarkName;
    mark.setPluginData('brand-mark-render', brandMarkVersion);
    parent.insertChild(previous ? parent.children.indexOf(previous) : parent.children.length, mark);
    mark.x = x;
    mark.y = y;
    previous?.remove();
    return mark;
  }
  const color=hex=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
  const C={paper:'#F4F4EF',ink:'#111313',quiet:'#5A605D',white:'#FFFFFF',orange:'#F04B2F',light:'#B5BFB7',rule:'#D8DCD5',darkRule:'#343B36'};
  const fill=key=>[{type:'SOLID',color:color(C[key]||key)}];
  function frame(parent,name,w,h,key){const n=own(figma.createFrame());n.name=name;n.resize(w,h);n.fills=key?fill(key):[];parent.appendChild(n);return n;}
  function shape(parent,name,x,y,w,h,key,r=0){const n=own(figma.createRectangle());n.name=name;n.resize(w,h);parent.appendChild(n);n.x=x;n.y=y;n.fills=fill(key);n.cornerRadius=r;return n;}
  function type(parent,name,copy,size,key,weight='regular',width){
    const n=own(figma.createText());n.fontName=weight==='bold'?bold:weight==='medium'?medium:regular;n.name=name;n.fontSize=size;
    n.lineHeight={unit:'PERCENT',value:104};n.letterSpacing={unit:'PERCENT',value:weight==='bold'?-3.8:-1};n.characters=copy;n.fills=fill(key);
    parent.appendChild(n);if(width){n.textAutoResize='HEIGHT';n.resize(width,n.height);}return n;
  }
  function stack(parent,name,w,gap){const n=frame(parent,name,w,1);n.layoutMode='VERTICAL';n.primaryAxisSizingMode='AUTO';n.counterAxisSizingMode='FIXED';n.itemSpacing=gap;n.clipsContent=false;return n;}
  function bytes(base64){
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let bits=0,value=0,out=[];
    for(const c of base64){const k=alphabet.indexOf(c);if(k<0)continue;value=(value<<6)|k;bits+=6;if(bits>=8){bits-=8;out.push((value>>bits)&255);}}
    return new Uint8Array(out);
  }
  const hashes={};
  for(const [key,asset] of Object.entries(DATA.assets))hashes[key]=figma.createImage(bytes(asset.base64)).hash;

  const shells={};
  function makeShell(platform,ratio){
    const name='Device / '+platform;
    const prior=page.children.find(node=>node.type==='COMPONENT'&&node.name===name);
    if(prior){shells[platform]=prior;return prior;}
    const tablet=platform==='apple-ipad';const comp=own(figma.createComponent());comp.name=name;comp.description='Editable generic '+(tablet?'tablet':platform==='solana-mobile'?'Android phone':'iPhone-style phone')+' presentation. Replace the App screenshot image fill with a real matching-platform capture.';
    const sw=tablet?1500:940,bezel=tablet?34:30,top=tablet?34:32,sh=sw/ratio;
    comp.resize(sw+2*bezel,sh+2*top);comp.x=29000;comp.y=Object.keys(shells).length*2800;comp.fills=fill('ink');comp.cornerRadius=tablet?78:142;
    comp.strokes=fill('#5B625D');comp.strokeWeight=3;
    const screen=frame(comp,'App screenshot',sw,sh);screen.x=bezel;screen.y=top;screen.cornerRadius=tablet?48:112;screen.clipsContent=true;
    if(!tablet){
      if(platform.startsWith('apple-iphone'))shape(comp,'Device camera island',comp.width/2-110,top+27,220,64,'ink',32);
      else {const camera=own(figma.createEllipse());camera.name='Device camera';camera.resize(26,26);camera.fills=fill('ink');comp.appendChild(camera);camera.x=comp.width/2-13;camera.y=top+22;}
      shape(comp,'Volume / upper',-6,320,6,108,'#5B625D',3);shape(comp,'Volume / lower',-6,460,6,108,'#5B625D',3);shape(comp,'Power',comp.width,415,6,166,'#5B625D',3);
    }
    comp.effects=[{type:'DROP_SHADOW',color:{...color('#111313'),a:.17},offset:{x:0,y:28},radius:55,spread:0,visible:true,blendMode:'NORMAL'}];
    shells[platform]=comp;return comp;
  }
  const formats=Object.entries(DATA.storyboard.platforms);
  const platformY={'apple-iphone':500,'apple-iphone-large':3600,'apple-ipad':7000,'solana-mobile':10200};
  const exports=[];
  for(const [platform,format] of formats){
    const shots=DATA.available[platform];
    if(!shots.length)continue;
    const source=DATA.assets[format.capturePlatform+'/'+shots[0].capture];
    const shell=makeShell(platform,source.width/source.height);
    let x=200;
    if(!page.children.some(n=>n.type==='TEXT'&&n.name===platform+' / Label')) {
      const rowLabel=type(page,platform+' / Label',platform==='apple-iphone'?'App Store / iPhone · 1206 × 2622':platform==='apple-iphone-large'?'App Store / iPhone Max · 1320 × 2868':platform==='apple-ipad'?'App Store / iPad · 2064 × 2752':'Solana Mobile dApp Store · 1080 × 1920',48,'ink','bold');rowLabel.x=x;rowLabel.y=platformY[platform]-120;
    }
    for(const shot of shots){
      const w=format.width,h=format.height,dark=shot.tone==='ink',ink=dark?'paper':'ink',quiet=dark?'light':'quiet';
      const name='SCREENSHOT / '+platform+' / '+shot.id;
      const tablet=platform==='apple-ipad',android=platform==='solana-mobile',margin=tablet?120:android?72:88;
      const brandSize=tablet?62:android?42:49;
      const brandY=tablet?80:android?68:86;
      const prior = existing.get(name);
      if (prior) {
        const mark = prior.children.find(node => node.name === brandMarkName);
        applyBrandMark(prior, mark?.x ?? margin, mark?.y ?? brandY, mark?.width ?? (brandSize + 6));
        exports.push(prior);
        x += w + 160;
        continue;
      }
      const out=frame(page,name,w,h,dark?'ink':'paper');out.x=x;out.y=platformY[platform];out.clipsContent=true;out.exportSettings=[{format:'JPG',constraint:{type:'SCALE',value:1},suffix:''}];
      applyBrandMark(out, margin, brandY, brandSize + 6);
      const brand=type(out,'WhoAped / Wordmark','WhoAped',brandSize,ink,'bold');brand.x=margin+brandSize+20;brand.y=brandY;
      shape(out,'Ledger rule',margin,tablet?184:android?148:178,w-2*margin,2,dark?'darkRule':'rule');
      const headline=stack(out,'Headline / benefit / action',w-2*margin,tablet?28:android?22:28);headline.x=margin;headline.y=tablet?252:android?205:250;
      type(headline,'Headline / editable',shot.title,tablet?145:android?97:119,ink,'bold',w-2*margin);
      const body=type(headline,'Benefit / editable',shot.subtitle,tablet?49:android?34:40,quiet,'regular',w-2*margin);body.lineHeight={unit:'PERCENT',value:125};
      shape(out,'Brand accent',margin,headline.y+headline.height+26,46,6,'orange',3);
      const device=own(shell.createInstance());out.appendChild(device);device.name='Device / real '+format.capturePlatform+' capture';
      const deviceY=Math.max(Math.round(h*.276),headline.y+headline.height+83);
      const footer=android?51:67;
      const scale=Math.min(w*(tablet?.88:.82)/shell.width,(h-deviceY-footer)/shell.height);
      device.rescale(scale);
      device.x=(w-device.width)/2+(shot.layout==='offset'?w*.035:0);
      device.y=deviceY;
      const app= device.findOne(n=>n.name==='App screenshot');app.fills=[{type:'IMAGE',imageHash:hashes[format.capturePlatform+'/'+shot.capture],scaleMode:'FILL'}];
      exports.push(out);x+=w+160;
    }
  }
  const report=exports.map(f=>{
    const nodes=f.findAll(()=>true),texts=nodes.filter(n=>n.type==='TEXT'),screens=nodes.filter(n=>n.name==='App screenshot');
    const headline=f.findOne(n=>n.name==='Headline / benefit / action');
    const device=f.findOne(n=>n.name.startsWith('Device / real '));
    return {id:f.id,name:f.name,width:f.width,height:f.height,editableTextCount:texts.length,fontFamilies:[...new Set(texts.map(n=>n.fontName.family))],realAppScreenshotCount:screens.length,headlineBottom:headline.y+headline.height,deviceTop:device.y,headlineClearOfDevice:headline.y+headline.height+24<=device.y};
  });
  if(report.length!==expected||report.some(r=>r.fontFamilies.length!==1||r.fontFamilies[0]!=='Space Grotesk'||r.editableTextCount<3||r.realAppScreenshotCount!==1||!r.headlineClearOfDevice))throw new Error('Composition validation failed: '+JSON.stringify(report));
  const logoCount = exports.filter(frame => frame.children.some(node => node.name === brandMarkName && node.getPluginData('brand-mark-render') === brandMarkVersion)).length;
  if (logoCount !== expected) throw new Error(`Only ${logoCount} of ${expected} WhoAped logos passed validation.`);
  page.backgrounds=fill('#CDD1CB');figma.currentPage.selection=exports;figma.viewport.scrollAndZoomIntoView(exports.filter(f=>f.name.includes('/ apple-iphone /')));
  const ui='<html><body style="font:14px system-ui;background:#f4f4ef;padding:22px;color:#111313"><h2>WhoAped / '+expected+' store screenshots</h2><p>'+logoCount+' vector logos verified.</p>'+['apple-iphone','apple-iphone-large','apple-ipad','solana-mobile','all'].map(p=>'<button style="margin:5px;padding:10px" onclick="parent.postMessage({pluginMessage:{type:\'review\',platform:\''+p+'\'}},\'*\')">'+p+'</button>').join('')+'<button style="margin:5px;padding:10px" onclick="parent.postMessage({pluginMessage:{type:\'close\'}},\'*\')">Close</button><details><summary>Validation</summary><pre style="white-space:pre-wrap;font-size:11px">'+JSON.stringify({frames:report,createdNodeIds:created},null,2)+'</pre></details></body></html>';
  figma.showUI(ui,{width:620,height:360});
  figma.ui.onmessage=m=>{if(m.type==='close')figma.closePlugin();else if(m.type==='review'){const group=m.platform==='all'?exports:exports.filter(f=>f.name.includes('/ '+m.platform+' /'));figma.currentPage.selection=group;figma.viewport.scrollAndZoomIntoView(group);}};
}
buildScreenshotSeries().catch(error=>figma.showUI('<p style="font:15px system-ui;padding:22px">'+String(error.message).replace(/</g,'&lt;')+'</p>',{width:620,height:300}));
