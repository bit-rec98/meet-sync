import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { usePageTitle } from '../components/usePageTitle';
import { describeLoadFailure } from '../meetings/meetingErrors';
import { MeetingForm } from '../meetings/MeetingForm';
import { changesBetween, valuesFromMeeting } from '../meetings/meetingValidation';
import { canEdit } from '../meetings/time';
import { withNotice } from '../meetings/useFlashNotice';
import { useMeetingsApi } from '../meetings/useMeetingsApi';
import { useResource } from '../meetings/useResource';

export function EditMeetingPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const api = useMeetingsApi();
  const navigate = useNavigate();
  usePageTitle(t('meetingForm.editTitle'));
  const { state, reload } = useResource(`meeting:${id}`, () => api.get(id));

  const detailPath = `/meetings/${encodeURIComponent(id)}`;

  if (state.status === 'loading') {
    return (
      <div role="status" className="mt-8 text-ink-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-6">
        <Alert variant="error">{t(`errors.${describeLoadFailure(state.error)}`)}</Alert>
        <Button variant="secondary" className="mt-3" onClick={reload}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const meeting = state.data;
  if (meeting.role !== 'host' || !canEdit(meeting, new Date())) {
    return (
      <section className="mt-6">
        <h1 className="text-xl font-semibold">{t('meetingForm.editTitle')}</h1>
        <Alert variant="info">{t('meeting.cannotEdit')}</Alert>
        <Link to={detailPath} className="mt-4 inline-block font-medium text-link underline">
          {t('meeting.back')}
        </Link>
      </section>
    );
  }

  return (
    <MeetingForm
      title={t('meetingForm.editTitle')}
      initial={valuesFromMeeting(meeting)}
      submitLabel={t('meetingForm.save')}
      submittingLabel={t('meetingForm.saving')}
      cancelTo={detailPath}
      onSubmit={async (input) => {
        const changes = changesBetween(meeting, input);
        // Nothing changed: no request, just go back.
        if (Object.keys(changes).length === 0) {
          navigate(detailPath);
          return;
        }
        await api.update(id, changes);
        navigate(detailPath, { state: withNotice('updated') });
      }}
    />
  );
}
