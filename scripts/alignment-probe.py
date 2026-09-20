#!/usr/bin/env python3
"""
Can forced alignment separate a child's real errors from the words she read correctly?

A different question from the transcription probes. Those asked "what did she say" over a
fifty-thousand-word vocabulary, and initial_prompt and hotwords are both just ways of leaning
on that same decoder, so they all failed the same way. This asks, for each expected word in
turn: how well does this audio match THIS word? Closed vocabulary, one target, one score.
"literal" cannot be emitted in place of "little", because it is not on the ballot.

    pip install torch torchaudio numpy sounddevice soundfile
    python scripts/alignment-probe.py            # records, then aligns
    python scripts/alignment-probe.py --skip-record   # re-align the same wav
    python scripts/alignment-probe.py --skip-record --no-self-correction

The last form is for a recording where the reader read "watched" straight through instead of
saying "washed" first. Word 35 is then an ordinary correctly-read word and is scored as one.

The aligner weights come down from download.pytorch.org on first run, about 1.2GB, once.

torchaudio's forced_align with the MMS_FA bundle, rather than WhisperX: it returns a
per-token score directly, which is the number the whole question turns on; it does not drag
in whisper and pyannote when only the aligner is wanted; and it fetches its weights straight
over https rather than through the HuggingFace cache, which already cost us a Windows symlink
failure. (The weights come from dl.fbaipublicfiles.com, not download.pytorch.org as an earlier
version of this note said.)

Note the probe never calls torchaudio.load. From torchaudio 2.9 that routes through TorchCodec,
a separate package a plain `pip install torch torchaudio` does not bring with it, so it raises
ImportError on a current install - and, before this was found, took the whole run down after
the recording and before anything was written.

The thing to distrust: forced alignment is forced. It must place every expected word
somewhere, including a word that was never spoken. The omitted word is the sharpest test in
the set, and a system that scores a skipped word as present is worse than useless.

The pure functions below (score_rows, build_verdict) are exercised by
scripts/alignment-probe-selftest.py without any model or audio, so an arithmetic mistake in
the verdict cannot hide behind a model download.
"""
import argparse
import glob
import json
import os
import re
import sys
import time
import traceback

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")

PASSAGE = (
    "Amina carried a little lantern into the garden at dusk. "
    "The light made golden circles on the path. "
    "Near the tall gate, she saw a hedgehog sniffing beside the flowers. "
    "Amina stood very still, then watched it hurry safely under the hedge."
)

# Word indices into the normalised passage, checked against the tokeniser at startup so a
# change to the passage cannot silently point them at the wrong words.
#
# Two of the four deliberate events are true errors: the word the child was meant to read was
# not read. Those must score LOW.
DELIBERATE = {
    13: ("omission", "SKIP 'golden' entirely - say 'The light made circles on the path'"),
    25: ("substitution", "say 'hedgerow' instead of 'hedgehog'"),
    35: ("self_correction", "say 'washed', then immediately correct yourself to 'watched'"),
}
TRUE_ERRORS = ("omission", "substitution")
# The other two are not errors of that kind. A self-correction ends with the right word said,
# and is extremely common in real child reading, so scoring it low would be a false
# correction: it belongs with the words read correctly, not with the errors. An insertion adds
# a word that is not on the ballot at all, so no row can carry its score; it can only show up
# as damage to the words either side of it, or as audio no expected word accounts for.
NOT_AN_ERROR = ("self_correction",)
INSERTION_WORD = "wooden"
INSERTION_SITE = (20, 21)  # between "tall" and "gate"
# The words the transcription probe reported wrong although they were read correctly.
PREVIOUSLY_FALSE = (3, 30, 31, 38)  # little, Amina, stood, safely


def normalised_words(text):
    return re.findall(r"[A-Za-z']+", text)


SELF_CORRECTION_INDEX = 35


def word_score(word_spans):
    """One word's alignment score: the mean of its token scores weighted by token duration.

    Weighted rather than plain so a long stressed vowel counts for more than the consonant
    beside it, and a one-token word is comparable with a five-token one. A word the aligner
    gave no audio at all scores zero rather than raising: no audio matched it, which is the
    strongest evidence of omission there is. Deliberate, not a division guard.

    Shared with alignment-script-match.py so the two cannot drift apart.
    """
    total = sum(s.end - s.start for s in word_spans)
    if not total:
        return 0.0
    return sum(s.score * (s.end - s.start) for s in word_spans) / total


