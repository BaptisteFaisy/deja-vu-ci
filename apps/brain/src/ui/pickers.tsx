/**
 * A labelled radio group, shared by the curation (CI-17) and quarantine
 * (CI-19) panels. Extracted so each panel stays a thin state holder and every
 * function here is well under the 50-line budget.
 */

import React from 'react';
import { Box, Label, RadioGroup } from '@forge/react';
import { valueOf, type Option } from './controls';

/** A label above a radio group; `onChange` receives the selected value. */
export function LabeledRadio(props: {
  label: string;
  name: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const { label, name, options, value, onChange } = props;
  return (
    <Box>
      <Label labelFor={name}>{label}</Label>
      <RadioGroup
        name={name}
        options={options}
        value={value}
        onChange={(event) => onChange(valueOf(event))}
      />
    </Box>
  );
}
