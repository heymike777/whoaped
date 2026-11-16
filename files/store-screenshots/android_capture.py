"""Developer-side capture helper for the dedicated WhoAped Android emulator."""
from pathlib import Path
import json, re, subprocess, sys, xml.etree.ElementTree as ET

ADB='/Users/heymike/Library/Android/sdk/platform-tools/adb'
DEVICE='emulator-5554'
LOCAL=Path('/tmp/whoaped-android-ui.xml')

def adb(*args, binary=False):
    p=subprocess.run([ADB,'-s',DEVICE,*args],capture_output=True,check=True)
    return p.stdout if binary else p.stdout.decode()

def dump():
    adb('shell','uiautomator','dump','/sdcard/whoaped-capture.xml')
    adb('pull','/sdcard/whoaped-capture.xml',str(LOCAL))
    return list(ET.parse(LOCAL).iter('node'))

def summary(nodes):
    return [{'text':n.get('text') or n.get('content-desc'),'class':n.get('class').rsplit('.',1)[-1],'bounds':n.get('bounds'),'focused':n.get('focused')} for n in nodes if n.get('text') or n.get('content-desc')]

def tap(label):
    nodes=dump()
    matches=[n for n in nodes if n.get('text')==label or n.get('content-desc')==label]
    if not matches: raise RuntimeError('Not present: '+label+'\n'+json.dumps(summary(nodes)))
    n=next((n for n in matches if n.get('clickable')=='true'),matches[0])
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
    adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
    return dump()

def type_text(value):
    adb('shell','input','text',value.replace(' ','%s'))
    return dump()

def back():
    adb('shell','input','keyevent','4')
    return dump()

def capture(name):
    out=Path(__file__).parent/'captures'/'android'/(name+'.png')
    out.write_bytes(adb('exec-out','screencap','-p',binary=True))
    print('Saved',out)

if __name__=='__main__':
    command=sys.argv[1]
    if command=='dump': print(json.dumps(summary(dump()),indent=2))
    elif command=='tap': print(json.dumps(summary(tap(sys.argv[2])),indent=2))
    elif command=='type': print(json.dumps(summary(type_text(sys.argv[2])),indent=2))
    elif command=='back': print(json.dumps(summary(back()),indent=2))
    elif command=='capture': capture(sys.argv[2])
    elif command=='launch':
        adb('shell','am','start','-n','com.whoaped.app/com.whoaped.MainActivity')
        print(json.dumps(summary(dump()),indent=2))
