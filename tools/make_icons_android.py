#!/usr/bin/env python3
"""用主视觉生成 Android 各密度启动图标（方形 + 圆形）。"""
from PIL import Image, ImageDraw
import os

SRC = "web/assets/img/title_keyart.png"
OUT = "android/app/src/main/res"
DENS = {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}

def center_crop(im):
    w,h=im.size; s=min(w,h)
    return im.crop(((w-s)//2,(h-s)//2,(w-s)//2+s,(h-s)//2+s))

def rounded(im,radius):
    m=Image.new("L",im.size,0); d=ImageDraw.Draw(m)
    d.rounded_rectangle([0,0,im.size[0],im.size[1]],radius=radius,fill=255)
    out=Image.new("RGBA",im.size,(0,0,0,0)); out.paste(im,(0,0),m); return out

def main():
    src=center_crop(Image.open(SRC).convert("RGBA"))
    for name,px in DENS.items():
        d=os.path.join(OUT,f"mipmap-{name}"); os.makedirs(d,exist_ok=True)
        sq=src.resize((px,px),Image.LANCZOS)
        rounded(sq,int(px*0.18)).save(os.path.join(d,"ic_launcher.png"))
        m=Image.new("L",(px,px),0); ImageDraw.Draw(m).ellipse((0,0,px,px),fill=255)
        rd=Image.new("RGBA",(px,px),(0,0,0,0)); rd.paste(sq,(0,0),m)
        rd.save(os.path.join(d,"ic_launcher_round.png"))
        print("wrote",name,px)

if __name__=="__main__": main()
