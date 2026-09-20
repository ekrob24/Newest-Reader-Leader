#!/usr/bin/env python3
"""The self-correction reading: the error class we have never measured.

The first recording was missing it, and it is the most common thing a real child does. A child
who says "hedge- hedgehog" has read the word correctly. If alignment scores that like an error
we will flag exactly the readers who are working hardest, and no threshold anywhere fixes it.

    pip install torch torchaudio numpy sounddevice soundfile
    python scripts/alignment-probe2.py                # record, then align
    python scripts/alignment-probe2.py --skip-record  # re-align the same wav

Same passage as the first run, deliberately: it gives `gate` and `hedge` a second reading, and
the multi-reader reference distribution only means anything if everyone reads the same words.

Five deliberate events, and only two of them are errors:

    read correctly, must NOT be flagged
      4  lantern   part-word restart  "lan- lantern"
     35  watched   whole-word restart "washed, watched"
     20/21 tall/gate     the words either side of an inserted "wooden"
    not read, must be flagged
     13  golden    omitted
     25  hedgehog  read as "hedgerow"

Two kinds of self-correction rather than one because they are not the same acoustically. A
part-word restart leaves a fragment of the target itself in the audio; a whole-word restart
leaves a different word. Either could behave differently and both are ordinary child reading.

Every word is tagged with its shape - syllables, coda, position against punctuation - and the
rows are appended to probe-results/reading-corpus.jsonl keyed by reader. That file is the
reference distribution the multi-reader run needs: per-word scores across readers who read the
word correctly. It costs nothing to accumulate now and is expensive to reconstruct later.

No threshold verdict is printed. What matters here is where the two self-corrections rank,
and ranking is reported directly.
"""
import argparse
import importlib.util
import json
import os
import pathlib
import sys
import time
import traceback

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")

_here = pathlib.Path(__file__).parent


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, _here / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load("alignment_probe", "alignment-probe.py")
wordshape = _load("wordshape", "wordshape.py")

PASSAGE = probe.PASSAGE

# index -> (kind, what the reader does)
EVENTS = {
    4: ("self_correction_part", "say 'lan-' then stop, then say 'lantern' properly"),
    13: ("omission", "SKIP 'golden' - say 'The light made circles on the path'"),
    25: ("substitution", "say 'hedgerow' instead of 'hedgehog'"),
    35: ("self_correction_whole", "say 'washed', then immediately correct to 'watched'"),
}
INSERTION_WORD = "wooden"
INSERTION_SITE = (20, 21)
TRUE_ERRORS = ("omission", "substitution")
SELF_CORRECTIONS = ("self_correction_part", "self_correction_whole")


def classify(index):
    kind = EVENTS.get(index, (None, None))[0]
    if kind is None and index in INSERTION_SITE:
        return "insertion_site"
    return kind


def build_rows(words, spans, ratio):
    """One row per expected word, carrying its score and its shape."""
    tags = wordshape.shapes(PASSAGE)
    if len(tags) != len(words):
        raise ValueError(f"{len(tags)} shape records for {len(words)} words")
    rows = []
    for index, (word, word_spans, tag) in enumerate(zip(words, spans, tags)):
        kind = classify(index)
        rows.append({
            "index": index,
            "word": word,
            "score": round(float(probe.word_score(word_spans)), 4),
            "start": round(word_spans[0].start * ratio, 2),
            "end": round(word_spans[-1].end * ratio, 2),
            "event": kind,
            # Only the two true errors were not read. Everything else was, including both
            # self-corrections and the words either side of the insertion.
            "read_correctly": kind not in TRUE_ERRORS,
            "syllables": tag["syllables"],
            "coda": tag["coda"],
            "before_comma": tag["before_comma"],
            "before_full_stop": tag["before_full_stop"],
            "sentence_initial": tag["sentence_initial"],
        })
    return rows


def ranking(rows):
    """Where each word sits when the reading is ordered worst-scoring first.

    This is the shape the teacher's review queue has, so it is the shape the measurement
    should have too: not "is it over a threshold" but "how far down the list is it".
    """
    order = sorted(rows, key=lambda r: r["score"])
    return {row["index"]: place for place, row in enumerate(order, start=1)}


