import json
from pathlib import Path

import pytest

from aplikaacja_tools import tts


def _make_fake_node_modules(root: Path) -> Path:
    ort_dist = root / "onnxruntime-web" / "dist"
    piper_build = root / "@diffusionstudio" / "piper-wasm" / "build"
    ort_dist.mkdir(parents=True)
    piper_build.mkdir(parents=True)
    (ort_dist / "ort-wasm-simd-threaded.mjs").write_bytes(b"ort-mjs")
    (ort_dist / "ort-wasm-simd-threaded.wasm").write_bytes(b"ort-wasm")
    (piper_build / "piper_phonemize.wasm").write_bytes(b"phon-wasm")
    (piper_build / "piper_phonemize.data").write_bytes(b"phon-data")
    return root


def test_build_chunks_onnx_and_writes_manifest(tmp_path: Path) -> None:
    nm = _make_fake_node_modules(tmp_path / "node_modules")
    onnx_payload = b"A" * 10 + b"B" * 10 + b"C" * 5
    cfg_payload = json.dumps({"audio": {"sample_rate": 22050}}).encode("utf-8")

    spec = tts.VoiceSpec(
        id="pl_PL-gosia-medium",
        name="Gosia",
        gender="female",
        quality="medium",
        license="CC0",
        source_name="rhasspy/piper-voices",
        onnx_url="https://example.invalid/gosia.onnx",
        config_url="https://example.invalid/gosia.onnx.json",
    )

    calls: list[str] = []

    def fake_fetch(url: str) -> bytes:
        calls.append(url)
        return onnx_payload if url.endswith(".onnx") else cfg_payload

    out = tmp_path / "dist"
    cache = tmp_path / "cache"
    manifest = tts.build(out, cache, nm, voices=[spec], fetch=fake_fetch, chunk_bytes=10)

    assert len(calls) == 2
    assert manifest["v"] == 1
    voice = manifest["voices"][0]
    assert voice["bytes"] == len(onnx_payload)
    assert voice["sampleRate"] == 22050
    assert len(voice["parts"]) == 3

    tts_dir = out / "tts"
    reassembled = b"".join((tts_dir / part).read_bytes() for part in voice["parts"])
    assert reassembled == onnx_payload
    assert (tts_dir / voice["config"]).read_bytes() == cfg_payload
    assert (tts_dir / manifest["runtime"]["ortWasm"]).read_bytes() == b"ort-wasm"

    headers = (out / "_headers").read_text("utf-8")
    assert "Cross-Origin-Resource-Policy: same-origin" in headers
    assert "Cross-Origin-Embedder-Policy: require-corp" in headers
    assert "/tts/manifest.json" in headers

    # Second run uses cache without refetching.
    tts.build(out, cache, nm, voices=[spec], fetch=fake_fetch, chunk_bytes=10)
    assert len(calls) == 2


def test_prepare_out_dir_refuses_unmarked_directory(tmp_path: Path) -> None:
    out = tmp_path / "foreign"
    out.mkdir()
    (out / "keep.txt").write_text("important", "utf-8")
    with pytest.raises(SystemExit):
        tts.prepare_out_dir(out)
