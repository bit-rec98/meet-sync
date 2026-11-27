import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { usePageTitle } from '../components/usePageTitle';
import { MeetingForm } from '../meetings/MeetingForm';
import type { MeetingFormValues } from '../meetings/meetingValidation';
import { nextFullHour, toLocalInputValue } from '../meetings/time';
import { withNotice } from '../meetings/useFlashNotice';
import { useMeetingsApi } from '../meetings/useMeetingsApi';

/** A sensible starting point: a one-hour video call at the next whole hour. */
function emptyMeeting(): MeetingFormValues {
  return {
    title: '',
    description: '',
    startsAt: toLocalInputValue(nextFullHour(new Date()).toISOString()),
    durationMinutes: '60',
    callType: 'video',
  };
}

export function NewMeetingPage() {
  const { t } = useTranslation();
  const api = useMeetingsApi();
  const navigate = useNavigate();
  usePageTitle(t('meetingForm.newTitle'));
  const [initial] = useState(emptyMeeting); // computed once, so typing never resets the defaults

  return (
    <MeetingForm
      title={t('meetingForm.newTitle')}
      initial={initial}
      submitLabel={t('meetingForm.create')}
      submittingLabel={t('meetingForm.creating')}
      cancelTo="/"
      onSubmit={async (input) => {
        const created = await api.create(input);
        navigate(`/meetings/${encodeURIComponent(created.id)}`, { state: withNotice('created') });
      }}
    />
  );
}
