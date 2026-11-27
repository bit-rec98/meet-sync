import type { Translations } from './en';

/** Spanish texts. The type makes the build fail if a key is missing or extra. */
export const es: Translations = {
  app: {
    name: 'MeetSync',
    tagline: 'Reúnete, habla, colabora.',
    description: 'Reuniones para equipos de trabajo, con llamadas de audio y video.',
  },
  common: {
    loading: 'Cargando…',
    skipToContent: 'Saltar al contenido principal',
    language: 'Idioma',
  },
  nav: {
    logout: 'Cerrar sesión',
    signedInAs: 'Sesión iniciada como {{name}}',
  },
  fields: {
    email: 'Correo electrónico',
    password: 'Contraseña',
    displayName: 'Nombre para mostrar',
    passwordHint: 'Al menos {{min}} caracteres.',
  },
  validation: {
    emailRequired: 'Ingresa tu correo electrónico.',
    emailInvalid: 'Ingresa un correo electrónico válido.',
    emailTaken: 'Ya existe una cuenta con este correo electrónico.',
    passwordRequired: 'Ingresa tu contraseña.',
    passwordTooShort: 'Usa al menos {{min}} caracteres.',
    passwordTooLong: 'Usa como máximo {{max}} caracteres.',
    displayNameRequired: 'Ingresa un nombre para mostrar.',
    displayNameTooLong: 'Usa como máximo {{max}} caracteres.',
    displayNameInvalid: 'El nombre contiene caracteres que no están permitidos.',
  },
  login: {
    title: 'Iniciar sesión',
    submit: 'Iniciar sesión',
    submitting: 'Iniciando sesión…',
    switchPrompt: '¿Eres nuevo en MeetSync?',
    switchLink: 'Crear una cuenta',
  },
  register: {
    title: 'Crea tu cuenta',
    submit: 'Crear cuenta',
    submitting: 'Creando cuenta…',
    switchPrompt: '¿Ya tienes una cuenta?',
    switchLink: 'Iniciar sesión',
  },
  errors: {
    invalidCredentials: 'El correo o la contraseña no son correctos.',
    validation: 'Algunos datos no son válidos. Revisa el formulario e inténtalo de nuevo.',
    rateLimited: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    network: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    unexpected: 'Algo salió mal. Inténtalo de nuevo.',
    sessionExpired: 'Tu sesión expiró. Inicia sesión de nuevo.',
  },
  home: {
    greeting: 'Te damos la bienvenida, {{name}}',
    placeholder: 'Tus reuniones aparecerán aquí pronto.',
  },
  notFound: {
    title: 'Página no encontrada',
    description: 'La página que buscas no existe.',
    backHome: 'Ir a la página de inicio',
  },
};
