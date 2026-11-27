import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeetingInput } from '../api/meetingsApi';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { ButtonLink } from '../components/ButtonLink';
import { RadioGroupField } from '../components/RadioGroupField';
import { TextAreaField } from '../components/TextAreaField';
import { TextField } from '../components/TextField';
import { collectProblems, useFormSubmission } from '../forms/useFormSubmission';
import { useProblemText } from '../forms/useProblemText';
import { describeMeetingFailure } from './meetingErrors';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  toMeetingInput,
  validateDescription,
  validateDuration,
  validateStartsAt,
  validateTitle,
  type MeetingFormValues,
} from './meetingValidation';
import { useMeetingText } from './useMeetingText';

type MeetingFormProps = {
  /** The page heading. */
  title: string;
  initial: MeetingFormValues;
  submitLabel: string;
  submittingLabel: string;
  /** Called with validated values. A thrown error is shown on the form. */
  onSubmit: (input: MeetingInput) => Promise<void>;
  /** Where "Cancel" goes. */
  cancelTo: string;
};

/** The form for scheduling and for editing a meeting. */
export function MeetingForm({
  title,
  initial,
  submitLabel,
  submittingLabel,
  onSubmit,
  cancelTo,
}: MeetingFormProps) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const text = useMeetingText();
  const form = useFormSubmission(
    ['title', 'description', 'startsAt', 'durationMinutes', 'callType'],
    describeMeetingFailure,
  );
  const [values, setValues] = useState(initial);

  function change<K extends keyof MeetingFormValues>(field: K, value: MeetingFormValues[K]): void {
    setValues((current) => ({ ...current, [field]: value }));
    if (field !== 'callType') form.clearProblem(field);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void form.submit(
      collectProblems({
        title: validateTitle(values.title),
        description: validateDescription(values.description),
        startsAt: validateStartsAt(values.startsAt, new Date()),
        durationMinutes: validateDuration(values.durationMinutes),
      }),
      () => onSubmit(toMeetingInput(values)),
    );
  }

  return (
    <section aria-labelledby="meeting-form-title" className="mx-auto mt-6 w-full max-w-2xl">
      <div className="rounded-2xl border border-edge bg-surface/90 p-6 shadow-xl">
        <h1 id="meeting-form-title" className="text-xl font-semibold">
          {title}
        </h1>
        {form.formError ? <Alert variant="error">{t(`errors.${form.formError}`)}</Alert> : null}

        <form noValidate onSubmit={handleSubmit}>
          <TextField
            id="meeting-title"
            ref={form.inputRef('title')}
            label={t('meetingForm.title')}
            type="text"
            required
            value={values.title}
            error={problemText(form.problems.title)}
            onChange={(event) => change('title', event.target.value)}
          />
          <TextAreaField
            id="meeting-description"
            ref={form.inputRef('description')}
            label={t('meetingForm.description')}
            hint={t('meetingForm.descriptionHint', { max: MAX_DESCRIPTION_LENGTH })}
            value={values.description}
            error={problemText(form.problems.description)}
            onChange={(event) => change('description', event.target.value)}
          />
          <TextField
            id="meeting-starts-at"
            ref={form.inputRef('startsAt')}
            label={t('meetingForm.startsAt')}
            hint={t('meetingForm.startsAtHint', { zone: text.timeZone })}
            type="datetime-local"
            required
            value={values.startsAt}
            error={problemText(form.problems.startsAt)}
            onChange={(event) => change('startsAt', event.target.value)}
          />
          <TextField
            id="meeting-duration"
            ref={form.inputRef('durationMinutes')}
            label={t('meetingForm.duration')}
            hint={t('meetingForm.durationHint', {
              min: MIN_DURATION_MINUTES,
              max: MAX_DURATION_MINUTES,
            })}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            value={values.durationMinutes}
            error={problemText(form.problems.durationMinutes)}
            onChange={(event) => change('durationMinutes', event.target.value)}
          />
          <RadioGroupField
            name="meeting-call-type"
            legend={t('meetingForm.callType')}
            value={values.callType}
            onChange={(callType) => change('callType', callType)}
            options={[
              {
                value: 'video',
                label: t('meetingForm.video'),
                hint: t('meetingForm.videoHint'),
              },
              {
                value: 'audio',
                label: t('meetingForm.audio'),
                hint: t('meetingForm.audioHint'),
              },
            ]}
          />

          <div className="mt-6 flex flex-wrap gap-3">
            <Button type="submit" pending={form.pending}>
              {form.pending ? submittingLabel : submitLabel}
            </Button>
            <ButtonLink to={cancelTo} variant="secondary">
              {t('meetingForm.cancel')}
            </ButtonLink>
          </div>
        </form>
      </div>
    </section>
  );
}
