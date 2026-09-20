#!/usr/bin/env python3
"""No model, no audio: does the probe's verdict arithmetic actually work?

The probe's conclusion is a comparison between two numbers, and a comparison written the
wrong way round still prints a confident answer. These cases feed score_rows and
build_verdict hand-made spans whose right answer is known, including cases that must come
out NO GAP - because a check that cannot fail is worse than no check.

    python alignment-probe-selftest.py
"""
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location(
    "alignment_probe", pathlib.Path(__file__).with_name("alignment-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Span:
    """Stands in for torchaudio's TokenSpan: the three fields score_rows reads."""

    def __init__(self, score, start, end):
        self.score = score
        self.start = start
        self.end = end


WORDS = probe.normalised_words(probe.PASSAGE)


def spans_for(scores, tokens_per_word=3, frames_per_token=2):
    """One list of spans per word, at the given per-word score, laid end to end."""
    spans, frame = [], 0
    for score in scores:
        word = []
        for _ in range(tokens_per_word):
            word.append(Span(score, frame, frame + frames_per_token))
            frame += frames_per_token
        spans.append(word)
    return spans


def scores_where(default, overrides):
    return [overrides.get(i, default) for i in range(len(WORDS))]


import contextlib
import io

failures = []


def check(name, condition, detail=""):
    print(f"  {'ok  ' if condition else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not condition:
        failures.append(name)


print(f"{len(WORDS)} words in the passage\n")

print("score_rows")
# A word whose tokens score differently must weight by duration, not take a plain mean.
mixed = [[Span(1.0, 0, 1), Span(0.0, 1, 9)]]  # 1 frame at 1.0, 8 frames at 0.0 -> 0.111
rows = probe.score_rows(WORDS[:1], mixed, ratio=0.02)
# Scores are rounded to four places for the table, so compare at that resolution.
check("weights each token by its duration", abs(rows[0]["score"] - 1 / 9) < 5e-5,
      f"got {rows[0]['score']}")
check("start and end are seconds, not frames", rows[0]["start"] == 0.0 and rows[0]["end"] == 0.18,
      f"got {rows[0]['start']}-{rows[0]['end']}")
# A word given no audio at all scores zero - not a crash, and not the token's own score.
zero = probe.score_rows(WORDS[:1], [[Span(0.5, 4, 4)]], ratio=0.02)
check("a word given no audio scores zero, and does not divide by zero",
      zero[0]["score"] == 0.0, f"got {zero[0]['score']}")

rows = probe.score_rows(WORDS, spans_for(scores_where(0.9, {})), ratio=0.02)
check("one row per expected word", len(rows) == len(WORDS), f"{len(rows)} rows")
check("row 13 is the omitted 'golden'", rows[13]["word"] == "golden"
      and rows[13]["deliberate"] == "omission")
check("row 25 is the substituted 'hedgehog'", rows[25]["word"] == "hedgehog"
      and rows[25]["deliberate"] == "substitution")
check("row 35 is the self-corrected 'watched'", rows[35]["word"] == "watched"
      and rows[35]["deliberate"] == "self_correction")
check("rows 20 and 21 flank the insertion",
      rows[20]["deliberate"] == rows[21]["deliberate"] == "insertion_site")
check("the four previously-false words are marked",
      [r["index"] for r in rows if r["previously_false"]] == [3, 30, 31, 38])
check("the previously-false words are the ones named",
      [rows[i]["word"] for i in (3, 30, 31, 38)] == ["little", "Amina", "stood", "safely"])
check("nothing else is marked deliberate",
      sum(1 for r in rows if r["deliberate"]) == 5)

print("\nbuild_verdict - the separation that must exist")
clean = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.88})), ratio=0.02))
check("errors well below correct reads -> CLEAN GAP", clean["clean_gap"] is True,
      f"gap {clean['gap']}")
check("the gap is worst-correct minus best-error", abs(clean["gap"] - 0.70) < 1e-6,
      f"got {clean['gap']}")
check("the highest error is the substitution, not the omission",
      clean["best_error"]["word"] == "hedgehog")
check("the self-correction is reported at all", len(clean["self_corrections"]) == 1,
      f"got {len(clean['self_corrections'])}")
check("a self-correction scoring high is not flagged",
      all(r["flagged"] is False for r in clean["self_corrections"]) and clean["self_corrections"] != [])

print("\nbuild_verdict - the separations that must NOT be claimed")
overlap = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.88, 7: 0.15})), ratio=0.02))
check("one correctly-read word below an error -> NO GAP", overlap["clean_gap"] is False,
      f"gap {overlap['gap']}, worst correct '{overlap['worst_correct']['word']}'")
check("the offending correct word is named", overlap["worst_correct"]["index"] == 7)

