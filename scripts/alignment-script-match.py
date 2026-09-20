#!/usr/bin/env python3
"""Was the low score caused by the missing arc, or by the audio?

Two words in the first alignment scored far below the rest while having been read correctly:
`gate` at 0.1864, immediately after an inserted "wooden", and `made` at 0.4990, immediately
before an omitted "golden". Both sit next to a place where the script did not match what was
said. Linear forced alignment has no arc for a word that is not in the script: the expected
words are a chain, every frame must be accounted for by some word in that chain, and the
aligner can neither emit the extra word nor skip its audio nor refuse. So the unscripted audio
is absorbed by a neighbour and the neighbour's score collapses.

That is a hypothesis about a mechanism, and it is cheap to falsify: give the aligner a script
that does match, and see whether those two words come back.

    python scripts/alignment-script-match.py --skip-record

Three alignments of the SAME audio through the SAME model:

    baseline   the passage as written              (reproduces the first run)
    +wooden    "Near the tall wooden gate"         (the insertion written into the script)
    -golden    "The light made circles on the path" (the omission written into the script)

The emission - the model's frame-by-frame output - is computed once and reused, so the only
thing that differs between the three is the sequence of words the aligner is told to fit.

This answers one question and no others. With an error written into the script there is no
error left to detect, so nothing here says anything about thresholds, and the script prints no
verdict about them.

The control matters as much as the two words: if every word's score moves, the comparison is
meaningless, so the median over the words present in both scripts is reported alongside.
"""
import argparse
import importlib.util
import json
import os
import pathlib
import statistics
import sys
import traceback

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")

_spec = importlib.util.spec_from_file_location(
    "alignment_probe", pathlib.Path(__file__).with_name("alignment-probe.py"))
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)

# The words the hypothesis is about, by their index in the passage as written.
TALL, GATE, MADE, GOLDEN, CIRCLES, HEDGEHOG = 20, 21, 12, 13, 14, 25
INSERTED = "wooden"


def variant_with_insertion(base, after_index, word):
    """The script with `word` written in after `after_index`.

    Every entry carries the index it had in the passage as written, so the two alignments can
    be compared word by word without anyone counting shifted positions by hand. The inserted
    word has no such index, because it corresponds to nothing in the original.
    """
    pairs = [(index, text) for index, text in enumerate(base)]
    pairs.insert(after_index + 1, (None, word))
    return pairs


def variant_without(base, drop_index):
    """The script with the word at `drop_index` taken out."""
    return [(index, text) for index, text in enumerate(base) if index != drop_index]


def compare(baseline_rows, variant_rows):
    """Score changes for the words both scripts contain, keyed by the original index."""
    variant = {row["source_index"]: row for row in variant_rows if row["source_index"] is not None}
    shared = []
    for row in baseline_rows:
        other = variant.get(row["source_index"])
        if other is None:
            continue
        shared.append({
            "index": row["source_index"],
            "word": row["word"],
            "before": row["score"],
            "after": other["score"],
            "delta": round(other["score"] - row["score"], 4),
        })
    return shared


def median_delta(shared, exclude=()):
    """The control: what the rest of the reading did. If this moves, nothing else means much."""
    deltas = [row["delta"] for row in shared if row["index"] not in exclude]
    return round(statistics.median(deltas), 4) if deltas else 0.0


