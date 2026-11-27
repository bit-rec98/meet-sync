import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';

type CallControlsProps = {
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  /** Audio calls have no camera to switch. */
  hasCamera: boolean;
  onToggleMicrophone(): void;
  onToggleCamera(): void;
  onLeave(): void;
};

/** Microphone, camera and leave. Each toggle's label says what pressing it will do. */
export function CallControls({
  microphoneEnabled,
  cameraEnabled,
  hasCamera,
  onToggleMicrophone,
  onToggleCamera,
  onLeave,
}: CallControlsProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('call.controls.label')}
      className="mt-6 flex flex-wrap items-center justify-center gap-3"
    >
      <Button variant="secondary" onClick={onToggleMicrophone}>
        {microphoneEnabled
          ? t('call.controls.muteMicrophone')
          : t('call.controls.unmuteMicrophone')}
      </Button>
      {hasCamera ? (
        <Button variant="secondary" onClick={onToggleCamera}>
          {cameraEnabled ? t('call.controls.turnCameraOff') : t('call.controls.turnCameraOn')}
        </Button>
      ) : null}
      <Button variant="primary" onClick={onLeave}>
        {t('call.controls.leave')}
      </Button>
    </div>
  );
}
