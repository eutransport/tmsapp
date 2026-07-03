"""Extract structured stops from an uploaded addresses-list photo.

Strategy (best signal wins):
1. If a vision-capable LLM is configured (OpenAI / Azure OpenAI / GitHub Models),
   send the image and ask for strict JSON. LLMs are opmaak-agnostic and
   handle handwriting, rotation and column shuffles far better than OCR alone.
2. Otherwise fall back to Tesseract OCR + a heuristic parser that extracts
   European postcode+city patterns. This always yields *something* the user
   can edit, never a crash.

All output is validated against a hard schema before it is written to the DB.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
from dataclasses import dataclass, asdict
from typing import Optional

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

MAX_STOPS = 200  # hard cap; anything above is almost certainly a parser hallucination
MAX_IMAGE_DIMENSION = 2000  # downscale huge phone photos before sending to LLM/OCR


# --- data --------------------------------------------------------------------

@dataclass
class ExtractedStop:
    address_raw: str
    postcode: str = ''
    city: str = ''
    country: str = ''
    reference: str = ''
    colli: Optional[int] = None
    pallets: Optional[int] = None
    weight_kg: Optional[float] = None
    notes: str = ''


@dataclass
class ExtractionResult:
    provider: str
    raw_text: str
    stops: list[ExtractedStop]


# --- image prep --------------------------------------------------------------

def _prepare_image(raw_bytes: bytes) -> tuple[bytes, Image.Image]:
    """Normalize orientation, downscale, re-encode as JPEG.

    Returns (normalized_bytes, PIL image) — the caller can decide whether
    to send the bytes to an LLM or the PIL image to Tesseract.
    Raises ValueError if the bytes are not a valid image.
    """
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img.verify()  # cheap sanity check
    except Exception as exc:
        raise ValueError(f'Ongeldig afbeeldingsbestand: {exc}') from exc

    # Re-open for actual processing (verify() closes the file)
    img = Image.open(io.BytesIO(raw_bytes))
    img = ImageOps.exif_transpose(img)  # honor orientation, then strip EXIF
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')

    w, h = img.size
    if max(w, h) > MAX_IMAGE_DIMENSION:
        scale = MAX_IMAGE_DIMENSION / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=88, optimize=True)
    return buf.getvalue(), img


# --- LLM path ----------------------------------------------------------------

_LLM_SYSTEM = (
    "Je bent een assistent die adres-/laadlijsten van foto's leest. "
    "Antwoord altijd met STRICT JSON (geen uitleg, geen markdown). "
    "Schema: {\"stops\": [{\"address_raw\": str, \"postcode\": str, \"city\": str, "
    "\"country\": str, \"reference\": str, \"colli\": int|null, "
    "\"pallets\": int|null, \"weight_kg\": number|null, \"notes\": str}]}. "
    "Behoud de volgorde zoals op de lijst. Laat velden leeg (\"\" of null) "
    "als je ze niet ziet. Geef nooit meer stops terug dan er op de lijst staan."
)

_LLM_USER = (
    "Extraheer alle stops uit deze foto van een adressenlijst. "
    "Elke rij is een leveradres met eventueel colli / pallets / gewicht / referentie. "
    "Geef alleen het JSON-object."
)


def _call_vision_llm(jpeg_bytes: bytes) -> Optional[ExtractionResult]:
    """Try to extract via the configured AI provider. Returns None on failure."""
    try:
        from apps.core.models import AppSettings
    except Exception:
        return None

    try:
        settings_obj = AppSettings.get_settings()
    except Exception:
        return None

    if not settings_obj or settings_obj.ai_provider in (None, '', 'none'):
        return None

    provider = settings_obj.ai_provider
    model = settings_obj.ai_model or 'gpt-4o-mini'

    try:
        from openai import OpenAI, AzureOpenAI
    except ImportError:
        return None

    try:
        if provider == 'openai':
            key = settings_obj.ai_openai_api_key
            if not key:
                return None
            client = OpenAI(api_key=key)
            deployment = model
        elif provider == 'github':
            token = settings_obj.ai_github_token
            if not token:
                return None
            client = OpenAI(api_key=token, base_url='https://models.inference.ai.azure.com')
            deployment = model
        elif provider == 'azure':
            endpoint = settings_obj.ai_azure_endpoint
            key = settings_obj.ai_azure_api_key
            if not (endpoint and key):
                return None
            client = AzureOpenAI(
                azure_endpoint=endpoint,
                api_key=key,
                api_version='2024-02-01',
            )
            deployment = settings_obj.ai_azure_deployment or model
        else:
            return None
    except Exception as exc:  # pragma: no cover
        logger.warning('LoadList LLM client init failed: %s', exc)
        return None

    b64 = base64.b64encode(jpeg_bytes).decode('ascii')
    data_url = f'data:image/jpeg;base64,{b64}'

    try:
        completion = client.chat.completions.create(
            model=deployment,
            temperature=0,
            response_format={'type': 'json_object'},
            messages=[
                {'role': 'system', 'content': _LLM_SYSTEM},
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': _LLM_USER},
                        {'type': 'image_url', 'image_url': {'url': data_url}},
                    ],
                },
            ],
            timeout=60,
        )
    except Exception as exc:
        logger.warning('LoadList LLM call failed: %s', exc)
        return None

    try:
        content = completion.choices[0].message.content or '{}'
        data = json.loads(content)
    except Exception as exc:
        logger.warning('LoadList LLM JSON parse failed: %s', exc)
        return None

    stops = _validate_llm_stops(data)
    if not stops:
        return None
    return ExtractionResult(
        provider=f'llm:{provider}:{deployment}',
        raw_text=content[:20000],
        stops=stops,
    )


def _validate_llm_stops(data: dict) -> list[ExtractedStop]:
    raw = data.get('stops') if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    out: list[ExtractedStop] = []
    for item in raw[:MAX_STOPS]:
        if not isinstance(item, dict):
            continue
        addr = _clean_str(item.get('address_raw'), 300)
        if not addr:
            # Reconstruct address_raw if the model split fields but missed the combined line
            parts = [
                _clean_str(item.get('postcode'), 20),
                _clean_str(item.get('city'), 120),
            ]
            addr = ' '.join(p for p in parts if p).strip()
        if not addr:
            continue
        out.append(ExtractedStop(
            address_raw=addr,
            postcode=_clean_str(item.get('postcode'), 20),
            city=_clean_str(item.get('city'), 120),
            country=_clean_str(item.get('country'), 80),
            reference=_clean_str(item.get('reference'), 80),
            colli=_coerce_int(item.get('colli')),
            pallets=_coerce_int(item.get('pallets')),
            weight_kg=_coerce_float(item.get('weight_kg')),
            notes=_clean_str(item.get('notes'), 250),
        ))
    return out


# --- OCR fallback ------------------------------------------------------------

# Postcode patterns per country. Kept anchored so a match tells us where street ends
# and city begins on the reconstructed row.
_POSTCODE_PATTERNS = [
    (re.compile(r'\b(\d{4}\s?[A-Z]{2})\b'), 'NL'),      # 1234 AB
    (re.compile(r'\bL[- ]?(\d{4})\b'), 'LU'),           # L-1234
    (re.compile(r'\b(\d{5})\b'), 'DE_FR'),              # 12345
    (re.compile(r'\b(\d{4})\b(?!\s?[A-Z]{2})'), 'BE'),  # 1234 (BE) - lowest priority
    (re.compile(r'\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b'), 'UK'),
]
_STREET_TAIL_RE = re.compile(r'^(.*?[A-Za-zÀ-ÿ.\'\-]{2,})\s*(\d+[A-Za-z\-]?)?\s*$')
_LOAD_HINT_RE = re.compile(r'(\d+)\s*(pallet|pallets|palet|paletten|colli|coll|stuks|pcs)', re.IGNORECASE)
_LEADING_REF_RE = re.compile(r'^\s*([A-Z]{0,3}\d{2,8})\b')


def _find_postcode(text: str):
    for pattern, tag in _POSTCODE_PATTERNS:
        m = pattern.search(text)
        if m:
            return m, tag
    return None, ''


def _reconstruct_rows(data: dict) -> list[str]:
    """Group Tesseract word tokens into visual rows.

    Tesseract already gives us block/par/line numbers, but multi-column layouts
    often confuse it. We group by (block_num, par_num, line_num) *and* by
    y-center bucket as a safety net, then sort words left-to-right.
    """
    rows: dict[tuple, list[tuple[int, str]]] = {}
    n = len(data.get('text', []))
    for i in range(n):
        word = (data['text'][i] or '').strip()
        if not word:
            continue
        try:
            conf = int(float(data['conf'][i]))
        except (TypeError, ValueError):
            conf = -1
        if conf < 30:  # skip garbage
            continue
        top = int(data['top'][i])
        height = int(data['height'][i]) or 1
        y_center = top + height // 2
        y_bucket = y_center // max(10, height)  # ~1 row per line-height
        key = (int(data['block_num'][i]), int(data['par_num'][i]),
               int(data['line_num'][i]), y_bucket)
        rows.setdefault(key, []).append((int(data['left'][i]), word))

    out: list[str] = []
    for key in sorted(rows.keys(), key=lambda k: (k[3], k[0], k[1], k[2])):
        words = sorted(rows[key], key=lambda w: w[0])
        line = ' '.join(w for _, w in words).strip()
        if line:
            out.append(line)
    return out


def _parse_row(line: str) -> Optional[ExtractedStop]:
    m, tag = _find_postcode(line)
    if not m:
        return None
    pc = m.group(1).strip().upper().replace('  ', ' ')
    if tag == 'LU':
        pc = f'L-{pc}'
    before = line[:m.start()].strip(' \t-|,;')
    after = line[m.end():].strip(' \t-|,;')

    # Reference / order number at the very front
    reference = ''
    ref_m = _LEADING_REF_RE.match(before)
    if ref_m and len(before) > len(ref_m.group(1)) + 1:
        reference = ref_m.group(1)
        before = before[ref_m.end():].strip(' \t-|,;')

    # Load hint (pallets/colli) usually at the end
    pallets = None
    colli = None
    notes = ''
    load_m = _LOAD_HINT_RE.search(after)
    if load_m:
        qty = int(load_m.group(1))
        unit = load_m.group(2).lower()
        if unit.startswith('pal'):
            pallets = qty
        else:
            colli = qty
        after = (after[:load_m.start()] + after[load_m.end():]).strip(' \t-|,;')

    # City = remaining alphabetic text after postcode (stop at digits)
    city_match = re.match(r'([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .\'\-]{1,80})', after)
    city = city_match.group(1).strip(' .-') if city_match else ''
    if city:
        remainder = after[city_match.end():].strip(' \t-|,;')
        if remainder and not notes:
            notes = remainder[:250]

    # Street = everything before the postcode
    street = before[:200].strip(' \t-|,;')

    address_raw = ' '.join(p for p in (street, pc, city) if p).strip()
    if len(address_raw) < 4:
        address_raw = line[:250]

    return ExtractedStop(
        address_raw=address_raw[:250],
        postcode=pc[:20],
        city=city[:120],
        reference=reference[:80],
        pallets=pallets,
        colli=colli,
        notes=notes[:250],
    )


def _ocr_fallback(pil_img: Image.Image) -> ExtractionResult:
    try:
        import pytesseract  # local import: only needed for fallback
        from pytesseract import Output
    except Exception as exc:
        logger.warning('pytesseract not available: %s', exc)
        return ExtractionResult(provider='ocr:none', raw_text='', stops=[])

    try:
        # PSM 6 = assume a single uniform block of text (works well for tables).
        data = pytesseract.image_to_data(pil_img, lang='nld+eng',
                                         config='--psm 6', output_type=Output.DICT)
        raw_text = pytesseract.image_to_string(pil_img, lang='nld+eng', config='--psm 6')
    except Exception as exc:
        logger.warning('Tesseract failed: %s', exc)
        return ExtractionResult(provider='ocr:error', raw_text='', stops=[])

    rows = _reconstruct_rows(data)
    stops: list[ExtractedStop] = []
    seen: set[str] = set()
    for line in rows:
        if len(line) < 6 or len(line) > 300:
            continue
        stop = _parse_row(line)
        if not stop or not stop.postcode:
            continue
        key = f'{stop.postcode}|{stop.city}|{stop.address_raw}'.lower()
        if key in seen:
            continue
        seen.add(key)
        stops.append(stop)
        if len(stops) >= MAX_STOPS:
            break

    return ExtractionResult(provider='ocr:tesseract', raw_text=raw_text[:20000], stops=stops)


# --- public API --------------------------------------------------------------

def extract_stops_from_image(raw_bytes: bytes) -> ExtractionResult:
    """Extract stops from photo bytes. Never raises for well-formed images.

    - Validates the image with Pillow (rejects non-image uploads).
    - Prefers vision LLM when configured.
    - Always falls back to OCR so the user gets an editable list.
    """
    jpeg_bytes, pil_img = _prepare_image(raw_bytes)

    result = _call_vision_llm(jpeg_bytes)
    if result and result.stops:
        return result

    return _ocr_fallback(pil_img)


# --- helpers -----------------------------------------------------------------

def _clean_str(value, max_len: int) -> str:
    if value is None:
        return ''
    if not isinstance(value, str):
        value = str(value)
    # Strip control chars that break JSON / logs, keep printable + newline
    cleaned = ''.join(ch for ch in value if ch >= ' ' or ch == '\n').strip()
    return cleaned[:max_len]


def _coerce_int(value) -> Optional[int]:
    if value is None or value == '':
        return None
    try:
        n = int(float(value))
        return n if 0 <= n <= 100000 else None
    except (TypeError, ValueError):
        return None


def _coerce_float(value) -> Optional[float]:
    if value is None or value == '':
        return None
    try:
        n = float(value)
        return n if 0 <= n <= 1_000_000 else None
    except (TypeError, ValueError):
        return None


def result_to_dicts(result: ExtractionResult) -> list[dict]:
    return [asdict(s) for s in result.stops]