def score_rows(words, spans, ratio, self_corrected=True):
    """One row per expected word: the duration-weighted mean of its token alignment scores.

    Weighted by token duration rather than a plain mean so that a long stressed vowel counts
    for more than the consonant beside it, and so a one-token word is comparable with a
    five-token one.

    `self_corrected=False` says the reader read "watched" straight through instead of saying
    "washed" first. The word is then an ordinary correctly-read word and must be scored as one:
    leaving it labelled would hold it out of the correctly-read pool and out of the errors, so
    it could neither drag the threshold down nor be caught doing so. The table still marks it,
    because a planned event that did not happen is worth seeing.
    """
    rows = []
    for index, (word, word_spans) in enumerate(zip(words, spans)):
        score = word_score(word_spans)
        kind = DELIBERATE.get(index, (None, None))[0]
        skipped = index == SELF_CORRECTION_INDEX and not self_corrected
        if skipped:
            kind = None
        if kind is None and index in INSERTION_SITE:
            kind = "insertion_site"
        rows.append({
            "index": index,
            "word": word,
            "score": round(float(score), 4),
            "start": round(word_spans[0].start * ratio, 2),
            "end": round(word_spans[-1].end * ratio, 2),
            "deliberate": kind,
            "planned_but_not_performed": skipped,
            "previously_false": index in PREVIOUSLY_FALSE,
        })
    return rows


def build_verdict(rows):
    """The only numbers that matter, computed once so the printing cannot disagree with them."""
    errors = [r for r in rows if r["deliberate"] in TRUE_ERRORS]
    # Every word that is not an omission or a substitution was read. That includes the two
    # words flanking the insertion and the self-corrected one, and they belong in this pool
    # even though they are also reported separately below.
    #
    # An earlier version held the flanking words out of both pools, on the reasoning that the
    # inserted word damages its neighbours and so their scores are not their own. That
    # reasoning is right about detecting the insertion and wrong about the threshold: a live
    # system does not know an insertion happened, so it cannot exempt the words either side.
    # Holding them out made a word that could only lower the threshold unable to lower it, and
    # on the first real recording that turned a NO GAP into a reported CLEAN GAP.
    correct = [r for r in rows if r["deliberate"] not in TRUE_ERRORS]
    if not errors or not correct:
        raise ValueError("no deliberate errors or no correctly-read words to compare")
    worst_correct = min(correct, key=lambda r: r["score"])
    best_error = max(errors, key=lambda r: r["score"])
    gap = worst_correct["score"] - best_error["score"]
    # The lowest threshold that catches every deliberate error sits just above the highest of
    # them; these are the correctly-read words it takes with it.
    false_corrections = sorted((r for r in correct if r["score"] <= best_error["score"]),
                               key=lambda r: r["score"])

    # Empty when the reader did not perform one. Section 2 then reports that, rather than
    # reporting a pass on a test that was never run.
    self_corrections = []
    for row in rows:
        if row["deliberate"] in NOT_AN_ERROR:
            self_corrections.append({
                **row,
                # Flagged if it falls at or below the lowest threshold that catches both
                # errors. It does not depend on a gap existing: a self-correction ends with
                # the right word said, so scoring it there is a false correction either way.
                "flagged": row["score"] <= best_error["score"],
            })

    before, after = rows[INSERTION_SITE[0]], rows[INSERTION_SITE[1]]
    return {
        "errors": errors,
        "worst_correct": worst_correct,
        "best_error": best_error,
        "gap": round(gap, 4),
        "clean_gap": gap > 0,
        "false_corrections": false_corrections,
        "false_correction_rate": round(len(false_corrections) / len(correct), 4),
        "words_read_correctly": len(correct),
        "self_corrections": self_corrections,
        "insertion": {
            "before": before,
            "after": after,
            "uncovered_seconds": round(after["start"] - before["end"], 2),
        },
        "previously_false": [
            {**rows[i], "above_highest_error": rows[i]["score"] > best_error["score"]}
            for i in PREVIOUSLY_FALSE
        ],
    }


