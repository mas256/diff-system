"""Generate the extension's geometric icons using only the Python standard library."""
import struct, zlib
from pathlib import Path
root = Path(__file__).resolve().parents[1] / "icons"
def png(size):
    scale = 4
    def color(x,y):
        # Rounded green document, white text strokes, amber approval mark.
        x,y = x/size,y/size
        inside = .06<x<.94 and .06<y<.94
        r=.16
        for cx,cy in [(.22,.22),(.78,.22),(.22,.78),(.78,.78)]:
            if abs(x-cx)>0 and ((x<.22 and cx==.22) or (x>.78 and cx==.78)) and ((y<.22 and cy==.22) or (y>.78 and cy==.78)):
                inside = inside and (x-cx)**2+(y-cy)**2<r*r
        if not inside:return (0,0,0,0)
        c=(33,110,88,255)
        if .25<x<.74 and (.27<y<.33 or .43<y<.49):c=(246,250,242,255)
        if .25<x<.49 and .63<y<.69:c=(246,250,242,255)
        if (.65<x<.71 and .58<y<.80) or (.57<x<.79 and .66<y<.72):c=(236,200,122,255)
        return c
    raw=bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            pixels=[color((x+(sx+.5)/scale),(y+(sy+.5)/scale)) for sy in range(scale) for sx in range(scale)]
            raw.extend(round(sum(p[k] for p in pixels)/len(pixels)) for k in range(4))
    def chunk(kind,data):
        return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",size,size,8,6,0,0,0))+chunk(b"IDAT",zlib.compress(bytes(raw)))+chunk(b"IEND",b"")
root.mkdir(exist_ok=True)
for size in [16,32,48,128]:(root/(str(size)+".png")).write_bytes(png(size))
