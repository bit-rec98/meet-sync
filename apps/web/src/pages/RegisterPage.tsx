import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { describeFailure } from '../auth/authErrors';
import { useAuth } from '../auth/useAuth';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { usePageTitle } from '../components/usePageTitle';
import { collectProblems, useFormSubmission } from '../forms/useFormSubmission';
import { useProblemText } from '../forms/useProblemText';
import {
  MIN_PASSWORD_LENGTH,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
} from '../forms/validation';
import { AuthCard } from './AuthCard';

export function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const problemText = useProblemText();
  const form = useFormSubmission(['displayName', 'email', 'password'], describeFailure);
  usePageTitle(t('register.title'));

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void form.submit(
      collectProblems({
        displayName: validateDisplayName(displayName),
        email: validateEmail(email),
        password: validateNewPassword(password),
      }),
      () => register({ displayName: displayName.trim(), email: email.trim(), password }),
    );
  }

  return (
    <AuthCard title={t('register.title')}>
      {form.formError ? <Alert variant="error">{t(`errors.${form.formError}`)}</Alert> : null}

      <form noValidate onSubmit={handleSubmit}>
        <TextField
          id="register-display-name"
          ref={form.inputRef('displayName')}
          label={t('fields.displayName')}
          type="text"
          autoComplete="name"
          required
          value={displayName}
          error={problemText(form.problems.displayName)}
          onChange={(event) => {
            setDisplayName(event.target.value);
            form.clearProblem('displayName');
          }}
        />
        <TextField
          id="register-email"
          ref={form.inputRef('email')}
          label={t('fields.email')}
          type="email"
          autoComplete="email"
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
        <TextField
          id="register-password"
          ref={form.inputRef('password')}
          label={t('fields.password')}
          type="password"
          autoComplete="new-password"
          required
          value={password}
          hint={t('fields.passwordHint', { min: MIN_PASSWORD_LENGTH })}
          error={problemText(form.problems.password)}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clearProblem('password');
          }}
        />
        <Button type="submit" pending={form.pending} className="mt-6 w-full">
          {form.pending ? t('register.submitting') : t('register.submit')}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        {t('register.switchPrompt')}{' '}
        <Link to="/login" className="font-medium text-link underline">
          {t('register.switchLink')}
        </Link>
      </p>
    </AuthCard>
  );
}
