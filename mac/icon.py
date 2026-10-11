"""Draw Folio's brass mark as a PNG the Mac icon tools can resize."""
import struct
import zlib
from pathlib import Path

SIZE = 1024


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def pixel(x: int, y: int) -> tuple[int, int, int, int]:
    # Rounded brass tile with a dark F.
    inset = 96
    radius = 180
    inside = inset <= x < SIZE - inset and inset <= y < SIZE - inset
    if inside:
        dx = min(x - inset, SIZE - inset - 1 - x)
        dy = min(y - inset, SIZE - inset - 1 - y)
        if dx < radius and dy < radius and (dx - radius) ** 2 + (dy - radius) ** 2 > radius ** 2:
            inside = False
    if not inside:
        return (0, 0, 0, 0)
    # F: stem and two bars.
    col = 300 <= x <= 430
    top = 250 <= y <= 390 and 300 <= x <= 720
    mid = 470 <= y <= 600 and 300 <= x <= 620
    if col or top or mid:
        return (36, 28, 16, 255)
    return (198, 163, 107, 255)


rows = bytearray()
for y in range(SIZE):
    rows.append(0)
    for x in range(SIZE):
        rows.extend(pixel(x, y))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
png += chunk(b"IEND", b"")
Path(__file__).with_name("icon.png").write_bytes(png)