def print_report(rows, verdict):
    print(f"{'#':>3}  {'word':<12}{'score':>8}  {'time':<14}note")
    print("-" * 78)
    for row in rows:
        if row["planned_but_not_performed"]:
            note = "(self-correction was planned here and not read)"
        elif row["deliberate"] == "insertion_site":
            note = f"<<< beside the inserted '{INSERTION_WORD}'"
        elif row["deliberate"] in NOT_AN_ERROR:
            note = f"<<< DELIBERATE {row['deliberate'].upper()} (must NOT be flagged)"
        elif row["deliberate"]:
            note = f"<<< DELIBERATE {row['deliberate'].upper()}"
        elif row["previously_false"]:
            note = "(transcription called this wrong)"
        else:
            note = ""
        line = f"{row['index']:>3}  {row['word']:<12}{row['score']:>8.4f}  {row['start']}-{row['end']}s"
        print(line.ljust(52) + note)

    worst, best = verdict["worst_correct"], verdict["best_error"]
    print("\n" + "=" * 78)
    print("1. IS THERE A THRESHOLD? omission and substitution against the words read correctly")
    print("=" * 78)
    for r in verdict["errors"]:
        print(f"  deliberate {r['deliberate']:<14} '{r['word']}'  {r['score']:.4f}")
    print(f"\n  lowest-scoring word read CORRECTLY: '{worst['word']}' (#{worst['index']}) {worst['score']:.4f}")
    print(f"  highest-scoring DELIBERATE error:   '{best['word']}' (#{best['index']}) {best['score']:.4f}")
    if verdict["clean_gap"]:
        print(f"\n  CLEAN GAP of {verdict['gap']:.4f}. A threshold anywhere between them separates every")
        print("  deliberate error from every word read correctly - on this one reading.")
    else:
        print(f"\n  NO GAP ({verdict['gap']:.4f}). '{worst['word']}' was read correctly and scores at or below")
        print(f"  the deliberate '{best['word']}'. No threshold separates them cleanly.")
        print(f"\n  The lowest threshold that catches both errors is just above {best['score']:.4f}, and it")
        print(f"  also flags {len(verdict['false_corrections'])} of the {verdict['words_read_correctly']} words read correctly "
              f"- a false-correction rate")
        print(f"  of {100 * verdict['false_correction_rate']:.1f}% on this reading:")
        for r in verdict["false_corrections"]:
            print(f"    '{r['word']}' (#{r['index']}) {r['score']:.4f}")

    print("\n" + "=" * 78)
    print("2. THE SELF-CORRECTION - it must NOT be flagged")
    print("=" * 78)
    if not verdict["self_corrections"]:
        skipped = next((r for r in rows if r["planned_but_not_performed"]), None)
        print("  Not read. The reader said '{}' straight through rather than correcting herself"
              .format(skipped["word"] if skipped else "watched"))
        print("  into it, so there is no self-correction in this audio to judge. It is scored")
        print("  above as an ordinary correctly-read word, which is what it was.")
        print("  This question is still open: it needs a recording that contains one.")
    for r in verdict["self_corrections"]:
        if not verdict["clean_gap"]:
            print(f"  '{r['word']}' {r['score']:.4f} - no threshold exists, so nothing to judge it against.")
        elif r["flagged"]:
            print(f"  '{r['word']}' {r['score']:.4f} - BELOW the threshold. It would be flagged as an error")
            print("  although the child ended up reading it correctly. That is a false correction.")
        else:
            print(f"  '{r['word']}' {r['score']:.4f} - above the threshold. Not flagged. Correct.")

    insertion = verdict["insertion"]
    before, after = insertion["before"], insertion["after"]
    print("\n" + "=" * 78)
    print("3. THE INSERTION - no row can carry it")
    print("=" * 78)
    print(f"  '{before['word']}' {before['score']:.4f}, ends {before['end']}s")
    print(f"  '{after['word']}' {after['score']:.4f}, starts {after['start']}s")
    print(f"  {insertion['uncovered_seconds']:.2f}s between them that no expected word accounts for.")
    print(f"  A spoken '{INSERTION_WORD}' takes roughly 0.4s. Near zero means the aligner absorbed the")
    print("  inserted word into its neighbours and an insertion is invisible to this method; near")
    print("  0.4s means the gap itself is the signal - and a duration is not a score.")

    print("\n" + "=" * 78)
    print("4. THE WORDS TRANSCRIPTION GOT WRONG THOUGH THEY WERE READ CORRECTLY")
    print("=" * 78)
    for r in verdict["previously_false"]:
        where = "above" if r["above_highest_error"] else "BELOW"
        print(f"  '{r['word']}' {r['score']:.4f} - {where} the highest deliberate error")


