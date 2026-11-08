"""Rebuild WhoAped's four store creatives using the checked-in brand fonts."""
from pathlib import Path
from html import escape
import io
import json
from PIL import Image, ImageDraw, ImageFont
import resvg_py

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
FONTS = ROOT / 'apps/mobile/assets/fonts'
PAPER, INK, QUIET = '#F4F4EF', '#111313', '#5A605D'
RULE, DARK_RULE = '#D8DCD5', '#343B36'
MARK = (ROOT / 'files/whoaped-app-icon.svg').read_text()
MARK_INNER = MARK[MARK.index('<rect'):MARK.rindex('</svg>')]

def rect(x,y,w,h,fill):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>'

def mark(x,y,size):
    return f'<g id="WhoAped-Detected-mark" transform="translate({x} {y}) scale({size/1024})">{MARK_INNER}</g>'

def text(x,y,copy,size,fill=INK,weight=400,tracking=-.03):
    # y is the top of the em box, shared with the Figma native build.
    font=ImageFont.truetype(str(FONTS / ('SpaceGrotesk-Bold.ttf' if weight==700 else 'SpaceGrotesk-Medium.ttf' if weight==500 else 'SpaceGrotesk-Regular.ttf')),size)
    asc,_ = font.getmetrics()
    lines=copy.split('\n')
    spans=''.join(f'<tspan x="{x}" y="{y+asc+i*size*1.08}">{escape(line)}</tspan>' for i,line in enumerate(lines))
    return f'<text font-family="Space Grotesk" font-weight="{weight}" font-size="{size}" letter-spacing="{size*tracking}" fill="{fill}">{spans}</text>'

def svg(w,h,body,title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><title>{escape(title)}</title>{body}</svg>'

def save(name,w,h,body,title):
    source=svg(w,h,body,title)
    (OUT / f'{name}.svg').write_text(source)
    png=resvg_py.svg_to_bytes(svg_string=source,font_dirs=[str(FONTS)])
    image=Image.open(io.BytesIO(png)).convert('RGB')
    image.save(OUT / f'{name}.png')
    image.save(OUT / f'{name}.jpg',quality=97,subsampling=0)
    return image

header=rect(0,0,3840,1646,INK)
header+=''.join(rect(0,y,3840,2,DARK_RULE) for y in [245,410,1236,1401])
header+=rect(780,0,2,1646,DARK_RULE)+rect(3060,0,2,1646,DARK_RULE)
header+=mark(1104,600,440)+text(1604,582,'WhoAped',174,PAPER,700)
header+=text(1604,800,'Every wallet move.\nClearly.',92,PAPER,500)

search=rect(0,0,3840,2560,PAPER)
search+=''.join(rect(0,y,3840,2,RULE) for y in [480,650,1910,2080])
search+=rect(600,0,2,2560,RULE)+rect(3240,0,2,2560,RULE)
search+=text(896,794,'WhoAped',76,INK,700)
search+=text(896,987,'Wallet activity.\nIn plain sight.',168,INK,700)
search+=text(896,1420,'Track Solana wallets.\nGet live alerts.',57,QUIET)
search+=text(896,1670,'Watch-only. No private keys.',43,QUIET)
search+=mark(2330,846,250)
for i,(label,color) in enumerate([('Swaps','#4055D9'),('Yield','#137A52'),('Launches','#F04B2F')]):
    y=1154+i*107
    search+=f'<circle cx="2340" cy="{y+39}" r="7" fill="{color}"/>'+text(2372,y,label,60,INK,500)

listing=rect(0,0,1200,600,PAPER)+text(72,64,'WhoAped',44,INK,700)
listing+=text(72,172,'Follow wallets.\nRead every move.',69,INK,700)
listing+=text(72,357,'Solana activity, decoded.',29,QUIET)
listing+=mark(830,88,300)+rect(72,451,1056,2,RULE)

feature=rect(0,0,1200,1200,INK)+text(80,66,'WhoAped',54,PAPER,700)
feature+=text(80,221,'Keep up with\nwallets.',102,PAPER,700)
feature+=mark(360,550,480)+rect(80,1068,1040,2,DARK_RULE)
feature+=text(80,1100,'Solana wallet activity, decoded.',35,PAPER)

data=[('01-apple-header',3840,1646,header,'WhoAped — Product page header'),('02-apple-search',3840,2560,search,'WhoAped — Search results'),('03-solana-listing-banner',1200,600,listing,'WhoAped — Solana listing banner'),('04-solana-feature-graphic',1200,1200,feature,'WhoAped — Solana editorial feature graphic')]
images=[save(*item) for item in data]
for name,w,h,body,title in data[:2]:
    x,y,sw,sh=(1097,493,1646,661) if 'header' in name else (836,765,2168,1030)
    overlay=f'<rect x="{x}" y="{y}" width="{sw}" height="{sh}" fill="#00CC80" fill-opacity=".07" stroke="#00CC80" stroke-width="6"/>'
    (OUT / f'{name}-SAFE-AREA.svg').write_text(svg(w,h,body+overlay,title+' — safe area guide only'))

# Contact sheet with labels outside artwork.
sheet=Image.new('RGB',(1800,1900),'#CDD1CB')
d=ImageDraw.Draw(sheet)
label=ImageFont.truetype(str(FONTS/'SpaceGrotesk-Medium.ttf'),25)
for im,(x,y,w,h),caption in zip(images,[(50,100,1120,480),(50,690,1120,747),(1220,100,530,265),(1220,475,530,530)],['Apple · Header · 3840 × 1646','Apple · Search · 3840 × 2560','Solana · Listing · 1200 × 600','Solana · Feature · 1200 × 1200']):
    d.text((x,y-43),caption,font=label,fill=INK)
    sheet.paste(im.resize((w,h),Image.Resampling.LANCZOS),(x,y))
d.text((50,1535),'WhoAped / The Live Ledger',font=ImageFont.truetype(str(FONTS/'SpaceGrotesk-Bold.ttf'),62),fill=INK)
d.text((50,1630),'Four original store compositions · English · 7 November 2026',font=label,fill=QUIET)
d.text((50,1680),'Critical Apple content stays within official art-safe-area bounds.',font=label,fill=QUIET)
d.text((50,1730),'Opaque RGB exports · Exact source logo · Original SVG and native Figma source',font=label,fill=QUIET)
sheet.save(OUT/'preview.jpg',quality=94)
report={name:{'width':im.width,'height':im.height,'mode':im.mode,'jpgBytes':(OUT/f'{name}.jpg').stat().st_size} for (name,*_),im in zip(data,images)}
(OUT/'export-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
