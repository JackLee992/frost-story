#!/usr/bin/env python3
"""Translate player-facing Frost Story content with a local Ollama model.

The source JSON remains authoritative. Stable IDs, file names, placeholders and
gameplay values are copied unchanged; only player-facing strings are translated.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
FILES = ["story.json", "npcs.json", "items.json", "shop.json", "balance.json", "ui.json"]
TEXT_KEYS = {"title", "subtitle", "hook", "name", "place", "text", "prompt", "complete", "label", "desc",
             "arrival", "request", "thanks", "spoken", "iapPlaceholder"}
TARGETS = {
    "en": "natural, concise American English",
    "ja": "natural modern Japanese suitable for a warm mobile story game",
    "ko": "natural modern Korean suitable for a warm mobile story game",
}
GLOSSARY = {
    "en": "冰霜物语=Frost Story; 霜语谷=Frostwhisper Valley; 归雁港=Homewing Harbor; 暖流号=Warm Current; 霜林=Frostwood; 永暖圣殿=Everwarm Sanctuary; 啾可=Choco; 冈特=Gunnar; 蜜儿=Mier; 波波=Bobo; 艾莎=Elsa; 巴尔=Barr; 埃文=Evan; 永暖圣火=Everwarm Flame; 霜心=Frostheart; 风灯=wind lantern; 材料台=Supply Station; 合成路线=merge chain; 霜灵=frost spirit; 霜灵师=frostweaver",
    "ja": "霜语谷=霜語りの谷; 归雁港=帰雁港; 暖流号=暖流号; 霜林=霜の森; 永暖圣殿=永暖の聖殿; 啾可=チョコ; 冈特=グンナー; 蜜儿=ミエル; 波波=ボボ; 艾莎=エルサ; 巴尔=バル; 埃文=エヴァン; 永暖圣火=永暖の聖火; 霜心=霜の心臓; 风灯=風灯; 霜灵=霜の精; 霜灵师=霜術師",
    "ko": "霜语谷=서리말 골짜기; 归雁港=귀안항; 暖流号=온류호; 霜林=서리숲; 永暖圣殿=영원의 온기 성전; 啾可=초코; 冈特=군나르; 蜜儿=미엘; 波波=보보; 艾莎=엘사; 巴尔=바르; 埃文=에번; 永暖圣火=영원의 온기 성화; 霜心=서리심장; 风灯=바람등; 霜灵=서리 정령; 霜灵师=서리술사",
}
TOKEN_RE = re.compile(r"{{[^}]+}}")
TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")


def markers(value: str) -> tuple[list[str], list[str]]:
    return sorted(TOKEN_RE.findall(value)), sorted(TAG_RE.findall(value))


def polish(locale: str, source: str, target: str) -> str:
    if locale == "en":
        if source == "冰霜物语":
            return "Frost Story"
        target = target.replace("Frost Tales", "Frost Story")
        target = target.replace("Synthesis Path", "Merge Chain").replace("synthesis path", "merge chain")
        target = target.replace("Material Table", "Supply Station").replace("Material Stand", "Supply Station")
    return target


def cli() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--locale", choices=[*TARGETS, "all"], default="all")
    parser.add_argument("--model", default="gemma4:12b",
                        help="Local Ollama model. Use --force whenever changing models for an existing locale cache.")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def pointer(parts: list[str | int]) -> str:
    return "/" + "/".join(str(part).replace("~", "~0").replace("/", "~1") for part in parts)


def collect(file_name: str, data: object) -> list[dict]:
    entries: list[dict] = []

    def add(parts: list[str | int], value: str, context: str = "") -> None:
        if value.strip():
            entries.append({"id": f"{file_name}:{pointer(parts)}", "text": value, "context": context})

    def walk(value: object, parts: list[str | int], parent_key: str = "") -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if isinstance(child, str) and (file_name == "ui.json" or key in TEXT_KEYS):
                    context = ""
                    if file_name == "npcs.json" and key in {"arrival", "request", "thanks"}:
                        context = f"speaker={value.get('id', 'narrator') if key != 'arrival' else 'narrator'}"
                    elif file_name == "story.json" and "companion" in parts:
                        context = "speaker=choco"
                    add(parts + [key], child, context)
                elif isinstance(child, (dict, list)):
                    walk(child, parts + [key], key)
        elif isinstance(value, list):
            # Authored dialogue tuple: [speaker ID, visible text, metadata].
            if len(value) >= 2 and isinstance(value[0], str) and isinstance(value[1], str) and (
                value[0] in {"narrator", "choco", "gunnar", "bobo", "mier", "elsa", "bar", "gramps", "all"}
            ):
                add(parts + [1], value[1], f"speaker={value[0]}")
                if len(value) > 2 and isinstance(value[2], dict) and isinstance(value[2].get("spoken"), str):
                    add(parts + [2, "spoken"], value[2]["spoken"], f"speaker={value[0]}; prerecorded spoken variant")
                return
            for index, child in enumerate(value):
                if isinstance(child, str) and parent_key == "tiers":
                    add(parts + [index], child)
                elif isinstance(child, (dict, list)):
                    walk(child, parts + [index], parent_key)

    walk(data, [])
    return entries


def set_pointer(data: object, raw_pointer: str, value: str) -> None:
    parts = raw_pointer.lstrip("/").split("/") if raw_pointer != "/" else []
    current = data
    for raw in parts[:-1]:
        part = raw.replace("~1", "/").replace("~0", "~")
        current = current[int(part)] if isinstance(current, list) else current[part]
    tail = parts[-1].replace("~1", "/").replace("~0", "~")
    if isinstance(current, list):
        current[int(tail)] = value
    else:
        current[tail] = value


def ollama(model: str, locale: str, entries: list[dict]) -> dict[str, str]:
    system = f"""You are the senior localization writer for Frost Story, a warm narrative merge-2 mobile game.
