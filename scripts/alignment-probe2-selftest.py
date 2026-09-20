#!/usr/bin/env python3
"""No model, no audio: does probe2 classify, rank and count the right things?

The two judgements this run exists to make are both easy to get silently wrong. A
self-correction is a word the child READ, so it must sit with the correctly-read words and be
able to drag anything it would drag; and recall@k is a rank comparison, which an off-by-one
turns into a confident wrong answer.

    python alignment-probe2-selftest.py
"""
import contextlib
import importlib.util
import io
import pathlib
import sys

spec = importlib.util.spec_from_file_location(
    "probe2", pathlib.Path(__file__).with_name("alignment-probe2.py"))
p2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p2)

WORDS = p2.probe.normalised_words(p2.PASSAGE)
failures = []


def check(name, condition, detail=""):
    print(f"  {'ok  ' if condition else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not condition:
        failures.append(name)


def captured(fn, *args):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        fn(*args)
    return buffer.getvalue()


class Span:
    def __init__(self, score, start, end):
        self.score, self.start, self.end = score, start, end


def rows_at(overrides, default=0.90):
    spans, frame = [], 0
    for index in range(len(WORDS)):
        score = overrides.get(index, default)
        spans.append([Span(score, frame, frame + 2), Span(score, frame + 2, frame + 4)])
        frame += 4
    return p2.build_rows(WORDS, spans, 0.02)


print(f"{len(WORDS)} words\n")

print("the five deliberate moments are on the words the instructions name")
for index, word in ((4, "lantern"), (13, "golden"), (20, "tall"), (21, "gate"),
                    (25, "hedgehog"), (35, "watched")):
    check(f"{index} is '{word}'", WORDS[index] == word)

rows = rows_at({})
print("\nwhat counts as read, and what does not")
check("the omission is a true error", rows[13]["event"] == "omission" and rows[13]["read_correctly"] is False)
check("the substitution is a true error", rows[25]["event"] == "substitution" and rows[25]["read_correctly"] is False)
check("the part-word restart was READ",
      rows[4]["event"] == "self_correction_part" and rows[4]["read_correctly"] is True)
check("the whole-word restart was READ",
      rows[35]["event"] == "self_correction_whole" and rows[35]["read_correctly"] is True)
check("both words beside the insertion were READ",
      all(rows[i]["event"] == "insertion_site" and rows[i]["read_correctly"] for i in (20, 21)))
check("exactly two words were not read",
      [r["index"] for r in rows if not r["read_correctly"]] == [13, 25])
check("nothing else is marked with an event",
      sorted(r["index"] for r in rows if r["event"]) == [4, 13, 20, 21, 25, 35])

print("\nevery row carries its shape")
check("'gate' is one syllable, stop-final, before a comma",
      rows[21]["syllables"] == 1 and rows[21]["coda"] == "stop" and rows[21]["before_comma"])
check("'hedge' is one syllable, affricate-final, before a full stop",
      rows[41]["syllables"] == 1 and rows[41]["coda"] == "affricate" and rows[41]["before_full_stop"])
check("'Amina' is three syllables and vowel-final",
      rows[0]["syllables"] == 3 and rows[0]["coda"] == "none")
check("the shape tags line up with the words, not with the row numbers",
      all(r["word"] == WORDS[r["index"]] for r in rows))

print("\nranking - worst-scoring word is rank 1")
ranked = rows_at({13: 0.10, 25: 0.20, 4: 0.95, 35: 0.95})
places = p2.ranking(ranked)
check("the lowest score is rank 1", places[13] == 1, f"got {places[13]}")
check("the next lowest is rank 2", places[25] == 2, f"got {places[25]}")
check("a high scorer is far down", places[4] > 2)
check("every word gets exactly one place",
      sorted(places.values()) == list(range(1, len(WORDS) + 1)))

print("\nrecall@k")
check("k=2 catches both errors when they are the two worst",
      p2.recall_at_k(ranked, 2) == (1.0, 2, 2), str(p2.recall_at_k(ranked, 2)))
check("k=1 catches only one of them",
      p2.recall_at_k(ranked, 1) == (0.5, 1, 2), str(p2.recall_at_k(ranked, 1)))
buried = rows_at({13: 0.95, 25: 0.96, 0: 0.10, 1: 0.11, 2: 0.12})
check("errors that are not the worst words are not counted at a small k",
      p2.recall_at_k(buried, 2) == (0.0, 0, 2), str(p2.recall_at_k(buried, 2)))
check("and are counted once k reaches them",
      p2.recall_at_k(buried, len(WORDS))[0] == 1.0)
check("k is a rank cut-off, not a score cut-off",
      p2.recall_at_k(ranked, 2)[1] == 2 and p2.recall_at_k(ranked, 1)[1] == 1)

print("\na self-correction that scores badly is the failure this run is looking for")
punished = rows_at({13: 0.30, 25: 0.32, 4: 0.12, 35: 0.15})
punished_places = p2.ranking(punished)
check("it can rank above a real error", punished_places[4] < punished_places[13],
      f"restart at rank {punished_places[4]}, omission at {punished_places[13]}")
punished_text = captured(p2.report, punished)
check("and the report names it as flagged before real errors",
      "would be flagged before some real errors" in punished_text)
check("it is described as read, not as an error",
      "must not be flagged" in punished_text)

safe = rows_at({13: 0.10, 25: 0.20, 4: 0.95, 35: 0.95})
safe_text = captured(p2.report, safe)
check("a self-correction that scores well is reported as below every real error",
      "below every real error in the queue" in safe_text
      and "would be flagged before some real errors" not in safe_text)
check("both restarts are reported, not just one",
      safe_text.count("part-word restart") == 1 and safe_text.count("whole-word restart") == 1)

print("\nthe report says what it is and is not")
check("it reports recall at several cut-offs", "recall@2" in safe_text and "recall@8" in safe_text)
check("it says two errors is not a rate", "anecdote, not a rate" in safe_text)
check("it says one reader does not settle the shape question", "One reader" in safe_text)
check("it prints no threshold verdict",
      "CLEAN GAP" not in safe_text and "NO GAP" not in safe_text)

print("\nthe corpus line is what the multi-reader run will group by")
import json as _json
import tempfile
with tempfile.TemporaryDirectory() as folder:
    path = pathlib.Path(folder) / "corpus.jsonl"
    p2.append_to_corpus(safe, "adult-1", "/tmp/a.wav", str(path))
    p2.append_to_corpus(safe, "child-1", "/tmp/b.wav", str(path))
    lines = [_json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
check("one line per word per reader", len(lines) == 2 * len(WORDS), f"{len(lines)}")
check("each line names its reader",
      sorted({line["reader"] for line in lines}) == ["adult-1", "child-1"])
check("each line carries the word, the score and the shape",
      all({"word", "score", "syllables", "coda", "read_correctly"} <= set(line) for line in lines))
check("appending a second reader does not overwrite the first",
      sum(1 for line in lines if line["reader"] == "adult-1") == len(WORDS))
check("a word can be grouped across readers",
      len([line for line in lines if line["word"] == "gate"]) == 2)

print()
if failures:
    print(f"{len(failures)} FAILED: {', '.join(failures)}")
    sys.exit(1)
print("all checks passed")
