import { useId, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

function describedBy(...ids: Array<string | undefined>) {
  return ids.filter(Boolean).join(' ') || undefined;
}

interface Common {
  label: string;
  description?: string;
  error?: string;
}

export function TextAreaField({ label, description, error, className, ref, id: givenId, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const generated = useId();
  const id = givenId ?? generated;
  const d = description ? `${id}-d` : undefined;
  const e = error ? `${id}-e` : undefined;
  return (
    <div className={['field', error ? 'field--invalid' : '', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>{label}</label>
      {description ? <p className="field__description" id={d}>{description}</p> : null}
      <textarea {...rest} ref={ref} id={id} className="field__input field__input--area" aria-invalid={error ? true : undefined} aria-describedby={describedBy(d, e)} />
      {error ? <p className="field__error" id={e}>{error}</p> : null}
    </div>
  );
}

export function SelectField({ label, description, error, className, children, id: givenId, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const generated = useId();
  const id = givenId ?? generated;
  const d = description ? `${id}-d` : undefined;
  const e = error ? `${id}-e` : undefined;
  return (
    <div className={['field', error ? 'field--invalid' : '', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>{label}</label>
      {description ? <p className="field__description" id={d}>{description}</p> : null}
      <select {...rest} id={id} className="field__input field__input--select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(d, e)}>
        {children}
      </select>
      {error ? <p className="field__error" id={e}>{error}</p> : null}
    </div>
  );
}

export function CheckboxField({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  const d = description ? `${id}-d` : undefined;
  return (
    <div className="checkbox">
      <input id={id} type="checkbox" className="checkbox__input" checked={checked} disabled={disabled} aria-describedby={d} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <label htmlFor={id} className="checkbox__label">{label}</label>
        {description ? <p className="field__description" id={d}>{description}</p> : null}
      </div>
    </div>
  );
}

export function RadioGroup<T extends string>({ legend, name, value, options, onChange, description }: { legend: string; name: string; value: T; options: Array<{ value: T; label: string; description?: string }>; onChange: (value: T) => void; description?: string }) {
  const id = useId();
  return (
    <fieldset className="radio-group" aria-describedby={description ? `${id}-d` : undefined}>
      <legend className="field__label">{legend}</legend>
      {description ? <p className="field__description" id={`${id}-d`}>{description}</p> : null}
      {options.map((option) => (
        <div key={option.value} className="checkbox">
          <input id={`${id}-${option.value}`} type="radio" className="checkbox__input" name={name} checked={value === option.value} onChange={() => onChange(option.value)} aria-describedby={option.description ? `${id}-${option.value}-d` : undefined} />
          <div>
            <label htmlFor={`${id}-${option.value}`} className="checkbox__label">{option.label}</label>
            {option.description ? <p className="field__description" id={`${id}-${option.value}-d`}>{option.description}</p> : null}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

/** Lists field-level problems at the top of a form; each entry links to its field. */
export function ErrorSummary({ title = 'Fix these before saving', errors }: { title?: string; errors: Array<{ id?: string; message: string }> }) {
  if (errors.length === 0) return null;
  return (
    <div className="notice notice--danger error-summary" role="alert" tabIndex={-1}>
      <p className="notice__title">{title}</p>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e.id ? <a href={`#${e.id}`}>{e.message}</a> : e.message}</li>
        ))}
      </ul>
    </div>
  );
}
