type RadioOption<V extends string> = { value: V; label: string; hint?: string };

type RadioGroupFieldProps<V extends string> = {
  /** Used to build the ids of the options. */
  name: string;
  legend: string;
  value: V;
  options: readonly RadioOption<V>[];
  onChange: (value: V) => void;
};

/** One choice out of a few, as a fieldset so assistive technology announces the group's legend. */
export function RadioGroupField<V extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: RadioGroupFieldProps<V>) {
  return (
    <fieldset className="mt-4">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const hintId = option.hint ? `${id}-hint` : undefined;
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-field px-3 py-2 ${
                selected ? 'border-link' : 'border-control-edge'
              }`}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                aria-describedby={hintId}
                onChange={() => onChange(option.value)}
                className="mt-1 size-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                {option.hint ? (
                  <span id={hintId} className="block text-sm text-ink-muted">
                    {option.hint}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
