#!/usr/bin/env python3
"""
Does faster-whisper work for us, and can it be told the expected passage?

Runs on a machine with a microphone. It records you reading a known passage with one word
deliberately misread, then transcribes the same audio three ways and prints what each one
did with the misread word.

The question this exists to answer is not "is the transcript good". It is the opposite:
biasing a decoder toward the text we expect is exactly the mechanism that would quietly
repair a child's mistake into the word we wanted. A transcript that comes back as the
passage as written, whatever was said, is the worst outcome, not the best.

    pip install faster-whisper sounddevice soundfile
    python speech-engine-probe.py

Options:
    --seconds 35            how long to record
    --model distil-small.en which model to load
    --audio FILE.wav        skip recording and use a file you already have
"""
import argparse
import difflib
import json
import sys
import time

PASSAGE = (
    "Amina carried a little lantern into the garden at dusk. "
    "The light made golden circles on the path. "
    "Near the tall gate, she saw a hedgehog sniffing beside the flowers. "
    "Amina stood very still, then watched it hurry safely under the hedge."
)
# One clear substitution, so the result cannot be ambiguous.
MISREAD_EXPECTED = "hedgehog"
MISREAD_SPOKEN = "hedgerow"


def record(path: str, seconds: int) -> bool:
    try:
        import sounddevice as sd
        import soundfile as sf
    except ImportError:
        print("Recording needs two more packages:\n    pip install sounddevice soundfile")
        return False
    print("\n" + "=" * 72)
    print("READ THIS ALOUD, at a normal pace:\n")
    print(PASSAGE)
    print(f"\n>>> But say '{MISREAD_SPOKEN}' where it says '{MISREAD_EXPECTED}'. That is the point of the test.")
    print("=" * 72)
    input("\nPress Enter when you are ready, then start reading.\n")
    print(f"Recording for {seconds} seconds...")
    try:
        audio = sd.rec(int(seconds * 16000), samplerate=16000, channels=1, dtype="int16")
        sd.wait()
    except Exception as error:
        print(f"Could not record: {error}")
        return False
    sf.write(path, audio, 16000)
    print(f"Saved {path}")
    return True


def transcribe(model, path: str, label: str, **kwargs):
    started = time.time()
    segments, info = model.transcribe(path, language="en", word_timestamps=True, **kwargs)
    words = []
    text = []
    for segment in segments:
        text.append(segment.text.strip())
        for word in (segment.words or []):
            words.append({"word": word.word.strip(), "start": round(word.start, 2), "end": round(word.end, 2), "probability": round(word.probability, 3)})
    elapsed = time.time() - started
    transcript = " ".join(text)
    print(f"\n--- {label} ---")
    print(f"took {elapsed:.1f}s for {info.duration:.1f}s of audio  ({info.duration / elapsed:.1f}x real time)")
    print(f"transcript: {transcript}")
    return {"label": label, "transcript": transcript, "words": words, "seconds": round(elapsed, 2), "audio_seconds": round(info.duration, 2)}


def verdict(result):
    """Did it report what was said, or repair it to what was expected?"""
    lowered = result["transcript"].lower()
    said = MISREAD_SPOKEN in lowered
    repaired = MISREAD_EXPECTED in lowered
    if said and not repaired:
        return "REPORTED THE MISREAD WORD - usable for scoring"
    if repaired and not said:
        return "REPAIRED IT TO THE EXPECTED WORD - unusable for scoring a child"
    if said and repaired:
        return "reported both - inspect the transcript"
    return "neither word present - the recording or the model did not work"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=35)
    parser.add_argument("--model", default="distil-small.en")
    parser.add_argument("--audio", default="reading-probe.wav")
    parser.add_argument("--skip-record", action="store_true")
    args = parser.parse_args()

    if not args.skip_record and not record(args.audio, args.seconds):
        return 1

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("pip install faster-whisper")
        return 1

    print(f"\nLoading {args.model} (first run downloads it)...")
    started = time.time()
    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
    except Exception as error:
        print(f"MODEL LOAD FAILED: {type(error).__name__}: {error}")
        return 1
    print(f"loaded in {time.time() - started:.1f}s")

    results = [
        transcribe(model, args.audio, "A. no prompt (what it hears on its own)"),
        transcribe(model, args.audio, "B. initial_prompt = the expected passage", initial_prompt=PASSAGE),
        transcribe(model, args.audio, "C. prompt + greedy, no beam search", initial_prompt=PASSAGE, beam_size=1, temperature=0),
    ]

    print("\n" + "=" * 72)
    print("THE QUESTION THAT MATTERS")
    print("=" * 72)
    for result in results:
        print(f"{result['label']}\n    {verdict(result)}")

    print("\n" + "=" * 72)
    print("PER-WORD DETAIL (run A), lowest-confidence words first")
    print("=" * 72)
    lowest = sorted(results[0]["words"], key=lambda w: w["probability"])[:12]
    for word in lowest:
        print(f"  {word['word']:<18} p={word['probability']:<7} {word['start']}s-{word['end']}s")

    print("\n" + "=" * 72)
    print("HOW THE THREE TRANSCRIPTS DIFFER FROM THE PASSAGE")
    print("=" * 72)
    for result in results:
        diff = [line for line in difflib.unified_diff(PASSAGE.lower().split(), result["transcript"].lower().split(), lineterm="", n=0) if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))]
        print(f"{result['label']}: {len(diff)} word differences")

    with open("speech-engine-probe.json", "w", encoding="utf-8") as handle:
        json.dump({"passage": PASSAGE, "misread": {"expected": MISREAD_EXPECTED, "spoken": MISREAD_SPOKEN}, "results": results}, handle, indent=1)
    print("\nFull output written to speech-engine-probe.json - send me that file.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