Translate Simplified Chinese into {TARGETS[locale]}. Keep the emotional, spoken quality of character dialogue.
Character voices: choco is a bright young female frost spirit; gunnar is an elderly male hunter; bobo is an energetic young male courier; mier is a warm adult female baker; elsa is a gentle grandmother; bar is a reserved adult male blacksmith; gramps is an elderly male guardian; narrator is a warm female storyteller. Honor each input context without translating it.
UI text must be concise enough for a 360px-wide phone. Do not sound like machine translation or engineering documentation.
Preserve every placeholder such as {{{{playerName}}}}, {{{{count}}}}, HTML tag such as <br>, emoji, punctuation token, and Lv. notation exactly where semantically appropriate.
Do not translate JSON IDs. Apply this glossary consistently: {GLOSSARY[locale]}.
Return a JSON object with one key named translations. Its value must contain exactly one object for each input, with the same integer i and a translated text. No commentary."""
    schema = {"type": "object", "properties": {"translations": {"type": "array", "items": {"type": "object",
              "properties": {"i": {"type": "integer"}, "text": {"type": "string"}}, "required": ["i", "text"]}}},
              "required": ["translations"]}
    numbered = [{"i": index, "text": entry["text"], **({"context": entry["context"]} if entry.get("context") else {})}
                for index, entry in enumerate(entries)]
    body = {"model": model, "stream": False, "think": False, "format": schema, "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(numbered, ensure_ascii=False)},
    ], "options": {"temperature": 0.15, "num_ctx": 32768}}
    request = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=900) as response:
        payload = json.loads(response.read())
    parsed = json.loads(payload["message"]["content"])
    translated = {item["i"]: item["text"] for item in parsed["translations"]}
    if set(translated) != set(range(len(entries))):
        raise RuntimeError("translation response indexes did not match the requested batch")
    return {entry["id"]: translated[index] for index, entry in enumerate(entries)}


def translate_checked(model: str, locale: str, batch: list[dict]) -> dict[str, str]:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            result = ollama(model, locale, batch)
            if set(result) != {item["id"] for item in batch}:
                raise RuntimeError("translation response IDs did not match the requested batch")
            invalid = [item["id"] for item in batch
                       if markers(polish(locale, item["text"], result[item["id"]])) != markers(item["text"])]
            if invalid:
                raise RuntimeError(f"translation changed protected markers: {invalid[:3]}")
            return result
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                print(f"retry {locale} batch ({len(batch)} strings): {exc}", flush=True)
                time.sleep(1)
    if len(batch) > 1:
        middle = len(batch) // 2
        return {**translate_checked(model, locale, batch[:middle]),
                **translate_checked(model, locale, batch[middle:])}
    assert last_error is not None
    raise last_error


def translate_locale(locale: str, model: str, batch_size: int, force: bool) -> None:
    source = {name: json.loads((ROOT / "web/config" / name).read_text(encoding="utf-8")) for name in FILES}
    entries = [entry for name, data in source.items() for entry in collect(name, data)]
    cache_path = ROOT / "tools/i18n" / f"translations-{locale}.json"
    cache = {} if force or not cache_path.exists() else json.loads(cache_path.read_text(encoding="utf-8"))
    pending = [entry for entry in entries if cache.get(entry["id"], {}).get("source") != entry["text"]
               or cache.get(entry["id"], {}).get("context", "") != entry.get("context", "")
               or markers(cache.get(entry["id"], {}).get("text", "")) != markers(entry["text"])]
    for start in range(0, len(pending), batch_size):
        batch = pending[start:start + batch_size]
        translated = translate_checked(model, locale, batch)
        for item in batch:
            candidate = polish(locale, item["text"], translated[item["id"]])
            cache[item["id"]] = {"source": item["text"], "context": item.get("context", ""), "text": candidate}
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{locale}: {min(start + len(batch), len(pending))}/{len(pending)} new strings", flush=True)

    output_root = ROOT / "web/config/locales" / locale
    output_root.mkdir(parents=True, exist_ok=True)
    reviewed_path = ROOT / "tools/i18n/reviewed" / f"{locale}.json"
    reviewed = json.loads(reviewed_path.read_text(encoding="utf-8")) if reviewed_path.exists() else {}
    entry_by_id = {entry["id"]: entry for entry in entries}
    unknown = sorted(set(reviewed) - set(entry_by_id))
    if unknown:
        raise RuntimeError(f"{locale}: reviewed overrides contain unknown IDs: {unknown[:3]}")
    for entry_id, text in reviewed.items():
        if not isinstance(text, str) or markers(text) != markers(entry_by_id[entry_id]["text"]):
            raise RuntimeError(f"{locale}: reviewed override changed protected markers: {entry_id}")
    localized = copy.deepcopy(source)
    for entry in entries:
        file_name, raw_pointer = entry["id"].split(":", 1)
        final_text = reviewed.get(entry["id"], cache[entry["id"]]["text"])
        set_pointer(localized[file_name], raw_pointer, polish(locale, entry["text"], final_text))
    for name, data in localized.items():
        (output_root / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    digest = hashlib.sha256("\n".join(item["text"] for item in entries).encode()).hexdigest()
    print(json.dumps({"locale": locale, "strings": len(entries), "reviewed": len(reviewed),
                      "sourceSha256": digest, "output": str(output_root)}, ensure_ascii=False))


def main() -> int:
    options = cli()
    locales = list(TARGETS) if options.locale == "all" else [options.locale]
    for locale in locales:
        translate_locale(locale, options.model, options.batch_size, options.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
