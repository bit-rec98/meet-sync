/** English texts. This file defines the structure every other language must follow. */
export const en = {
  app: {
    name: 'MeetSync',
    tagline: 'Meet, talk, collaborate.',
    description: 'Meetings for work teams, with audio and video calls.',
  },
  common: {
    loading: 'Loading…',
    skipToContent: 'Skip to main content',
    language: 'Language',
  },
  nav: {
    logout: 'Log out',
    signedInAs: 'Signed in as {{name}}',
  },
  fields: {
    email: 'Email',
    password: 'Password',
    displayName: 'Display name',
    passwordHint: 'At least {{min}} characters.',
  },
  validation: {
    emailRequired: 'Enter your email address.',
    emailInvalid: 'Enter a valid email address.',
    emailTaken: 'An account with this email already exists.',
    passwordRequired: 'Enter your password.',
    passwordTooShort: 'Use at least {{min}} characters.',
    passwordTooLong: 'Use at most {{max}} characters.',
    displayNameRequired: 'Enter a display name.',
    displayNameTooLong: 'Use at most {{max}} characters.',
    displayNameInvalid: 'The name contains characters that are not allowed.',
  },
  login: {
    title: 'Log in',
    submit: 'Log in',
    submitting: 'Logging in…',
    switchPrompt: 'New to MeetSync?',
    switchLink: 'Create an account',
  },
  register: {
    title: 'Create your account',
    submit: 'Create account',
    submitting: 'Creating account…',
    switchPrompt: 'Already have an account?',
    switchLink: 'Log in',
  },
  errors: {
    invalidCredentials: 'The email or password is not correct.',
    validation: 'Some of the information is not valid. Check the form and try again.',
    rateLimited: 'Too many attempts. Wait a few minutes and try again.',
    network: 'Could not reach the server. Check your connection and try again.',
    unexpected: 'Something went wrong. Try again.',
    sessionExpired: 'Your session expired. Log in again.',
  },
  home: {
    greeting: 'Welcome, {{name}}',
    placeholder: 'Your meetings will appear here soon.',
  },
  notFound: {
    title: 'Page not found',
    description: 'The page you are looking for does not exist.',
    backHome: 'Go to the start page',
  },
};

/** Same shape as the English texts, with every text replaced by a string. */
type WidenTexts<T> = T extends string ? string : { [Key in keyof T]: WidenTexts<T[Key]> };
export type Translations = WidenTexts<typeof en>;