def record(path, seconds):
    try:
        import sounddevice as sd
        import soundfile as sf
    except ImportError:
        print("pip install sounddevice soundfile")
        return False
    words = normalised_words(PASSAGE)
    print("\n" + "=" * 78)
    print("READ THIS ALOUD, with FOUR deliberate mistakes:\n")
    print(PASSAGE)
    print("\nThe four mistakes, in the order you will reach them:\n")
    print(f"  1. OMISSION       word 13 - {DELIBERATE[13][1]}")
    print(f"  2. INSERTION      after word {INSERTION_SITE[0]} ('{words[INSERTION_SITE[0]]}') - "
          f"add '{INSERTION_WORD}', so 'the tall {INSERTION_WORD} gate'")
    print(f"  3. SUBSTITUTION   word 25 - {DELIBERATE[25][1]}")
    print(f"  4. SELF-CORRECT   word 35 - {DELIBERATE[35][1]}")
    print("\nEverything else: read normally, at your natural pace. Do not over-enunciate -")
    print("careful reading is not what we are measuring against.")
    print("=" * 78)
    input("\nPress Enter, wait for RECORDING, then start reading.\n")
    audio = sd.rec(int(seconds * 16000), samplerate=16000, channels=1, dtype="float32")
    print(f"RECORDING {seconds}s - go.")
    sd.wait()
    sf.write(path, audio, 16000)
    print(f"Saved {path}")
    return True


def read_audio(path):
    """Read a mono waveform without torchaudio.load.

    torchaudio 2.9 onwards routes load() through TorchCodec, a separate package that a plain
    `pip install torch torchaudio` does not bring with it, so the call raises ImportError on a
    current install. The probe records through soundfile and only ever reads its own 16kHz
    wav, so it reads it back the same way, and falls back to the standard library, which can
    handle 16-bit PCM unaided. Returns (tensor shaped (1, samples), sample_rate) or an
    explanation of every attempt that failed.
    """
    import torch

    attempts = []
    try:
        import soundfile as sf
        data, sample_rate = sf.read(path, dtype="float32", always_2d=True)
        waveform = torch.from_numpy(data).transpose(0, 1).contiguous()
        return waveform, sample_rate, None
    except Exception as error:
        attempts.append(f"  soundfile: {type(error).__name__}: {error}")

    try:
        import array
        import wave

        with wave.open(path, "rb") as handle:
            if handle.getsampwidth() != 2:
                raise ValueError(f"{handle.getsampwidth() * 8}-bit audio; this fallback reads 16-bit PCM")
            channels, sample_rate = handle.getnchannels(), handle.getframerate()
            samples = array.array("h")
            samples.frombytes(handle.readframes(handle.getnframes()))
        if sys.byteorder == "big":
            samples.byteswap()
        waveform = torch.tensor(samples, dtype=torch.float32).div(32768.0)
        return waveform.view(-1, channels).transpose(0, 1).contiguous(), sample_rate, None
    except Exception as error:
        attempts.append(f"  wave (stdlib): {type(error).__name__}: {error}")

    try:
        import torchaudio
        waveform, sample_rate = torchaudio.load(path)
        return waveform, sample_rate, None
    except Exception as error:
        attempts.append(f"  torchaudio.load: {type(error).__name__}: {error}")

    return None, None, "Could not read the audio. Every reader failed:\n" + "\n".join(attempts)


