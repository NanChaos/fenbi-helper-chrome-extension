# -*- coding: utf-8 -*-
"""纯标准库处理图标：解码 PNG -> 定位圆角方块 -> 抠圆角透明 -> 缩放 -> 编码 PNG"""
import zlib, struct, sys, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'A_minimal_flat_app_icon_for_a__2026-10-08T11-22-32.png')
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


# ---------------- PNG 解码 ----------------

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos, idat, plte, trns = 8, b'', None, None
    head = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            head = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'PLTE':
            plte = chunk
        elif typ == b'tRNS':
            trns = chunk
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    w, h, bd, ct, comp, filt, inter = head
    assert bd == 8 and inter == 0, 'unsupported bitdepth/interlace'
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * nch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        if f == 1:
            for x in range(nch, stride):
                line[x] = (line[x] + line[x - nch]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                b = prev[x]
                c = prev[x - nch] if x >= nch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    rgba = bytearray(w * h * 4)
    if ct == 6:
        rgba[:] = out
    elif ct == 2:
        for o in range(0, w * h * 4, 4):
            s = o // 4 * 3
            rgba[o] = out[s]; rgba[o + 1] = out[s + 1]; rgba[o + 2] = out[s + 2]; rgba[o + 3] = 255
    elif ct == 0:
        for o in range(0, w * h * 4, 4):
            g = out[o // 4]
            rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = 255
    elif ct == 4:
        for o in range(0, w * h * 4, 4):
            s = o // 4 * 2
            g = out[s]
            rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = out[s + 1]
    elif ct == 3:
        assert plte, 'palette missing'
        for o in range(0, w * h * 4, 4):
            idx = out[o // 4] * 3
            rgba[o] = plte[idx]; rgba[o + 1] = plte[idx + 1]; rgba[o + 2] = plte[idx + 2]
            rgba[o + 3] = trns[idx // 3] if (trns and idx // 3 < len(trns)) else 255
    return w, h, bytes(rgba)


# ---------------- PNG 编码 ----------------

def write_png(path, w, h, rgba):
    def chunk(typ, payload):
        return struct.pack('>I', len(payload)) + typ + payload + struct.pack('>I', zlib.crc32(typ + payload) & 0xFFFFFFFF)
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)


# ---------------- 处理 ----------------

w, h, px = read_png(SRC)
print('src', w, 'x', h)

def get(x, y):
    o = (y * w + x) * 4
    return px[o], px[o + 1], px[o + 2], px[o + 3]

bg = get(2, 2)
print('bg sample', bg)

def is_tile(x, y):
    r, g, b, a = get(x, y)
    return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 40

# 行/列投影，只有占比足够高的行/列才算方块本体（过滤右下角水印）
rows = [sum(1 for x in range(0, w, 4) if is_tile(x, y)) * 4 for y in range(h)]
cols = [sum(1 for y in range(0, h, 4) if is_tile(x, y)) * 4 for x in range(w)]
th = w * 0.10
x0 = next(i for i, v in enumerate(cols) if v > th)
x1 = len(cols) - 1 - next(i for i, v in enumerate(reversed(cols)) if v > th)
y0 = next(i for i, v in enumerate(rows) if v > th)
y1 = len(rows) - 1 - next(i for i, v in enumerate(reversed(rows)) if v > th)
tw, thh = x1 - x0 + 1, y1 - y0 + 1
print('tile bbox', x0, y0, x1, y1, 'size', tw, thh)

# 取正方形（以短边为准，居中）
s = min(tw, thh)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
sx0, sy0 = cx - s // 2, cy - s // 2
tile = bytearray(s * s * 4)
R = int(s * 0.225)  # 圆角半径
SS = 3              # 抗锯齿超采样

def rr_cover(px_, py_):
    """该像素被圆角矩形覆盖的比例（0..1）"""
    hit = 0
    for ay in range(SS):
        for ax in range(SS):
            xx = px_ + (ax + 0.5) / SS
            yy = py_ + (ay + 0.5) / SS
            inside = True
            if (xx < R or xx > s - R) and (yy < R or yy > s - R):
                # 角落：取最近的圆角圆心判断是否在圆内
                rx = R if xx < R else s - R
                ry = R if yy < R else s - R
                dx, dy = xx - rx, yy - ry
                if dx * dx + dy * dy > R * R:
                    inside = False
            if inside:
                hit += 1
    return hit / (SS * SS)

for y in range(s):
    sy = sy0 + y
    for x in range(s):
        sx = sx0 + x
        o = (y * s + x) * 4
        so = (sy * w + sx) * 4
        tile[o] = px[so]; tile[o + 1] = px[so + 1]; tile[o + 2] = px[so + 2]
        tile[o + 3] = px[so + 3] if px[so + 3] else 255
        tile[o + 3] = int(tile[o + 3] * rr_cover(x, y))

# 盒式滤波缩放
def resize(src, sw, sh, dw, dh):
    dst = bytearray(dw * dh * 4)
    for dy in range(dh):
        fy0, fy1 = dy * sh / dh, (dy + 1) * sh / dh
        for dx in range(dw):
            fx0, fx1 = dx * sw / dw, (dx + 1) * sw / dw
            r = g = b = a = n = 0
            for yy in range(int(fy0), max(int(fy0) + 1, int(fy1 + 0.999))):
                for xx in range(int(fx0), max(int(fx0) + 1, int(fx1 + 0.999))):
                    o = (min(yy, sh - 1) * sw + min(xx, sw - 1)) * 4
                    wa = src[o + 3]
                    w_ = wa + 1  # 按 alpha 加权混色，避免透明边缘带灰边
                    r += src[o] * w_; g += src[o + 1] * w_; b += src[o + 2] * w_; a += wa
                    n += w_
            o = (dy * dw + dx) * 4
            if a == 0:
                dst[o] = dst[o + 1] = dst[o + 2] = 0
            else:
                dst[o] = r // n; dst[o + 1] = g // n; dst[o + 2] = b // n
            dst[o + 3] = a // (n and (n // (wa + 1)) * 1 or 1) if False else min(255, int(a / ((fy1 - fy0) * (fx1 - fx0))))
    return dst

for size in (128, 48, 32, 16):
    small = resize(tile, s, s, size, size)
    write_png(os.path.join(OUT_DIR, 'icon%d.png' % size), size, size, small)
    print('icon%d.png ok' % size)

# 同时留一份 128 的源图（圆角透明版）
write_png(os.path.join(OUT_DIR, 'icon.png'), s, s, tile)
print('icon.png (master %dpx) ok' % s)
