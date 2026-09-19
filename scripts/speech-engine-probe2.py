#!/usr/bin/env python3
"""
Isolate what went wrong in the first probe: the model, the settings, or the approach.

Reuses reading-probe.wav, so every run sees identical audio and the only thing changing is
the configuration. Run 1 reproduces the first probe's baseline as a control.

    python speech-engine-probe2.py

Two defaults in faster-whisper explain most of what we saw, and both are tested here:

  condition_on_previous_text=True   each segment is decoded conditioned on the previous
                                    output, so once a long initial_prompt derails the
                                    decoder the damage cascades through the rest.
  vad_filter=False                  silence is fed to the model, and Whisper hallucinates
                                    text over silence. "Anishone." at p=0.077 is that.

It also tries `hotwords`, which biases toward a short vocabulary rather than prepending the
whole passage as prior context. That is the mechanism we actually want, if any is usable.
"""
import argparse
import json
import os
import sys
import time

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

PASSAGE = (
    "Amina carried a little lantern into the garden at dusk. "
    "The light made golden circles on the path. "
    "Near the tall gate, she saw a hedgehog sniffing beside the flowers. "
    "Amina stood very still, then watched it hurry safely under the hedge."
)
# The words a reading tutor would bias toward: the content words of this passage only.
HOTWORDS = "Amina lantern garden dusk golden circles path gate hedgehog sniffing flowers hedge"
MISREAD_EXPECTED = "hedgehog"
MISREAD_SPOKEN = "hedgerow"

RUNS = [
    ("1. distil-small.en, defaults (control)", "distil-small.en", {}),
    ("2. distil-small.en + VAD + no carry-over", "distil-small.en", {"vad_filter": True, "condition_on_previous_text": False}),
    ("3. small.en + VAD + no carry-over", "small.en", {"vad_filter": True, "condition_on_previous_text": False}),
    ("4. small.en + hotwords (targeted bias)", "small.en", {"vad_filter": True, "condition_on_previous_text": False, "hotwords": HOTWORDS}),
    ("5. small.en + full passage as initial_prompt", "small.en", {"vad_filter": True, "condition_on_previous_text": False, "initial_prompt": PASSAGE}),
]


def words_of(text):
    return [w.strip(".,!?;:\"'").lower() for w in text.split() if w.strip(".,!?;:\"'")]


def score(transcript):
    """How close to the passage, and what happened to the deliberately misread word."""
    said = words_of(transcript)
    want = words_of(PASSAGE)
    import difflib
    matcher = difflib.SequenceMatcher(None, want, said)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    lowered = transcript.lower()
    if MISREAD_SPOKEN in lowered and MISREAD_EXPECTED not in lowered:
        misread = "reported the misread word"
    elif MISREAD_EXPECTED in lowered and MISREAD_SPOKEN not in lowered:
        misread = "REPAIRED to the expected word"
    elif MISREAD_EXPECTED in lowered and MISREAD_SPOKEN in lowered:
        misread = "both present"
    else:
        misread = "neither - heard something else"
    return {"matched_words": matched, "expected_words": len(want), "heard_words": len(said),
            "match_rate": round(matched / max(1, len(want)), 3), "misread": misread}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", default="reading-probe.wav")
    args = parser.parse_args()
    if not os.path.exists(args.audio):
        print(f"No {args.audio}. Run speech-engine-probe.py first, or pass --audio.")
        return 1

    from faster_whisper import WhisperModel

    models = {}
    results = []
    for label, model_name, options in RUNS:
        if model_name not in models:
            print(f"\nLoading {model_name} (first use downloads it)...")
            t0 = time.time()
            try:
                models[model_name] = WhisperModel(model_name, device="cpu", compute_type="int8")
            except Exception as error:
                print(f"  could not load {model_name}: {type(error).__name__}: {error}")
                continue
            print(f"  loaded in {time.time() - t0:.1f}s")
        model = models[model_name]

        t0 = time.time()
        segments, info = model.transcribe(args.audio, language="en", word_timestamps=True, **options)
        text, low = [], []
        for segment in segments:
            text.append(segment.text.strip())
            for word in (segment.words or []):
                low.append((word.probability, word.word.strip()))
        elapsed = time.time() - t0
        transcript = " ".join(text)
        result = {"label": label, "model": model_name, "options": {k: (v if not isinstance(v, str) else v[:40] + "...") for k, v in options.items()},
                  "transcript": transcript, "seconds": round(elapsed, 1),
                  "realtime_factor": round(info.duration / max(elapsed, 0.01), 1), **score(transcript)}
        results.append(result)
        print(f"\n--- {label} ---")
        print(f"  {elapsed:.1f}s ({result['realtime_factor']}x real time) | matched {result['matched_words']}/{result['expected_words']} words ({result['match_rate']:.0%}) | {result['misread']}")
        print(f"  {transcript}")
        if low:
            low.sort()
            print("  lowest confidence: " + ", ".join(f"{w}={p:.2f}" for p, w in low[:5]))

    print("\n" + "=" * 78)
    print(f"{'run':<46}{'match':>8}{'speed':>8}  misread word")
    print("=" * 78)
    for r in results:
        print(f"{r['label']:<46}{r['match_rate']:>7.0%}{r['realtime_factor']:>7}x  {r['misread']}")

    with open("speech-engine-probe2.json", "w", encoding="utf-8") as handle:
        json.dump({"passage": PASSAGE, "results": results}, handle, indent=1)
    print("\nWritten to speech-engine-probe2.json - send me that.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