def locate_audio(path):
    """The recording is written relative to whatever directory the probe was run from, so a
    second run from somewhere else will not find it. Rather than let torchaudio raise a bare
    load error, look in the obvious places and say exactly which ones were tried."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [os.path.abspath(path), os.path.join(here, os.path.basename(path))]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate, None
    nearby = sorted(set(glob.glob("*.wav") + glob.glob(os.path.join(here, "*.wav"))))
    report = ["No audio file found. Looked for:"]
    report += [f"  {candidate}" for candidate in candidates]
    report.append(f"  (run from {os.getcwd()})")
    if nearby:
        report.append("wav files that ARE here - pass one with --audio:")
        report += [f"  {os.path.abspath(name)}" for name in nearby]
    else:
        report.append("No .wav files in either directory at all, so the recording was not")
        report.append("saved. Re-run without --skip-record to record it.")
    return None, "\n".join(report)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", default="alignment-probe.wav")
    parser.add_argument("--json", default="alignment-probe.json", help="where to write the result")
    parser.add_argument("--seconds", type=int, default=45)
    parser.add_argument("--skip-record", action="store_true",
                        help="align an existing --audio file instead of recording a new one")
    parser.add_argument("--no-self-correction", action="store_true",
                        help="the recording does not contain the self-correction: word 35 was "
                             "read straight through, so score it as an ordinary correct word")
    args = parser.parse_args()

    destination = os.path.abspath(args.json)
    print(f"Result will be written to: {destination}")
    print(f"Running in: {os.getcwd()}")

    words = normalised_words(PASSAGE)
    print(f"{len(words)} expected words.")
    expected = {13: "golden", 20: "tall", 21: "gate", 25: "hedgehog", 35: "watched"}
    wrong = {i: (w, words[i]) for i, w in expected.items() if words[i] != w}
    if wrong:
        print(f"The passage and the deliberate-error indices disagree: {wrong}")
        print("Fix that before trusting anything below.")
        return 2
    for index, (kind, _) in sorted(DELIBERATE.items()):
        print(f"  word {index} '{words[index]}' -> {kind}")

    if not args.skip_record and not record(args.audio, args.seconds):
        return 1

    audio_path, problem = locate_audio(args.audio)
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

    waveform, sample_rate, problem = read_audio(audio_path)
    if problem:
        print(problem)
        return 4
    peak = float(waveform.abs().max()) if waveform.numel() else 0.0
    duration = waveform.size(1) / sample_rate if waveform.numel() else 0.0
    print(f"{duration:.1f}s at {sample_rate}Hz, peak amplitude {peak:.4f}")
    if waveform.numel() == 0 or peak < 1e-4:
        print("That is silence. Nothing was captured, so no alignment would mean anything.")
        print("Re-run without --skip-record to record again.")
        return 5

    print(f"\ntorchaudio {torchaudio.__version__}; loading the MMS_FA aligner...")
    started = time.time()
    try:
        bundle = torchaudio.pipelines.MMS_FA
        model = bundle.get_model(with_star=False)
        tokenizer = bundle.get_tokenizer()
        aligner = bundle.get_aligner()
    except Exception as error:
        print(f"ALIGNER LOAD FAILED: {type(error).__name__}: {error}")
        return 1
    print(f"loaded in {time.time() - started:.1f}s")

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
    seconds_of_audio = waveform.size(1) / bundle.sample_rate
    ratio = waveform.size(1) / emission.size(1) / bundle.sample_rate

    if len(spans) != len(words):
        print(f"The aligner returned {len(spans)} spans for {len(words)} words. "
              "Every row below would be against the wrong word; stopping.")
        return 3

    self_corrected = not args.no_self_correction
    if not self_corrected:
        print("\n--no-self-correction: word 35 is scored as an ordinary correctly-read word.")
    rows = score_rows(words, spans, ratio, self_corrected)
    verdict = build_verdict(rows)

    print(f"\naligned {seconds_of_audio:.1f}s in {elapsed:.1f}s "
          f"({seconds_of_audio / max(elapsed, .01):.1f}x real time)\n")
    print_report(rows, verdict)

    with open(destination, "w", encoding="utf-8") as handle:
        json.dump({
            "passage": PASSAGE,
            "audio_seconds": round(seconds_of_audio, 1),
            "align_seconds": round(elapsed, 1),
            "gap": verdict["gap"],
            "clean_gap": verdict["clean_gap"],
            "worst_correct": verdict["worst_correct"],
            "best_error": verdict["best_error"],
            "false_correction_rate": verdict["false_correction_rate"],
            "false_corrections": verdict["false_corrections"],
            "words_read_correctly": verdict["words_read_correctly"],
            "insertion_uncovered_seconds": verdict["insertion"]["uncovered_seconds"],
            "self_correction_performed": self_corrected,
            "audio_path": audio_path,
            "rows": rows,
        }, handle, indent=1)
    print(f"\nWROTE: {destination}")
    print("Send me that file.")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        # A traceback alone leaves "it produced nothing" as the only visible result.
        traceback.print_exc()
        print("\nThe probe stopped on the error above and wrote no JSON.")
        print("Send me everything the terminal printed, starting from the command itself.")
        code = 7
    if code:
        print(f"\nFinished with exit code {code} and no result file.")
    sys.exit(code)
