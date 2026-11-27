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
import { validateEmail, validateExistingPassword } from '../forms/validation';
import { AuthCard } from './AuthCard';

export function LoginPage() {
  const { t } = useTranslation();
  const { login, sessionExpired } = useAuth();
  const problemText = useProblemText();
  const form = useFormSubmission(['email', 'password'], describeFailure);
  usePageTitle(t('login.title'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void form.submit(
      collectProblems({
        email: validateEmail(email),
        password: validateExistingPassword(password),
      }),
      () => login({ email: email.trim(), password }),
    );
  }

  return (
    <AuthCard title={t('login.title')}>
      {sessionExpired ? <Alert variant="info">{t('errors.sessionExpired')}</Alert> : null}
      {form.formError ? <Alert variant="error">{t(`errors.${form.formError}`)}</Alert> : null}

      <form noValidate onSubmit={handleSubmit}>
        <TextField
          id="login-email"
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
          id="login-password"
          ref={form.inputRef('password')}
          label={t('fields.password')}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          error={problemText(form.problems.password)}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clearProblem('password');
          }}
        />
        <Button type="submit" pending={form.pending} className="mt-6 w-full">
          {form.pending ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        {t('login.switchPrompt')}{' '}
        <Link to="/register" className="font-medium text-link underline">
          {t('login.switchLink')}
        </Link>
      </p>
    </AuthCard>
  );
}