touching = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.90, 35: 0.88})), ratio=0.02))
check("an error scoring exactly a correct read is NOT a gap", touching["clean_gap"] is False,
      f"gap {touching['gap']}")

# The case the whole probe exists to catch: alignment is forced, so the omitted word may be
# scored as though it were present.
forced = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.92, 25: 0.20, 35: 0.88})), ratio=0.02))
check("an omission scored as present -> NO GAP", forced["clean_gap"] is False,
      f"gap {forced['gap']}, best error '{forced['best_error']['word']}'")
check("and the omission is named as the highest error",
      forced["best_error"]["word"] == "golden")

flagged = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.15})), ratio=0.02))
check("a self-correction scoring low IS flagged as a false correction",
      [r["flagged"] for r in flagged["self_corrections"]] == [True])
check("a self-correction never counts as one of the errors",
      all(r["deliberate"] != "self_correction" for r in flagged["errors"]))
check("nor as one of the correctly-read words",
      flagged["worst_correct"]["deliberate"] is None)
check("nor do the words flanking the insertion",
      all(r["index"] not in (20, 21) for r in flagged["errors"])
      and flagged["worst_correct"]["index"] not in (20, 21))

print("\na recording with no self-correction in it (--no-self-correction)")
absent = probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.88})), ratio=0.02,
    self_corrected=False)
check("word 35 stops being labelled a deliberate event", absent[35]["deliberate"] is None)
check("and is marked as planned but not read", absent[35]["planned_but_not_performed"] is True)
check("no other row is marked that way",
      [r["index"] for r in absent if r["planned_but_not_performed"]] == [35])
check("the default is still that it was performed",
      probe.score_rows(WORDS, spans_for(scores_where(0.9, {})), 0.02)[35]["deliberate"] == "self_correction")

absent_verdict = probe.build_verdict(absent)
check("nothing is reported as a self-correction", absent_verdict["self_corrections"] == [])
check("it now counts as one of the correctly-read words",
      any(r["index"] == 35 for r in absent_verdict["errors"]) is False
      and 35 in [r["index"] for r in absent if r["deliberate"] is None])

# The point of moving it: as an ordinary correct word it can now drag the threshold down, and
# must be able to. Held out of both pools it could never be caught doing so.
dragging = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.15})), ratio=0.02,
    self_corrected=False))
check("a low score on it can now produce NO GAP", dragging["clean_gap"] is False,
      f"gap {dragging['gap']}, worst correct '{dragging['worst_correct']['word']}'")
check("and it is named as the offending word", dragging["worst_correct"]["index"] == 35)
# Held out of both pools - the old behaviour - the same audio would have claimed a clean gap.
held_out = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.15})), ratio=0.02,
    self_corrected=True))
check("which labelling it as a self-correction would have hidden", held_out["clean_gap"] is True)

buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    probe.print_report(absent, absent_verdict)
text = buffer.getvalue()
check("the table marks the word that was planned and not read",
      "self-correction was planned here and not read" in text)
check("section 2 says it was not read rather than passing it", "Not read." in text)
check("and says the question is still open", "still open" in text)

print("\nbuild_verdict - the insertion")
# "tall" ends at frame 126 -> 2.52s; give "gate" a 0.4s gap before it starts.
spans = spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.88}))
for span in spans[21]:
    span.start += 20
    span.end += 20
gapped = probe.build_verdict(probe.score_rows(WORDS, spans, ratio=0.02))
check("uncovered audio between the flanking words is measured",
      abs(gapped["insertion"]["uncovered_seconds"] - 0.40) < 1e-6,
      f"got {gapped['insertion']['uncovered_seconds']}s")
absorbed = probe.build_verdict(probe.score_rows(
    WORDS, spans_for(scores_where(0.90, {13: 0.10, 25: 0.20, 35: 0.88})), ratio=0.02))
check("an absorbed insertion leaves no gap to see",
      absorbed["insertion"]["uncovered_seconds"] == 0.0)

print("\nprint_report")
try:
    for name, v in (("clean", clean), ("no gap", overlap), ("forced omission", forced)):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            probe.print_report(probe.score_rows(WORDS, spans_for(scores_where(0.9, {})), 0.02), v)
        text = buffer.getvalue()
        wanted = "CLEAN GAP" if v["clean_gap"] else "NO GAP"
        check(f"{name} prints {wanted}", wanted in text
              and ("NO GAP" in text) != v["clean_gap"])
except Exception as error:
    check("print_report runs", False, f"{type(error).__name__}: {error}")

print()
if failures:
    print(f"{len(failures)} FAILED: {', '.join(failures)}")
    sys.exit(1)
print("all checks passed")
