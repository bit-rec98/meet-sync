import type { ComponentProps } from 'react';
import { Link } from 'react-router';
import { buttonClassName, type ButtonVariant } from './buttonStyles';

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

/** A link that looks like a button: it navigates, so it must be a link for assistive technology. */
export function ButtonLink({ variant = 'primary', className = '', ...props }: ButtonLinkProps) {
  return <Link className={buttonClassName(variant, className)} {...props} />;
}
