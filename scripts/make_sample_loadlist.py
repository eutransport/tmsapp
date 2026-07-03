"""Generate a sample delivery list image for testing the loadlist upload."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "sample_laadlijst.png"

STOPS = [
    ("101", "Stationsplein 1",       "3511 ED", "Utrecht",         "2 pallets"),
    ("102", "Marktstraat 12",        "6811 CG", "Arnhem",          "1 pallet"),
    ("103", "Waalkade 45",           "6511 XP", "Nijmegen",        "3 pallets"),
    ("104", "Grotestraat 88",        "3811 BN", "Amersfoort",      "1 pallet"),
    ("105", "Kerkplein 3",           "3841 EG", "Harderwijk",      "2 pallets"),
    ("106", "Havenstraat 7",         "6701 AA", "Wageningen",      "1 pallet"),
    ("107", "Torenstraat 22",        "4001 LC", "Tiel",            "4 pallets"),
    ("108", "Molenweg 5",            "3961 AB", "Wijk bij Duurstede", "1 pallet"),
    ("109", "Industrieweg 14",       "6921 RC", "Duiven",          "2 pallets"),
    ("110", "Dorpsstraat 33",        "3925 KB", "Scherpenzeel",    "1 pallet"),
    ("111", "Julianalaan 9",         "6811 LN", "Arnhem",          "2 pallets"),
    ("112", "Beatrixlaan 21",        "3743 CJ", "Baarn",           "1 pallet"),
]

W, H = 1240, 1600
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)

def font(size, bold=False):
    for name in (["arialbd.ttf"] if bold else ["arial.ttf"]) + ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()

title_f = font(42, bold=True)
sub_f   = font(22)
hdr_f   = font(22, bold=True)
row_f   = font(22)

# Header
d.text((60, 50), "LAADLIJST - Route 2026-07-03", fill="black", font=title_f)
d.text((60, 110), "Chauffeur: J. de Vries    Trekker: 42-ABC-1    Vertrek: Utrecht depot", fill="black", font=sub_f)

# Table header
y = 180
d.rectangle([(50, y), (W-50, y+50)], fill=(230, 230, 230))
cols = [(70, "Nr"), (150, "Adres"), (620, "Postcode"), (780, "Plaats"), (1030, "Lading")]
for x, label in cols:
    d.text((x, y+14), label, fill="black", font=hdr_f)

y += 60
for ref, addr, pc, city, load in STOPS:
    d.line([(50, y-5), (W-50, y-5)], fill=(200, 200, 200), width=1)
    d.text((70,  y), ref,  fill="black", font=row_f)
    d.text((150, y), addr, fill="black", font=row_f)
    d.text((620, y), pc,   fill="black", font=row_f)
    d.text((780, y), city, fill="black", font=row_f)
    d.text((1030, y), load, fill="black", font=row_f)
    y += 50

d.line([(50, y-5), (W-50, y-5)], fill=(200, 200, 200), width=1)
d.text((60, y+30), "Totaal: 12 stops - 21 pallets", fill="black", font=hdr_f)

img.save(OUT, "PNG", optimize=True)
print(f"wrote {OUT}")
