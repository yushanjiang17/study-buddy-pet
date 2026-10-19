"""Generate a placeholder sprite sheet for the study-buddy desktop pet.

Layout: 8 columns x 8 rows, each cell 192x208 px -> 1536x1664 transparent PNG.
Rows (state, frame count):
  0 idle 6, 1 thinking 6, 2 experiment 6, 3 give-quest 6,
  4 celebrate 8, 5 encourage 4, 6 guard 6, 7 sleep 4
"""
import math, json, sys
from PIL import Image, ImageDraw, ImageFont

CW, CH, COLS = 192, 208, 8
STATES = [("idle", 6), ("thinking", 6), ("experiment", 6), ("give-quest", 6),
          ("celebrate", 8), ("encourage", 4), ("guard", 6), ("sleep", 4)]
SS = 3  # supersample for smooth edges

BODY = (255, 196, 120)
BODY_DARK = (214, 140, 70)
OUTLINE = (60, 40, 30)
CHEEK = (255, 140, 140)
PROP = (120, 170, 220)
PAPER = (250, 245, 225)
SPARK = (255, 220, 80)
LIQUID = (120, 210, 150)


def S(v):
    return int(round(v * SS))


def draw_frame(state, i, n):
    img = Image.new("RGBA", (CW * SS, CH * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    t = i / n
    wave = math.sin(t * 2 * math.pi)

    cx, base = 96, 196            # feet baseline 12 px above bottom
    w, h = 104, 112               # body size
    squash = 0
    lift = 0
    if state == "idle":
        squash = 3 * wave
    elif state == "celebrate":
        lift = max(0, 22 * math.sin(t * 2 * math.pi))
        squash = -4 * wave
    elif state == "sleep":
        squash = 2 * wave
        h = 96
    elif state == "encourage":
        squash = 2 * wave

    bw, bh = w + squash, h - squash
    top = base - bh - lift
    left = cx - bw / 2

    # ground shadow (subtle, stays in cell)
    sh = 40 - lift * 0.6
    d.ellipse([S(cx - sh), S(base - 5), S(cx + sh), S(base + 5)], fill=(0, 0, 0, 40))

    # feet
    for fx in (-22, 22):
        d.ellipse([S(cx + fx - 14), S(base - lift - 12), S(cx + fx + 14), S(base - lift + 2)],
                  fill=BODY_DARK, outline=OUTLINE, width=S(2.5))

    # body
    d.rounded_rectangle([S(left), S(top), S(left + bw), S(base - lift - 4)], radius=S(46),
                        fill=BODY, outline=OUTLINE, width=S(3))
    # little antenna sprout (generic placeholder mark)
    ax, ay = cx, top
    sway = 4 * wave
    d.line([S(ax), S(ay), S(ax + sway), S(ay - 16)], fill=OUTLINE, width=S(3))
    d.ellipse([S(ax + sway - 7), S(ay - 26), S(ax + sway + 7), S(ay - 12)],
              fill=SPARK if state in ("celebrate", "thinking") else BODY_DARK,
              outline=OUTLINE, width=S(2))

    # face
    ey = top + bh * 0.42
    ex = 20
    if state == "sleep":
        for sx in (-ex, ex):
            d.arc([S(cx + sx - 8), S(ey - 4), S(cx + sx + 8), S(ey + 8)], 200, 340, fill=OUTLINE, width=S(3))
    elif state in ("celebrate", "encourage"):
        for sx in (-ex, ex):
            d.arc([S(cx + sx - 8), S(ey - 2), S(cx + sx + 8), S(ey + 12)], 200, 340, fill=OUTLINE, width=S(3))
    else:
        look = 0
        if state == "thinking":
            look = -3
        blink = state == "idle" and i == n - 1
        for sx in (-ex, ex):
            if blink:
                d.line([S(cx + sx - 6), S(ey), S(cx + sx + 6), S(ey)], fill=OUTLINE, width=S(3))
            else:
                d.ellipse([S(cx + sx - 6), S(ey - 8 + look), S(cx + sx + 6), S(ey + 6 + look)], fill=OUTLINE)
                d.ellipse([S(cx + sx - 2), S(ey - 6 + look), S(cx + sx + 2), S(ey - 2 + look)], fill=(255, 255, 255))
    # cheeks
    for sx in (-34, 34):
        d.ellipse([S(cx + sx - 7), S(ey + 10), S(cx + sx + 7), S(ey + 18)], fill=CHEEK + (170,))
    # mouth
    my = ey + 20
    if state == "guard":
        d.line([S(cx - 8), S(my), S(cx + 8), S(my)], fill=OUTLINE, width=S(3))
    elif state == "thinking":
        d.ellipse([S(cx - 4), S(my - 3), S(cx + 4), S(my + 5)], outline=OUTLINE, width=S(2))
    elif state == "sleep":
        pass
    else:
        d.arc([S(cx - 10), S(my - 8), S(cx + 10), S(my + 6)], 20, 160, fill=OUTLINE, width=S(3))

    # state props
    arm_y = top + bh * 0.62
    if state == "idle":
        # small notebook held at side, pen tapping
        nx, ny = cx + 44, arm_y - 4 + 2 * wave
        d.rectangle([S(nx), S(ny), S(nx + 22), S(ny + 28)], fill=PROP, outline=OUTLINE, width=S(2))
        d.line([S(nx + 4), S(ny + 8), S(nx + 18), S(ny + 8)], fill=PAPER, width=S(2))
    elif state == "thinking":
        # hand on chin + thought dots
        d.ellipse([S(cx + 6), S(my + 4), S(cx + 22), S(my + 18)], fill=BODY_DARK, outline=OUTLINE, width=S(2))
        for k in range(3):
            if k <= i % 4:
                r = 3 + k * 2
                px, py = cx + 50 + k * 12, top - 2 - k * 12
                d.ellipse([S(px - r), S(py - r), S(px + r), S(py + r)], fill=PAPER, outline=OUTLINE, width=S(2))
    elif state == "experiment":
        # flask held up, bubbles rising
        fx, fy = cx + 46, arm_y - 30
        d.polygon([(S(fx - 6), S(fy)), (S(fx + 6), S(fy)), (S(fx + 18), S(fy + 30)), (S(fx - 18), S(fy + 30))],
                  fill=LIQUID, outline=OUTLINE)
        d.rectangle([S(fx - 6), S(fy - 10), S(fx + 6), S(fy)], fill=PAPER, outline=OUTLINE, width=S(2))
        for k in range(3):
            by = fy - 14 - ((t * 40 + k * 14) % 40)
            bx = fx + (k - 1) * 6
            d.ellipse([S(bx - 3), S(by - 3), S(bx + 3), S(by + 3)], outline=LIQUID, width=S(2))
    elif state == "give-quest":
        # scroll unrolling toward viewer
        length = 10 + 34 * min(1, t * 1.6)
        sx0, sy0 = cx - length, arm_y - 6
        d.rectangle([S(sx0), S(sy0), S(cx + length), S(sy0 + 22)], fill=PAPER, outline=OUTLINE, width=S(2))
        for k in range(2):
            d.line([S(sx0 + 8), S(sy0 + 7 + k * 8), S(cx + length - 8), S(sy0 + 7 + k * 8)], fill=PROP, width=S(2))
        for ex_ in (sx0, cx + length):
            d.ellipse([S(ex_ - 5), S(sy0 - 3), S(ex_ + 5), S(sy0 + 25)], fill=BODY_DARK, outline=OUTLINE, width=S(2))
    elif state == "celebrate":
        for k in range(5):
            ang = (k / 5 + t) * 2 * math.pi
            rr = 70
            px, py = cx + rr * math.cos(ang), top + 20 + 0.5 * rr * math.sin(ang)
            s = 6 if (i + k) % 2 else 4
            d.polygon([(S(px), S(py - s)), (S(px + s * 0.4), S(py - s * 0.4)), (S(px + s), S(py)),
                       (S(px + s * 0.4), S(py + s * 0.4)), (S(px), S(py + s)), (S(px - s * 0.4), S(py + s * 0.4)),
                       (S(px - s), S(py)), (S(px - s * 0.4), S(py - s * 0.4))], fill=SPARK)
    elif state == "encourage":
        # thumbs up
        tx, ty = cx + 50, arm_y - 10 - 3 * abs(wave)
        d.ellipse([S(tx - 10), S(ty), S(tx + 10), S(ty + 18)], fill=BODY_DARK, outline=OUTLINE, width=S(2))
        d.rounded_rectangle([S(tx - 4), S(ty - 14), S(tx + 4), S(ty + 4)], radius=S(4), fill=BODY_DARK,
                            outline=OUTLINE, width=S(2))
    elif state == "guard":
        # raised palm + glowing barrier pulse
        pulse = 0.5 + 0.5 * wave
        alpha = int(60 + 80 * pulse)
        d.rounded_rectangle([S(cx - 80), S(top - 6), S(cx + 80), S(base - 2)], radius=S(24),
                            outline=PROP + (alpha,), width=S(4))
        px, py = cx + 50, arm_y - 30
        d.rounded_rectangle([S(px - 10), S(py - 14), S(px + 10), S(py + 12)], radius=S(8),
                            fill=BODY_DARK, outline=OUTLINE, width=S(2))
    elif state == "sleep":
        for k in range(2):
            zt = (t + k * 0.5) % 1
            zx, zy = cx + 40 + zt * 20, top - zt * 34
            zs = 6 + zt * 4
            alpha = int(255 * (1 - zt))
            d.line([S(zx), S(zy), S(zx + zs), S(zy)], fill=OUTLINE + (alpha,), width=S(2))
            d.line([S(zx + zs), S(zy), S(zx), S(zy + zs)], fill=OUTLINE + (alpha,), width=S(2))
            d.line([S(zx), S(zy + zs), S(zx + zs), S(zy + zs)], fill=OUTLINE + (alpha,), width=S(2))

    return img.resize((CW, CH), Image.LANCZOS)


def main(out_dir):
    sheet = Image.new("RGBA", (CW * COLS, CH * len(STATES)), (0, 0, 0, 0))
    for r, (state, n) in enumerate(STATES):
        for i in range(n):
            sheet.alpha_composite(draw_frame(state, i, n), (i * CW, r * CH))
    sheet.save(f"{out_dir}/spritesheet.png")

    meta = {
        "id": "placeholder-buddy",
        "displayName": "Placeholder Buddy",
        "description": "Temporary placeholder sprite; replace spritesheet.png with final art.",
        "spritesheetPath": "spritesheet.png",
        "frameWidth": CW, "frameHeight": CH, "columns": COLS,
        "states": {s: {"row": r, "frames": n} for r, (s, n) in enumerate(STATES)},
    }
    with open(f"{out_dir}/pet.json", "w") as f:
        json.dump(meta, f, indent=2)

    # preview with labels on a light background
    pad = 140
    prev = Image.new("RGBA", (sheet.width + pad, sheet.height), (245, 242, 235, 255))
    prev.alpha_composite(sheet, (pad, 0))
    dd = ImageDraw.Draw(prev)
    for r, (s, n) in enumerate(STATES):
        dd.text((12, r * CH + CH // 2 - 6), f"{r} {s} ({n})", fill=(40, 40, 40))
        dd.line([(0, r * CH), (prev.width, r * CH)], fill=(210, 205, 195))
    prev.convert("RGB").save(f"{out_dir}/preview.png")


if __name__ == "__main__":
    main(sys.argv[1])
