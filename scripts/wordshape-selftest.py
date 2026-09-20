#!/usr/bin/env python3
"""Hand-labelled check on the shape tagger.

Syllable count and coda type come from spelling, and English spelling is a poor guide to
either. The point of this file is not to pass: it is to make the size of the approximation
visible. Every word of the probe passage is labelled below by hand, and disagreements are
printed as disagreements. The test fails only if the tagger gets worse than the tolerance
recorded here, so a later change cannot quietly degrade it - and cannot quietly claim to be
exact either.

    python wordshape-selftest.py
"""
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location(
    "wordshape", pathlib.Path(__file__).with_name("wordshape.py"))
shape = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shape)

PASSAGE = (
    "Amina carried a little lantern into the garden at dusk. "
    "The light made golden circles on the path. "
    "Near the tall gate, she saw a hedgehog sniffing beside the flowers. "
    "Amina stood very still, then watched it hurry safely under the hedge."
)

# word: (syllables, coda). Labelled by ear, for a reader of British/Irish English.
#
# Two of these were wrong on the first pass and the tagger was right: `washed` ends in a /t/
# exactly as `watched` does, and `hedgerow` is HEDGE-row, two syllables. Worth knowing when
# reading the tolerance below - the hand labels are a check on the tagger, not a ground truth.
HAND = {
    "Amina": (3, "none"), "carried": (2, "stop"), "a": (1, "none"), "little": (2, "liquid"),
    "lantern": (2, "nasal"), "into": (2, "none"), "the": (1, "none"), "garden": (2, "nasal"),
    "at": (1, "stop"), "dusk": (1, "stop"), "light": (1, "stop"), "made": (1, "stop"),
    "golden": (2, "nasal"), "circles": (2, "fricative"), "on": (1, "nasal"),
    "path": (1, "fricative"), "Near": (1, "liquid"), "tall": (1, "liquid"), "gate": (1, "stop"),
    "she": (1, "none"), "saw": (1, "none"), "hedgehog": (2, "stop"), "sniffing": (2, "nasal"),
    "beside": (2, "stop"), "flowers": (2, "fricative"), "stood": (1, "stop"),
    "very": (2, "none"), "still": (1, "liquid"), "then": (1, "nasal"), "watched": (1, "stop"),
    "it": (1, "stop"), "hurry": (2, "none"), "safely": (2, "none"), "under": (2, "liquid"),
    "hedge": (1, "affricate"), "wooden": (2, "nasal"), "hedgerow": (2, "none"),
    "washed": (1, "stop"),
}

# The tagger is allowed to be wrong this often and no more. Raise these only with a reason.
MAX_SYLLABLE_ERRORS = 0
MAX_CODA_ERRORS = 0

failures = []


def check(name, condition, detail=""):
    print(f"  {'ok  ' if condition else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not condition:
        failures.append(name)


print("syllables and coda against the hand labels\n")
syllable_errors, coda_errors = [], []
for word, (want_syllables, want_coda) in sorted(HAND.items()):
    got_syllables, got_coda = shape.syllables(word), shape.coda(word)
    if got_syllables != want_syllables:
        syllable_errors.append(f"{word}: said {got_syllables}, is {want_syllables}")
    if got_coda != want_coda:
        coda_errors.append(f"{word}: said {got_coda}, is {want_coda}")

print(f"  {len(HAND)} words labelled by hand")
print(f"  syllable disagreements ({len(syllable_errors)}): {'; '.join(syllable_errors) or 'none'}")
print(f"  coda disagreements ({len(coda_errors)}): {'; '.join(coda_errors) or 'none'}")
check("syllable count is within the recorded tolerance",
      len(syllable_errors) <= MAX_SYLLABLE_ERRORS, f"{len(syllable_errors)} > {MAX_SYLLABLE_ERRORS}")
check("coda type is within the recorded tolerance",
      len(coda_errors) <= MAX_CODA_ERRORS, f"{len(coda_errors)} > {MAX_CODA_ERRORS}")

print("\nthe two words the hypothesis is about")
check("'gate' is one syllable and stop-final",
      shape.syllables("gate") == 1 and shape.coda("gate") == "stop")
check("'hedge' is one syllable and affricate-final",
      shape.syllables("hedge") == 1 and shape.coda("hedge") == "affricate")
check("and they are not the same coda, or the feature would say nothing",
      shape.coda("gate") != shape.coda("hedge"))

print("\nposition relative to punctuation")
records = shape.shapes(PASSAGE)
check("one record per word", len(records) == 42, f"{len(records)}")
by_word = {(r["word"], i): r for i, r in enumerate(records)}
gate = records[21]
check("'gate' is the word before the comma",
      gate["word"] == "gate" and gate["before_comma"] and not gate["before_full_stop"],
      f"{gate}")
hedge = records[41]
check("'hedge' is sentence-final",
      hedge["word"] == "hedge" and hedge["sentence_final"], f"{hedge}")
check("'dusk' ends the first sentence", records[9]["word"] == "dusk" and records[9]["sentence_final"])
# A comma and a full stop are different prosodic boundaries and the hypothesis is about which
# one a word sits at, so the two flags must not collapse into "followed by punctuation".
check("a word before a full stop is not reported as before a comma",
      records[9]["before_full_stop"] and not records[9]["before_comma"], str(records[9]))
check("the two flags pick out different words",
      [r["word"] for r in records if r["before_comma"]] == ["gate", "still"]
      and [r["word"] for r in records if r["before_full_stop"]] == ["dusk", "path", "flowers", "hedge"],
      str([r["word"] for r in records if r["before_comma"]]))
check("'The' after it starts a sentence", records[10]["word"] == "The" and records[10]["sentence_initial"])
check("'Amina' starts the passage", records[0]["sentence_initial"])
check("a word mid-phrase is at no boundary",
      records[1]["word"] == "carried" and not records[1]["at_boundary"]
      and not records[1]["sentence_final"] and not records[1]["sentence_initial"])
check("'still' is before the second comma",
      records[33]["word"] == "still" and records[33]["before_comma"])
boundary = [r["word"] for r in records if r["at_boundary"]]
check("only the words actually followed by punctuation are at a boundary",
      boundary == ["dusk", "path", "gate", "flowers", "still", "hedge"], str(boundary))
check("sentence_initial is not just 'first word of the passage'",
      sum(1 for r in records if r["sentence_initial"]) == 4,
      str([r["word"] for r in records if r["sentence_initial"]]))

print("\nthings that must not crash or lie")
check("an empty string has no syllables and no coda",
      shape.syllables("") == 0 and shape.coda("") == "none")
check("a word is never zero syllables", all(shape.syllables(w) >= 1 for w in HAND))
check("every coda is one of the declared kinds",
      all(shape.coda(w) in shape.CODA_KINDS for w in HAND))
check("an apostrophe is kept as part of the word", shape.letters("kite's") == "kite's")
check("but does not add a syllable", shape.syllables("kite's") == 1,
      "got %d" % shape.syllables("kite's"))

print()
if failures:
    print(f"{len(failures)} FAILED: {', '.join(failures)}")
    sys.exit(1)
print("all checks passed")
