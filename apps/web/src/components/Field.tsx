import { useId, type InputHTMLAttributes, type Ref } from 'react';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  description?: string;
  error?: string;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled text input with optional help text and an inline error tied to it. */
export function Field({ label, description, error, className, ref, id: givenId, ...input }: FieldProps) {
  const generated = useId();
  const id = givenId ?? generated;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={['field', error ? 'field--invalid' : '', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {description ? (
        <p className="field__description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <input
        {...input}
        ref={ref}
        id={id}
        className="field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
