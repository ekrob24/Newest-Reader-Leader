# Exact Stage 4 Intervention State Machine

Use this state machine for the first Reader-Leader prototype. It is deliberately deterministic and conservative. **No LLM decides whether a child is correct.**

## 1. States

| State | Meaning | Child-facing output |
|---|---|---|
| `LISTENING` | Capture audio and collect ASR partial/final evidence for the active reference token/window. | None |
| `CANDIDATE` | A possible mismatch, stall, or pronunciation variation is being evaluated. | None |
| `SELF_CORRECTION_HOLD` | A possible error may be corrected by the child; the system waits. | None |
| `PROMPTED` | One light cue has been issued; wait for a retry. | Prompt only once |
| `MODELLING` | The retry failed after PROMPT and the target word is stable enough to model. | Model word once |
| `STAY_SILENT` | The token is correct, an approved accent variant, self-corrected, or uncertain. | Silence |
| `REVIEW_FLAGGED` | An event is logged for adult review because evidence is uncertain, noisy, or policy-sensitive. | Silence |
| `ADVANCE` | Finalize the event and move to the next reference token/window. | None |

## 2. Required evidence fields

For each active token/window, compute or preserve:

```text
expected_token
asr_hypotheses[]
word_timings
asr_confidence
partial_or_final
stable_result
audio_quality_ok
voice_activity
alignment_event
accent_variant_status
self_correction_window_open
stall_elapsed_ms
prompt_issued
retry_elapsed_ms
```

Use configuration values selected on the development set and frozen before holdout evaluation. Safe starting defaults are: partial stability over two consecutive updates spanning at least 400 ms; self-correction hold of about 2 seconds or two following tokens; stall prompt after about 3 seconds with no progress; and model after about 3 seconds following a prompt without a successful retry. These are engineering defaults, not universal pedagogical constants.

## 3. Exact transition logic

Evaluate rules in this order for every new event. The order is part of the policy.

