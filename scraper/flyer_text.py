"""
Reads the text on a post's flyer, so the event finder (events_common.py) sees the date, time and
room that clubs often put only on the picture, not in the caption.

Instagram used to describe each picture, flyer text included ("May be an image of text that says
'GBM THURS 7PM HUB 145'"), but its public pages hardly ever include that any more (1 post in 293
in November 2026), so the scraper reads the picture itself:

  1. Windows' own text reader (Windows.Media.Ocr, the OCR engine built into Windows 10 and 11),
     through Microsoft's Python bindings from the pywinrt project
     (https://github.com/pywinrt/pywinrt). It runs on this computer, takes about a tenth of a
     second per flyer and costs nothing. Plain printed text comes out right ("Friday, November 13
     | 6:00 PM - 8:00 PM"); fancy lettering comes out partly garbled, which the AI that reads the
     result copes with ("IIAM" next to "Ask a Priest" is 11 AM).
  2. Where Windows' reader isn't available (a Mac, or the packages below aren't installed): an AI
     model on Groq that can look at pictures (GROQ_API_KEY, the same key the event finder uses).
     Better with fancy lettering, but 3 to 30 seconds per flyer and it counts against Groq's free
     daily limit, so it's capped at VISION_PER_RUN flyers per run.

We compared the usual open-source OCR projects first (November 2026): Tesseract (with
pytesseract) needs a separate program installed on every computer that runs the scraper;
RapidOCR needs onnxruntime and PaddleOCR needs PaddlePaddle, neither of which has a build for
Python 3.15 yet; EasyOCR needs PyTorch (over a gigabyte). Windows' reader needs none of that.

Setup (Windows), once:
    pip install winrt-runtime winrt-Windows.Media.Ocr winrt-Windows.Graphics.Imaging winrt-Windows.Storage.Streams winrt-Windows.Foundation winrt-Windows.Foundation.Collections winrt-Windows.Globalization
Try it on a picture:
    python flyer_text.py path\\to\\flyer.jpg
"""

import asyncio
import base64
import os
import re
import sys
import time

import requests

VISION_MODELS = ["qwen/qwen3.8-27b"]  # Groq models that can look at pictures, best first
VISION_PER_RUN = 30
MAX_TEXT = 1500  # characters of flyer text kept per post
UPSCALE = 2.0  # small flyer text reads better from a bigger copy

_engine = None
_vision_used = 0
_vision_off = False  # Groq turned us away this run


def _windows_engine():
    """Windows' OCR engine for the computer's languages, or None where it isn't available."""
    global _engine
    if _engine is None:
        try:
            from winrt.windows.media.ocr import OcrEngine

            _engine = OcrEngine.try_create_from_user_profile_languages() or False
        except Exception:  # not Windows, or the winrt packages aren't installed
            _engine = False
    return _engine or None


async def _windows_read(data):
    from winrt.windows.graphics.imaging import (BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode,
                                                BitmapPixelFormat, BitmapTransform, ColorManagementMode,
                                                ExifOrientationMode)
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.storage.streams import DataWriter, InMemoryRandomAccessStream

    stream = InMemoryRandomAccessStream()
    writer = DataWriter(stream)
    writer.write_bytes(data)
    await writer.store_async()
    await writer.flush_async()
    writer.detach_stream()
    stream.seek(0)
    decoder = await BitmapDecoder.create_async(stream)
    w, h = decoder.pixel_width, decoder.pixel_height
    scale = min(UPSCALE, OcrEngine.max_image_dimension / max(w, h))
    size = BitmapTransform()
    size.scaled_width, size.scaled_height = max(1, int(w * scale)), max(1, int(h * scale))
    size.interpolation_mode = BitmapInterpolationMode.FANT
    bitmap = await decoder.get_software_bitmap_async(
        BitmapPixelFormat.BGRA8, BitmapAlphaMode.PREMULTIPLIED, size,
        ExifOrientationMode.RESPECT_EXIF_ORIENTATION, ColorManagementMode.DO_NOT_COLOR_MANAGE)
    result = await _windows_engine().recognize_async(bitmap)
    return "\n".join(line.text for line in result.lines)


def _groq_key():
    # Read when needed: events_common.py loads scraper/.env into the environment when it starts.
    return os.environ.get("GROQ_API_KEY")


