import { FlaskConical } from "lucide-react";

/**
 * A viewer should be told this is not real without having to ask.
 *
 * Deliberately not dismissible and deliberately not behind a variable. Everything a visitor
 * sees here is synthetic — the voices are a 440Hz tone, the children are invented, the school
 * is invented — and a statement that can be closed, or that depends on a variable somebody
 * remembered to set, is a statement that will be missing from the one session that mattered.
 *
 * It sits in the document flow rather than floating over the page, so it can never sit on top
 * of a control a child is trying to press.
 */
export function SyntheticDataNotice() {
  return (
    <div className="synthetic-data-notice" role="note" data-testid="synthetic-data-notice">
      <FlaskConical size={14} aria-hidden="true" />
      <p>
        <strong>Demonstration build — everything here is synthetic.</strong> No real child, recording or school
        appears anywhere in it. The pupils are invented, the reading records are generated, and the only audio
        the demo can capture is a test tone, never a person's voice.
      </p>
    </div>
  );
}
