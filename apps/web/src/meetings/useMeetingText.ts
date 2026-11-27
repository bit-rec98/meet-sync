import { useTranslation } from 'react-i18next';
import { durationParts, formatDateTime, userTimeZone, type DateTimeStyle } from './time';

/** Dates and durations as text in the current language and the user's time zone. */
export function useMeetingText() {
  const { t, i18n } = useTranslation();

  return {
    dateTime: (iso: string, style: DateTimeStyle): string =>
      formatDateTime(iso, i18n.language, style),

    duration: (totalMinutes: number): string => {
      const { hours, minutes } = durationParts(totalMinutes);
      if (hours === 0) return t('meetings.duration.minutes', { minutes });
      if (minutes === 0) return t('meetings.duration.hours', { hours });
      return t('meetings.duration.hoursMinutes', { hours, minutes });
    },

    timeZone: userTimeZone(),
  };
}
