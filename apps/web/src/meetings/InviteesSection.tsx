import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Invitee, Meeting } from '../api/meetingsApi';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import type { ErrorTextKey } from '../forms/failure';
import { collectProblems, useFormSubmission } from '../forms/useFormSubmission';
import { useProblemText } from '../forms/useProblemText';
import { validateEmail } from '../forms/validation';
import { describeActionFailure, describeMeetingFailure } from './meetingErrors';
import { useMeetingsApi } from './useMeetingsApi';

type InviteesSectionProps = {
  meeting: Meeting;
  /** The host of a meeting that is still scheduled and not over. */
  canInvite: boolean;
  onInvited: (invitee: Invitee) => void;
  onRemoved: (invitee: Invitee) => void;
  onActionFailed: (message: ErrorTextKey) => void;
};

export function InviteesSection({
  meeting,
  canInvite,
  onInvited,
  onRemoved,
  onActionFailed,
}: InviteesSectionProps) {
  const { t } = useTranslation();
  const api = useMeetingsApi();
  const problemText = useProblemText();
  const form = useFormSubmission(['email'], describeMeetingFailure);
  const [email, setEmail] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isHost = meeting.role === 'host';

  function handleInvite(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void form.submit(collectProblems({ email: validateEmail(email) }), async () => {
      const invitee = await api.invite(meeting.id, email.trim());
      setEmail('');
      onInvited(invitee);
    });
  }

  async function remove(invitee: Invitee): Promise<void> {
    setRemovingId(invitee.id);
    try {
      await api.removeInvitee(meeting.id, invitee.id);
      onRemoved(invitee);
      headingRef.current?.focus(); // the button that had focus is gone
    } catch (error) {
      onActionFailed(describeActionFailure(error));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section aria-labelledby="invitees-title" className="mt-8">
      <h2 id="invitees-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        {t('invitees.title')}
      </h2>

      {meeting.invitees.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{t('invitees.none')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-surface/90">
          {meeting.invitees.map((invitee) => (
            <li key={invitee.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-medium">{invitee.displayName}</span>
                {invitee.email ? (
                  <span className="block text-sm text-ink-muted">{invitee.email}</span>
                ) : null}
              </span>
              {isHost ? (
                <Button
                  variant="secondary"
                  pending={removingId === invitee.id}
                  aria-label={t('invitees.removeLabel', { name: invitee.displayName })}
                  onClick={() => void remove(invitee)}
                >
                  {t('invitees.remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canInvite ? (
        <form noValidate onSubmit={handleInvite} className="mt-6" aria-labelledby="invite-title">
          <h3 id="invite-title" className="font-semibold">
            {t('invitees.inviteTitle')}
          </h3>
          {form.formError ? <Alert variant="error">{t(`errors.${form.formError}`)}</Alert> : null}
          <TextField
            id="invite-email"
            ref={form.inputRef('email')}
            label={t('invitees.emailLabel')}
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            error={problemText(form.problems.email)}
            onChange={(event) => {
              setEmail(event.target.value);
              form.clearProblem('email');
            }}
          />
          <Button type="submit" pending={form.pending} className="mt-4">
            {form.pending ? t('invitees.submitting') : t('invitees.submit')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
