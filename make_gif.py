from PIL import Image, ImageDraw
import math

src = "public/images/zivon-robot.png"
out = "public/images/zivon-robot.gif"

base = Image.open(src).convert("RGBA")

# Small size — fast load in Slack
SIZE = 200
base = base.resize((SIZE, SIZE), Image.LANCZOS)
W, H = SIZE, SIZE

frames = []
n = 20  # frames

for i in range(n):
    t = i / n

    # Float up/down ±7px
    offset_y = int(math.sin(t * 2 * math.pi) * 7)

    # Scale pulse 1.0 → 1.03
    scale = 1.0 + 0.03 * math.sin(t * 2 * math.pi)
    nw = int(W * scale)
    nh = int(H * scale)
    resized = base.resize((nw, nh), Image.LANCZOS)

    # Dark bg
    canvas = Image.new("RGBA", (W, H), (10, 12, 30, 255))
    px = (W - nw) // 2
    py = (H - nh) // 2 + offset_y
    canvas.paste(resized, (px, py), resized)

    # Eye glow
    g = Image.new("RGBA", (W, H), (0,0,0,0))
    d = ImageDraw.Draw(g)
    ga = int(35 + 30 * math.sin(t * 2 * math.pi))
    ey = py + int(nh * 0.41)
    erw = max(4, int(nw * 0.085))
    erh = max(5, int(nh * 0.105))
    lx = px + int(nw * 0.375)
    rx = px + int(nw * 0.625)
    d.ellipse([lx-erw, ey-erh, lx+erw, ey+erh], fill=(0, 200, 255, ga))
    d.ellipse([rx-erw, ey-erh, rx+erw, ey+erh], fill=(0, 200, 255, ga))
    canvas = Image.alpha_composite(canvas, g)

    frames.append(canvas.convert("RGB").quantize(colors=64))

frames[0].save(
    out, save_all=True, append_images=frames[1:],
    optimize=True, duration=60, loop=0
)
kb = round(open(out,'rb').read().__len__() / 1024, 1)
print(f"GIF done: {SIZE}x{SIZE}px | {len(frames)} frames | {kb}KB")