def recall_at_k(rows, k):
    """Of the real errors, how many are in the k lowest-scoring words."""
    errors = [r for r in rows if r["event"] in TRUE_ERRORS]
    if not errors:
        return 0.0, 0, 0
    places = ranking(rows)
    seen = sum(1 for r in errors if places[r["index"]] <= k)
    return round(seen / len(errors), 4), seen, len(errors)


def report(rows):
    places = ranking(rows)
    print(f"{'#':>3}  {'word':<12}{'score':>8}{'rank':>6}  {'syll':>4} {'coda':<10}note")
    print("-" * 82)
    for row in rows:
        note = ""
        if row["event"] in TRUE_ERRORS:
            note = f"<<< {row['event'].upper()} - not read"
        elif row["event"] in SELF_CORRECTIONS:
            note = f"<<< {row['event'].replace('_', ' ')} - READ, must not be flagged"
        elif row["event"] == "insertion_site":
            note = f"<<< beside the inserted '{INSERTION_WORD}' - read"
        boundary = "," if row["before_comma"] else "." if row["before_full_stop"] else ""
        print(f"{row['index']:>3}  {row['word'] + boundary:<12}{row['score']:>8.4f}"
              f"{places[row['index']]:>6}  {row['syllables']:>4} {row['coda']:<10}{note}")

    print("\n" + "=" * 82)
    print("1. THE TWO SELF-CORRECTIONS - both words were read, neither may be flagged")
    print("=" * 82)
    worst_error_rank = max((places[r["index"]] for r in rows if r["event"] in TRUE_ERRORS),
                           default=len(rows))
    for row in rows:
        if row["event"] not in SELF_CORRECTIONS:
            continue
        place = places[row["index"]]
        kind = "part-word restart" if row["event"].endswith("part") else "whole-word restart"
        verdict = ("ABOVE the worst real error - it would be flagged before some real errors"
                   if place <= worst_error_rank else
                   "below every real error in the queue")
        print(f"  {kind:<20} '{row['word']}' {row['score']:.4f}, rank {place} of {len(rows)} - {verdict}")

    print("\n" + "=" * 82)
    print("2. WHERE THE REAL ERRORS SIT IN THE QUEUE")
    print("=" * 82)
    for row in rows:
        if row["event"] in TRUE_ERRORS:
            print(f"  {row['event']:<14} '{row['word']}' {row['score']:.4f}, rank {places[row['index']]}")
    for k in (2, 3, 5, 8):
        rate, seen, total = recall_at_k(rows, k)
        print(f"  recall@{k}: the teacher sees {seen} of {total} real errors in the {k} lowest-scoring words")
    print("  Two errors is an anecdote, not a rate. This exists so the multi-reader run reports one.")

    print("\n" + "=" * 82)
    print("3. SCORE AGAINST WORD SHAPE - the question is whether score measures the word")
    print("=" * 82)
    read = [r for r in rows if r["read_correctly"]]
    for label, key in (("one syllable", lambda r: r["syllables"] == 1),
                       ("two or more", lambda r: r["syllables"] > 1),
                       ("stop-final", lambda r: r["coda"] == "stop"),
                       ("affricate-final", lambda r: r["coda"] == "affricate"),
                       ("vowel-final", lambda r: r["coda"] == "none"),
                       ("before a comma", lambda r: r["before_comma"]),
                       ("before a full stop", lambda r: r["before_full_stop"]),
                       ("mid-phrase", lambda r: not r["before_comma"] and not r["before_full_stop"])):
        group = [r["score"] for r in read if key(r)]
        if group:
            group.sort()
            median = group[len(group) // 2] if len(group) % 2 else (group[len(group) // 2 - 1] + group[len(group) // 2]) / 2
            print(f"  {label:<20} n={len(group):>2}  median {median:.4f}  lowest {min(group):.4f}")
    print("  One reader. Suggestive at best - the multi-reader run is what settles this.")


def record(path, seconds):
    try:
        import sounddevice as sd
        import soundfile as sf
    except ImportError:
        print("pip install numpy sounddevice soundfile")
        return False
    words = probe.normalised_words(PASSAGE)
    print("\n" + "=" * 82)
    print("READ THIS ALOUD, with FIVE deliberate moments:\n")
    print(PASSAGE)
    print("\nIn the order you reach them:\n")
    print(f"  1. RESTART part-word  word  4 - {EVENTS[4][1]}")
    print(f"  2. OMISSION           word 13 - {EVENTS[13][1]}")
    print(f"  3. INSERTION          after word 20 ('{words[20]}') - add '{INSERTION_WORD}', "
          f"so 'the tall {INSERTION_WORD} gate'")
    print(f"  4. SUBSTITUTION       word 25 - {EVENTS[25][1]}")
    print(f"  5. RESTART whole-word word 35 - {EVENTS[35][1]}")
    print("\nThe two restarts are the point of this recording. Do them the way a child does:")
    print("quickly, without a pause for thought, and carry straight on.")
    print("\nEverything else: your natural pace. Do not over-enunciate - careful reading is")
    print("not what we are measuring against.")
    print("=" * 82)
    input("\nPress Enter, wait for RECORDING, then start reading.\n")
    audio = sd.rec(int(seconds * 16000), samplerate=16000, channels=1, dtype="float32")
    print(f"RECORDING {seconds}s - go.")
    sd.wait()
    sf.write(path, audio, 16000)
    print(f"Saved {path}")
    return True


def append_to_corpus(rows, reader, audio_path, corpus_path):
    """One line per word per reader. The multi-reader reference distribution is this file
    grouped by word, over the readers who read that word correctly."""
    os.makedirs(os.path.dirname(corpus_path) or ".", exist_ok=True)
    with open(corpus_path, "a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps({
                "reader": reader,
                "run": "probe2",
                "recorded": time.strftime("%Y-%m-%d"),
                "audio": os.path.basename(audio_path),
                **row,
            }) + "\n")
    return corpus_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", default="alignment-probe2.wav")
    parser.add_argument("--json", default="alignment-probe2.json")
    parser.add_argument("--corpus", default=os.path.join("probe-results", "reading-corpus.jsonl"))
    parser.add_argument("--reader", default="adult-1",
                        help="a label for whoever read it, so the corpus can be grouped by reader")
    parser.add_argument("--seconds", type=int, default=50)
    parser.add_argument("--skip-record", action="store_true")
    args = parser.parse_args()

    destination = os.path.abspath(args.json)
    print(f"Result will be written to: {destination}")
    print(f"Running in: {os.getcwd()}")

    words = probe.normalised_words(PASSAGE)
    expected = {4: "lantern", 13: "golden", 20: "tall", 21: "gate", 25: "hedgehog", 35: "watched"}
    wrong = {i: (w, words[i]) for i, w in expected.items() if words[i] != w}
    if wrong:
        print(f"The passage and the event indices disagree: {wrong}. Fix before trusting anything.")
        return 2

    if not args.skip_record and not record(args.audio, args.seconds):
        return 1

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
        print("That is silence. Nothing was captured. Re-record.")
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

    started = time.time()
    try:
        with torch.inference_mode():
            emission, _ = model(waveform)
            spans = aligner(emission[0], tokenizer([w.lower() for w in words]))
    except Exception as error:
        print(f"ALIGNMENT FAILED: {type(error).__name__}: {error}")
        traceback.print_exc()
        return 6
    elapsed = time.time() - started
    if len(spans) != len(words):
        print(f"{len(spans)} spans for {len(words)} words; every row would be against the "
              "wrong word. Stopping.")
        return 3
    ratio = waveform.size(1) / emission.size(1) / bundle.sample_rate

    rows = build_rows(words, spans, ratio)
    seconds_of_audio = waveform.size(1) / bundle.sample_rate
    print(f"\naligned {seconds_of_audio:.1f}s in {elapsed:.1f}s "
          f"({seconds_of_audio / max(elapsed, .01):.1f}x real time)\n")
    report(rows)

    corpus = os.path.abspath(args.corpus)
    append_to_corpus(rows, args.reader, audio_path, corpus)
    with open(destination, "w", encoding="utf-8") as handle:
        json.dump({
            "passage": PASSAGE,
            "reader": args.reader,
            "audio_path": audio_path,
            "audio_seconds": round(seconds_of_audio, 1),
            "align_seconds": round(elapsed, 1),
            "recall_at_k": {str(k): recall_at_k(rows, k)[0] for k in (2, 3, 5, 8)},
            "rows": rows,
        }, handle, indent=1)
    print(f"\nWROTE: {destination}")
    print(f"APPENDED {len(rows)} rows for reader '{args.reader}' to: {corpus}")
    print("Send me both files.")
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
