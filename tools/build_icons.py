#!/usr/bin/env python3
"""把 AI 生成的 4x2 物品表切成 48 个透明底图标，并处理生成器令牌。
算法：逐格用边缘像素估计本地背景色 -> 颜色距离候选 -> 只删除与格子边缘连通的背景，
从而既能吃掉渐变底，又保护被描边围住的浅色（冰晶）图标内部。"""
import os
from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), "..")
IMG = os.path.join(ROOT, "web", "assets", "img")
ITEM_OUT = os.path.join(IMG, "items")
os.makedirs(ITEM_OUT, exist_ok=True)
FAMILIES = ["crystal", "fire", "drink", "cloth", "wood", "food"]


def strip_background(rgb, thresh=58, band=14):
    arr = np.asarray(rgb).astype(np.int16)
    h, w, _ = arr.shape
    # 边缘环像素估计本地背景色（用中位数抗图标越界干扰）
    ring = np.concatenate([
        arr[:band, :, :].reshape(-1, 3), arr[-band:, :, :].reshape(-1, 3),
        arr[:, :band, :].reshape(-1, 3), arr[:, -band:, :].reshape(-1, 3),
    ])
    bg = np.median(ring, axis=0)
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    candidate = dist < thresh  # 像背景的像素
    # 只保留与边缘连通的背景块
    lbl, n = ndimage.label(candidate, structure=np.ones((3, 3)))
    border_ids = np.unique(np.concatenate([
        lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]]))
    border_ids = border_ids[border_ids != 0]
    bgmask = np.isin(lbl, border_ids)
    alpha = np.where(bgmask, 0, 255).astype("uint8")
    # 轻微收边再羽化，避免蓝边
    alpha = ndimage.binary_erosion(alpha > 0, iterations=1) * 255
    alpha = np.asarray(alpha, dtype="uint8")
    a = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.7))
    out = Image.fromarray(np.asarray(rgb)).convert("RGBA")
    out.putalpha(a)
    return out


def fit_square(im, size=512, pad=26):
    bbox = im.getbbox()
    im = im.crop(bbox)
    target = size - pad * 2
    im.thumbnail((target, target), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


for fam in FAMILIES:
    sheet = Image.open(os.path.join(IMG, f"sheet_{fam}.png")).convert("RGB")
    W, H = sheet.size
    cols, rows = 4, 2
    cw, ch = W // cols, H // rows
    for i in range(8):
        r, c = divmod(i, cols)
        cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        icon = fit_square(strip_background(cell))
        icon.save(os.path.join(ITEM_OUT, f"{fam}_{i+1}.png"), optimize=True)
    print(f"{fam}: 8 icons")

for fam in FAMILIES:
    g = Image.open(os.path.join(IMG, f"gen_{fam}.png")).convert("RGB")
    tok = fit_square(strip_background(g, thresh=52), size=512, pad=8)
    tok.save(os.path.join(IMG, f"token_{fam}.png"), optimize=True)
    print(f"token_{fam}")
print("ALL DONE")