def print_variant(title, description, shared, watch, exclude):
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)
    print(f"  script: {description}\n")
    print(f"  {'word':<12}{'before':>9}{'after':>9}{'change':>9}")
    for index in watch:
        row = next((r for r in shared if r["index"] == index), None)
        if row is None:
            print(f"  {'(index ' + str(index) + ' not in this script)':<12}")
            continue
        print(f"  {row['word']:<12}{row['before']:>9.4f}{row['after']:>9.4f}{row['delta']:>+9.4f}")
    others = [r for r in shared if r["index"] not in exclude]
    print(f"\n  control - the other {len(others)} words present in both scripts:")
    print(f"    median change {median_delta(shared, exclude):+.4f}, "
          f"largest {max((r['delta'] for r in others), default=0):+.4f}, "
          f"smallest {min((r['delta'] for r in others), default=0):+.4f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", default="alignment-probe.wav")
    parser.add_argument("--json", default="alignment-script-match.json")
    parser.add_argument("--skip-record", action="store_true",
                        help="accepted and ignored; this probe never records, it only re-aligns")
    args = parser.parse_args()

    destination = os.path.abspath(args.json)
    print(f"Result will be written to: {destination}")
    print(f"Running in: {os.getcwd()}")

    base = probe.normalised_words(probe.PASSAGE)
    expected = {TALL: "tall", GATE: "gate", MADE: "made", GOLDEN: "golden",
                CIRCLES: "circles", HEDGEHOG: "hedgehog"}
    wrong = {i: (w, base[i]) for i, w in expected.items() if base[i] != w}
    if wrong:
        print(f"The passage and the indices disagree: {wrong}. Fix before trusting anything.")
        return 2

    audio_path, problem = probe.locate_audio(args.audio)
    if problem:
        print("\n" + problem)
        return 4
    print(f"reading {audio_path}")

    try:
        import torch
        import torchaudio
    except ImportError:
        print("pip install torch torchaudio")
        return 1

    waveform, sample_rate, problem = probe.read_audio(audio_path)
    if problem:
        print(problem)
        return 4
    peak = float(waveform.abs().max()) if waveform.numel() else 0.0
    duration = waveform.size(1) / sample_rate if waveform.numel() else 0.0
    print(f"{duration:.1f}s at {sample_rate}Hz, peak amplitude {peak:.4f}")
    if peak < 1e-4:
        print("That is silence. Re-record before running this.")
        return 5

    print(f"\ntorchaudio {torchaudio.__version__}; loading the MMS_FA aligner...")
    try:
        bundle = torchaudio.pipelines.MMS_FA
        model = bundle.get_model(with_star=False)
        tokenizer = bundle.get_tokenizer()
        aligner = bundle.get_aligner()
    except Exception as error:
        print(f"ALIGNER LOAD FAILED: {type(error).__name__}: {error}")
        return 1

    if waveform.size(0) > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != bundle.sample_rate:
        waveform = torchaudio.functional.resample(waveform, sample_rate, bundle.sample_rate)

    # Once. Every variant below is aligned against this same tensor, so a difference between
    # them cannot come from the audio or the model - only from the words they were given.
    try:
        with torch.inference_mode():
            emission, _ = model(waveform)
    except Exception as error:
        print(f"COULD NOT RUN THE MODEL: {type(error).__name__}: {error}")
        traceback.print_exc()
        return 6
    ratio = waveform.size(1) / emission.size(1) / bundle.sample_rate
    print("emission computed once and shared by all three alignments")

    def align(pairs, label):
        try:
            with torch.inference_mode():
                spans = aligner(emission[0], tokenizer([text.lower() for _, text in pairs]))
        except Exception as error:
            print(f"ALIGNMENT FAILED for {label}: {type(error).__name__}: {error}")
            traceback.print_exc()
            return None
        if len(spans) != len(pairs):
            print(f"{label}: {len(spans)} spans for {len(pairs)} words; every row would be "
                  "against the wrong word. Stopping.")
            return None
        return [{
            "source_index": source_index,
            "word": text,
            "score": round(float(probe.word_score(word_spans)), 4),
            "start": round(word_spans[0].start * ratio, 2),
            "end": round(word_spans[-1].end * ratio, 2),
        } for (source_index, text), word_spans in zip(pairs, spans)]

    baseline = align([(index, text) for index, text in enumerate(base)], "baseline")
    inserted = align(variant_with_insertion(base, TALL, INSERTED), "+wooden")
    removed = align(variant_without(base, GOLDEN), "-golden")
    if baseline is None or inserted is None or removed is None:
        return 6

    print(f"\nbaseline reproduces the first run: 'gate' {baseline[GATE]['score']:.4f}, "
          f"'made' {baseline[MADE]['score']:.4f}")

    insertion_shared = compare(baseline, inserted)
    omission_shared = compare(baseline, removed)
    print_variant("+wooden - the insertion written into the script",
                  "Near the tall wooden gate, she saw ...",
                  insertion_shared, [TALL, GATE], (TALL, GATE))
    wooden = next(r for r in inserted if r["source_index"] is None)
    print(f"\n  the inserted '{wooden['word']}' itself scored {wooden['score']:.4f} "
          f"over {wooden['start']}-{wooden['end']}s")

    print_variant("-golden - the omission written into the script",
                  "The light made circles on the path.",
                  omission_shared, [MADE, CIRCLES], (MADE, CIRCLES))

    print("\n" + "=" * 78)
    print("This test answers one question: was the low score caused by the missing arc.")
    print("With the errors written into the script there are no errors left to detect, so")
    print("nothing here says anything about a threshold. No verdict on that is printed.")
    print("=" * 78)

    with open(destination, "w", encoding="utf-8") as handle:
        json.dump({
            "audio_path": audio_path,
            "audio_seconds": round(duration, 1),
            "baseline": baseline,
            "with_insertion": inserted,
            "without_omission": removed,
            "insertion_comparison": insertion_shared,
            "omission_comparison": omission_shared,
            "insertion_control_median_delta": median_delta(insertion_shared, (TALL, GATE)),
            "omission_control_median_delta": median_delta(omission_shared, (MADE, CIRCLES)),
        }, handle, indent=1)
    print(f"\nWROTE: {destination}")
    print("Send me that file.")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        traceback.print_exc()
        print("\nStopped on the error above and wrote no JSON.")
        print("Send me everything the terminal printed, starting from the command itself.")
        code = 7
    if code:
        print(f"\nFinished with exit code {code} and no result file.")
    sys.exit(code)