class ReaderUnavailable(Exception):
    """The reader can't read any more pictures this run (Groq's limit, no connection): the post
    should be read again next run, not marked as having no text."""


def _vision_read(data):
    """Ask a Groq model that can see pictures to copy out the flyer's text."""
    global _vision_used, _vision_off
    if not can_read():
        raise ReaderUnavailable
    _vision_used += 1
    url = "data:image/jpeg;base64," + base64.b64encode(data).decode()
    for model in VISION_MODELS:
        for _ in range(3):
            try:
                r = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {_groq_key()}"},
                    json={"model": model, "temperature": 0, "max_tokens": 600, "reasoning_effort": "none",
                          "messages": [{"role": "user", "content": [
                              {"type": "text", "text": "Copy out all the text on this flyer, line by line, "
                                                       "exactly as written. Text only, no commentary."},
                              {"type": "image_url", "image_url": {"url": url}}]}]},
                    timeout=90)
            except requests.RequestException:
                _vision_off = True
                raise ReaderUnavailable
            if r.status_code == 429:
                wait = float(r.headers.get("retry-after") or 10)
                if wait > 60:  # the daily limit
                    _vision_off = True
                    raise ReaderUnavailable
                time.sleep(wait)
                continue
            if r.status_code == 404:
                break  # this model is gone; try the next
            if r.status_code != 200:
                _vision_off = True
                raise ReaderUnavailable
            return r.json()["choices"][0]["message"]["content"]
    _vision_off = True  # no model left, or still busy after three tries
    raise ReaderUnavailable


# A time OCR misread, with letters for digits: "IIAM", "l0:3OPM", "|2 pm". The letters only count
# when they're right up against the AM/PM or mixed with real digits, so "I AM" stays as it is.
OCR_TIME = re.compile(r"(?<![A-Za-z0-9])([0-9IlO|]{1,2})(?:([:.])([0-9IlOo]{2}))?(\s?)([AaPp]\.?[Mm]\.?)(?![A-Za-z])")
DIGIT_FOR = str.maketrans({"I": "1", "l": "1", "|": "1", "O": "0", "o": "0"})


def fix_times(text):
    """'Ask a Priest Anything @ IIAM' -> '... @ 11AM'."""
    def fix(m):
        hour, sep, minutes, space, ampm = m.groups()
        guessed = not any(c.isdigit() for c in hour + (minutes or ""))
        if guessed and (space or len(hour) == 1 and not minutes):
            return m.group(0)  # "I AM", "O PM", "IAM": a word, not a time
        fixed_hour, fixed_minutes = hour.translate(DIGIT_FOR), (minutes or "").translate(DIGIT_FOR)
        if not 1 <= int(fixed_hour) <= 12 or (minutes and int(fixed_minutes) > 59):
            return m.group(0)
        return f"{fixed_hour}{sep or ''}{fixed_minutes}{space}{ampm}"
    return OCR_TIME.sub(fix, text)


def tidy(text):
    """Trim the reader's output: no blank or repeated lines (a picture model can get stuck saying
    the same word over and over), times with letters misread for digits fixed, and nothing at all
    when there's barely any text."""
    text = fix_times(text or "")
    lines = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line and line not in lines[-3:]:
            lines.append(line)
    text = "\n".join(lines)[:MAX_TEXT]
    return text if len(re.findall(r"[A-Za-z0-9]", text)) >= 6 else None


def read_flyer(data):
    """The text on a picture (the image file's bytes), or None when it has none. Raises
    ReaderUnavailable when it can't be read right now (see can_read)."""
    if not data:
        return None
    if _windows_engine():
        try:
            return tidy(asyncio.run(_windows_read(data)))
        except Exception:
            return None  # not a picture Windows can open
    return tidy(_vision_read(data))


def can_read():
    """Whether read_flyer can read another picture this run."""
    if _windows_engine():
        return True
    return bool(_groq_key()) and not _vision_off and _vision_used < VISION_PER_RUN


def reader_name():
    """Which reader read_flyer uses on this computer, for the log."""
    if _windows_engine():
        return "Windows OCR"
    return "Groq picture model" if _groq_key() else None


if __name__ == "__main__":
    import events_common  # noqa: F401  (loads scraper/.env, for the Groq key)

    for path in sys.argv[1:]:
        with open(path, "rb") as f:
            print(f"--- {path} ({reader_name() or 'no reader available'})\n{read_flyer(f.read())}")
