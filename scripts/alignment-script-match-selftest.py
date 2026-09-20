#!/usr/bin/env python3
"""No model, no audio: is the script-match probe comparing the right words?

The whole test turns on lining up two word sequences of different lengths. Insert a word and
every index after it shifts; remove one and they shift back. A comparison that silently comes
out one position off would still print a confident before/after table, and the numbers in it
would be the wrong words' numbers - which is the same defect this project keeps finding.

    python alignment-script-match-selftest.py
"""
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location(
    "match", pathlib.Path(__file__).with_name("alignment-script-match.py"))
match = importlib.util.module_from_spec(spec)
spec.loader.exec_module(match)
probe = match.probe

BASE = probe.normalised_words(probe.PASSAGE)
failures = []


def check(name, condition, detail=""):
    print(f"  {'ok  ' if condition else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not condition:
        failures.append(name)


def rows_from(pairs, scores):
    """Stand-in alignment output: one row per word, at the score the case wants."""
    return [{"source_index": source_index, "word": text,
             "score": scores.get(source_index if source_index is not None else text, 0.90),
             "start": 0.0, "end": 0.1}
            for source_index, text in pairs]


print(f"{len(BASE)} words in the passage\n")

print("the indices the probe is about")
check("20 is 'tall'", BASE[match.TALL] == "tall")
check("21 is 'gate'", BASE[match.GATE] == "gate")
check("12 is 'made'", BASE[match.MADE] == "made")
check("13 is 'golden'", BASE[match.GOLDEN] == "golden")
check("14 is 'circles'", BASE[match.CIRCLES] == "circles")

print("\nwriting the insertion into the script")
inserted = match.variant_with_insertion(BASE, match.TALL, match.INSERTED)
check("the script is one word longer", len(inserted) == len(BASE) + 1, f"{len(inserted)}")
check("'wooden' sits between 'tall' and 'gate'",
      [text for _, text in inserted[20:23]] == ["tall", "wooden", "gate"],
      str([text for _, text in inserted[19:24]]))
check("only 'wooden' has no original index",
      [text for source_index, text in inserted if source_index is None] == ["wooden"])
check("every other word keeps its own original index",
      all(BASE[source_index] == text for source_index, text in inserted if source_index is not None))
check("and they stay in order",
      [i for i, _ in inserted if i is not None] == list(range(len(BASE))))

print("\nwriting the omission into the script")
removed = match.variant_without(BASE, match.GOLDEN)
check("the script is one word shorter", len(removed) == len(BASE) - 1, f"{len(removed)}")
check("'golden' is gone", "golden" not in [text for _, text in removed])
check("'made' is still followed by 'circles'",
      [text for _, text in removed[12:14]] == ["made", "circles"],
      str([text for _, text in removed[11:15]]))
check("no word claims index 13", 13 not in [i for i, _ in removed])
check("every remaining word keeps its own original index",
      all(BASE[source_index] == text for source_index, text in removed))

print("\ncomparing two scripts of different lengths")
baseline_rows = rows_from([(i, w) for i, w in enumerate(BASE)],
                          {match.GATE: 0.1864, match.MADE: 0.4990})
inserted_rows = rows_from(inserted, {match.GATE: 0.9100, "wooden": 0.7000})
shared = match.compare(baseline_rows, inserted_rows)
check("the inserted word is left out of the comparison", len(shared) == len(BASE),
      f"{len(shared)} rows")
gate = next((r for r in shared if r["index"] == match.GATE), None)
check("'gate' is compared against 'gate', not against its neighbour",
      gate is not None and gate["word"] == "gate"
      and gate["before"] == 0.1864 and gate["after"] == 0.9100, f"{gate}")
check("the change is after minus before",
      gate is not None and abs(gate["delta"] - 0.7236) < 1e-9,
      f"{gate['delta'] if gate else 'no row'}")
check("every compared row lines up with the same word",
      all(r["word"] == BASE[r["index"]] for r in shared))

removed_rows = rows_from(removed, {match.MADE: 0.9400})
shared_removed = match.compare(baseline_rows, removed_rows)
check("a word missing from one script is dropped from the comparison",
      len(shared_removed) == len(BASE) - 1 and match.GOLDEN not in [r["index"] for r in shared_removed])
made = next((r for r in shared_removed if r["index"] == match.MADE), None)
check("'made' is compared against 'made' after the shift",
      made is not None and made["word"] == "made"
      and made["before"] == 0.4990 and made["after"] == 0.9400, f"{made}")
check("and so is everything after the removed word",
      all(r["word"] == BASE[r["index"]] for r in shared_removed))

print("\nthe control - did the rest of the reading move too")
check("an unchanged reading has a zero median change",
      match.median_delta(shared, (match.TALL, match.GATE)) == 0.0)
lifted = match.compare(baseline_rows, rows_from(inserted, {match.GATE: 0.91, "wooden": 0.7,
                                                           **{i: 0.95 for i in range(len(BASE))}}))
check("a reading where every word rose does NOT report a zero control",
      match.median_delta(lifted, (match.TALL, match.GATE)) != 0.0,
      f"median {match.median_delta(lifted, (match.TALL, match.GATE))}")
# The watched words must not be in the control, or the control would partly measure the very
# thing it is meant to be a control for. A median over forty-two rows barely notices two
# outliers, so this is checked where it shows: four rows, two of them excluded.
tiny = [{"index": 1, "delta": 0.1}, {"index": 2, "delta": 0.2},
        {"index": match.TALL, "delta": 0.9}, {"index": match.GATE, "delta": 0.9}]
check("the watched words are kept out of their own control",
      match.median_delta(tiny, (match.TALL, match.GATE)) == 0.15,
      f"got {match.median_delta(tiny, (match.TALL, match.GATE))}, including them gives "
      f"{match.median_delta(tiny, ())}")
check("and including them would give a different answer",
      match.median_delta(tiny, ()) != match.median_delta(tiny, (match.TALL, match.GATE)))

print("\nthe printed table")
import contextlib
import io as _io
buffer = _io.StringIO()
with contextlib.redirect_stdout(buffer):
    match.print_variant("t", "d", shared, [match.TALL, match.GATE], (match.TALL, match.GATE))
text = buffer.getvalue()
check("it shows the words it says it shows", "tall" in text and "gate" in text)
check("it shows the before and the after", "0.1864" in text and "0.9100" in text)
check("it reports the control alongside", "control" in text and "median change" in text)
check("it draws no conclusion about a threshold",
      "threshold" not in text.lower() and "gap" not in text.lower())

print()
if failures:
    print(f"{len(failures)} FAILED: {', '.join(failures)}")
    sys.exit(1)
print("all checks passed")