```text
ON_SESSION_START:
    state = LISTENING
    prompt_issued = false
    open_audio_and_reference_window()

ON_ASR_UPDATE(update):
    preserve_raw_update(update)

    IF audio_quality_ok == false OR overlapping_speech OR clipping:
        state = REVIEW_FLAGGED
        decision = STAY_SILENT
        reason = AUDIO_UNCERTAIN
        finalize_or_recover_after_recording_retry()

    ELSE IF partial_or_final == partial AND stable_result == false:
        state = LISTENING
        decision = STAY_SILENT
        reason = UNSTABLE_PARTIAL
        # Highlighting is allowed; no prompt or model is allowed.

    ELSE:
        candidate = align_after_recognition(update, expected_reference_window)

        IF candidate == exact_match AND confidence_is_high:
            state = STAY_SILENT
            decision = STAY_SILENT
            reason = MATCH
            finalize_event()

        ELSE IF accent_variant_status == APPROVED:
            state = STAY_SILENT
            decision = STAY_SILENT
            reason = APPROVED_ACCENT_VARIANT
            finalize_event()

        ELSE IF confidence_is_low OR alternatives_conflict OR timings_unreliable:
            state = REVIEW_FLAGGED
            decision = STAY_SILENT
            reason = LOW_CONFIDENCE_ABSTAIN
            finalize_event_with_review_flag()

        ELSE IF possible_substitution AND self_correction_window_open:
            state = SELF_CORRECTION_HOLD
            decision = STAY_SILENT
            reason = SELF_CORRECTION_IN_PROGRESS
            wait_for_next_update_or_hold_expiry()

        ELSE IF completed_self_correction:
            state = STAY_SILENT
            decision = STAY_SILENT
            reason = SELF_CORRECTION_COMPLETED
            finalize_event()

        ELSE IF confirmed_stall AND stall_elapsed_ms >= STALL_PROMPT_MS:
            state = PROMPTED
            prompt_issued = true
            decision = PROMPT
            reason = CONFIRMED_STALL
            emit_one_light_prompt()
            start_retry_timer()

        ELSE IF high_confidence_non_variant_mismatch AND stable_result:
            state = PROMPTED
            prompt_issued = true
            decision = PROMPT
            reason = CONFIRMED_NON_VARIANT_MISMATCH
            emit_one_light_prompt()
            start_retry_timer()

        ELSE:
            state = STAY_SILENT
            decision = STAY_SILENT
            reason = INSUFFICIENT_EVIDENCE
            finalize_event_with_review_flag()

ON_PROMPTED_UPDATE(update):
    preserve_raw_update(update)

    IF approved_variant OR exact_target_match OR confidence_is_low OR self_correction_detected:
        state = STAY_SILENT
        decision = STAY_SILENT
        reason = RETRY_SUCCESS_OR_ABSTAIN
        finalize_event()

    ELSE IF retry_elapsed_ms < RETRY_MODEL_MS:
        state = PROMPTED
        decision = STAY_SILENT
        reason = WAITING_FOR_RETRY
        # Do not issue a second prompt.

    ELSE IF stable_high_confidence_non_variant_mismatch OR confirmed_stall:
        state = MODELLING
        decision = MODEL
        reason = RETRY_FAILED_MODEL_WORD
        play_pre_recorded_local_variety_word()
        finalize_event()

    ELSE:
        state = REVIEW_FLAGGED
        decision = STAY_SILENT
        reason = POST_PROMPT_UNCERTAIN
        finalize_event_with_review_flag()

ON_HOLD_EXPIRY:
    IF completed_self_correction:
        state = STAY_SILENT
        decision = STAY_SILENT
        reason = SELF_CORRECTION_COMPLETED
    ELSE IF approved_variant:
        state = STAY_SILENT
        decision = STAY_SILENT
        reason = APPROVED_ACCENT_VARIANT
    ELSE IF stable_high_confidence_non_variant_mismatch:
        state = PROMPTED
        prompt_issued = true
        decision = PROMPT
        reason = HOLD_EXPIRED_CONFIRMED_MISMATCH
        emit_one_light_prompt()
        start_retry_timer()
    ELSE:
        state = REVIEW_FLAGGED
        decision = STAY_SILENT
        reason = HOLD_EXPIRED_UNCERTAIN
    finalize_event_or_continue_listening()

ON_EVENT_FINALIZED:
    write_audit_record(
        expected_token, raw_hypotheses, timings, confidence,
        accent_variant_status, reading_event, decision,
        reason, audio_slice, thresholds, reviewer_override
    )
    state = ADVANCE
    move_to_next_reference_window()
    state = LISTENING
```

## 4. Hard safety invariants

1. **Only PROMPTED or MODELLING may emit child-facing corrective audio.**
2. **Unstable partial results may never trigger PROMPT or MODEL.**
3. **Low confidence, conflicting alternatives, unreliable timing, noise, and overlapping speech always abstain.**
4. **Approved regional variants always resolve to STAY SILENT.**
5. **A possible self-correction always receives the hold window before a prompt.**
6. **MODEL requires a prior PROMPT and an expired retry interval; it cannot occur directly from LISTENING.**
7. **At most one PROMPT and one MODEL are issued for a token/window.**
8. **Every PROMPT/MODEL action has a reason code, confidence, reference token, timestamps, and reviewable audio.**
9. **When rules conflict, choose STAY SILENT and log the conflict.**
10. **Changing thresholds, accent variants, or alignment rules after holdout inspection invalidates the holdout result and requires a new frozen evaluation.**

## 5. Minimum replay tests

Replay deterministic event streams for: exact match; approved accent variant mis-transcribed by ASR; low-confidence alternatives; substitution; omission; insertion; repetition; hesitation; wrong-then-right self-correction; confirmed stall; prompt followed by correct retry; prompt followed by failed retry; noisy audio; clipping; overlapping speech; and a partial result that changes from wrong to right. Assert the exact decision and reason code for every fixture.
