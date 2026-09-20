#!/usr/bin/env python3
"""Tag an expected word by its shape, so score can be checked against the word and not only
against whether it was read correctly.

The reason this exists: on the first reading the two lowest-scoring correctly-read words were
`gate` (short, stop-final, immediately before a comma) and `hedge` (short, affricate-final,
sentence-final). That is two words, which is nothing, but it is the shape of a systematic
weakness rather than a random one - and a systematic underscore is much worse for us, because
it false-flags the same words for every child every time. This tagger makes that checkable
across readers instead of arguable.

What it is honest about: syllable count and coda type are derived from spelling, not from a
pronunciation dictionary. English spelling is a poor guide to both, so these are approximate
by construction. wordshape-selftest.py holds a hand-labelled list of every word in the probe
passage and prints the disagreements rather than hiding them, so the size of the approximation
is visible. Do not use these tags for anything a child sees.
"""
import re

VOWELS = "aeiouy"

STOPS = ("p", "t", "k", "b", "d", "g")
FRICATIVES = ("f", "v", "s", "z", "th", "sh", "gh", "ph")
AFFRICATES = ("ch", "dge", "tch", "ge", "j")
NASALS = ("m", "n", "ng")
LIQUIDS = ("l", "r", "le", "re")

CODA_KINDS = ("none", "stop", "fricative", "affricate", "nasal", "liquid")


def letters(word):
    return re.sub(r"[^a-z']", "", word.lower())


def syllables(word):
    """Vowel groups, after removing the `e`s English writes but does not say. Approximate.

    The corrections, each of which the hand-labelled list caught the absence of:
      -ed after a consonant other than t or d is one sound, not a syllable: watched, washed.
      a silent e survives a consonant-initial suffix: safely is two, not three.
      a silent e survives a plural s: kite's is one, not two.
      the e inside dge before a consonant is silent: hedgehog is two, not three.
      but a consonant plus le is a syllable of its own: little, circles.
      and a final e that is the only vowel is not silent at all: she, the.
    """
    stem = letters(word).replace("'", "")
    if not stem:
        return 0
    stem = re.sub(f"dge(?=[^{VOWELS}])", "dg", stem)
    if re.search(f"[^{VOWELS}td]ed$", stem):
        stem = stem[:-2] + stem[-1]
    if re.search(f"[^{VOWELS}]e(ly|ness|ment|ful|less)$", stem):
        stem = re.sub(f"e(?=(ly|ness|ment|ful|less)$)", "", stem)
    if re.search(f"[^{VOWELS}]es$", stem) and not re.search(f"[^{VOWELS}]les$", stem):
        stem = stem[:-2] + "s"
    groups = len(re.findall(f"[{VOWELS}]+", stem))
    if stem.endswith("e") and not stem.endswith(("le", "ee", "ye", "oe")) and groups > 1:
        groups -= 1
    return max(1, groups)


def coda(word):
    """How the word ends, as the sound a reader actually has to release.

    A final consonant at a phrase boundary is where readers unrelease or glottalise, so this is
    the feature the `gate` and `hedge` hypothesis is about.
    """
    stem = letters(word).replace("'", "")
    if not stem:
        return "none"
    # A silent final `e` is not the coda: the consonant before it is. But an `e` that is the
    # only vowel in the word is the vowel, not a silent letter - `she` and `the` end in a vowel
    # sound, and stripping the e would leave them ending in `sh` and `th`.
    if (stem.endswith("e")
            and not stem.endswith(("le", "ee", "ye", "oe", "dge", "ge", "ce", "se"))
            and re.search(f"[{VOWELS}]", stem[:-1])):
        stem = stem[:-1]
    # A plural or third-person `s` is a real fricative coda, so it stays.
    for ending, kind in (
        ("dge", "affricate"), ("tch", "affricate"), ("ch", "affricate"), ("ge", "affricate"),
        ("ng", "nasal"), ("th", "fricative"), ("sh", "fricative"),
        ("gh", "fricative"), ("ph", "fricative"),
        ("le", "liquid"), ("re", "liquid"),
    ):
        if stem.endswith(ending):
            return kind
    last = stem[-1]
    if last in VOWELS and last != "y":
        return "none"
    if last == "y":
        return "none"
    if last in NASALS:
        return "nasal"
    if last in LIQUIDS:
        return "liquid"
    if last in STOPS:
        return "stop"
    if last in FRICATIVES:
        return "fricative"
    return "none"


def positions(text):
    """For each word of `text` in order, where it sits relative to punctuation.

    Takes the passage rather than a word, because this feature is about the sentence and cannot
    be recovered from the word alone. Returns one dict per word, aligned with the word list the
    probes use.
    """
    tokens = re.findall(r"[A-Za-z']+|[^\sA-Za-z']", text)
    words, out, sentence_start = [], [], True
    for index, token in enumerate(tokens):
        if not re.match(r"[A-Za-z']", token):
            continue
        following = ""
        for later in tokens[index + 1:]:
            if re.match(r"[A-Za-z']", later):
                break
            following += later
        words.append(token)
        out.append({
            "before_comma": "," in following,
            "before_full_stop": any(mark in following for mark in ".!?"),
            "sentence_final": any(mark in following for mark in ".!?"),
            "sentence_initial": sentence_start,
            "at_boundary": bool(following.strip()),
        })
        sentence_start = any(mark in following for mark in ".!?")
    return words, out


def shapes(text):
    """One shape record per word of `text`, in order."""
    words, where = positions(text)
    return [{
        "word": word,
        "letters": len(letters(word)),
        "syllables": syllables(word),
        "coda": coda(word),
        **place,
    } for word, place in zip(words, where)]
