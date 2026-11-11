/**
 * Quarantine panel of the CI Memory page (CI-19, § 25).
 *
 * On an unstable signature, "Propose a quarantine" drafts the change that
 * isolates it and the ticket that commits somebody to fixing it. When
 * `assessFlakiness` does not call the test unstable, the resolver returns the
 * reasons and the panel proposes nothing — `proposeQuarantine` is the single
 * authority.
 *
 * The panel is thin: it holds the selection, calls the `quarantine-proposal`
 * resolver and hands the answer to `quarantineViews.tsx`. The decision logic is
 * in `src/pure/quarantineUi.ts` (tested without React).
 */

import React, { useState } from 'react';
import { Button, Heading, Stack } from '@forge/react';
import type { Signature } from '@dejavu/core';
import { loadData } from './data';
import { t, type Lang } from './i18n';
import type { ActionResult } from '../actions/engine';
import type { ProposeQuarantineData } from '../actions/propose-quarantine';
import { QuarantineAnswerView } from './quarantineViews';
import { errorMessage, signatureOptions } from './controls';
import { LabeledRadio } from './pickers';

/** The quarantine panel, added below the curation panel. */
export function QuarantinePanel(props: {
  lang: Lang;
  signatures: Signature[];
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, signatures, shortId } = props;
  const [signatureId, setSignatureId] = useState('');
  const [answer, setAnswer] = useState<ActionResult<ProposeQuarantineData> | undefined>();
  const [busy, setBusy] = useState(false);

  const propose = (): void => {
    setBusy(true);
    loadData<ActionResult<ProposeQuarantineData>>('quarantine-proposal', { signatureId })
      .then(setAnswer)
      .catch((cause: unknown) => setAnswer({ ok: false, error: errorMessage(cause) }))
      .finally(() => setBusy(false));
  };

  return (
    <Stack space="space.100">
      <Heading size="medium">{t('quarantine.title', lang)}</Heading>
      <LabeledRadio
        label={t('column.signature', lang)}
        name="quarantine-sig"
        options={signatureOptions(signatures, shortId)}
        value={signatureId}
        onChange={setSignatureId}
      />
      <Button appearance="primary" onClick={propose} isDisabled={busy || signatureId.length === 0}>
        {t('quarantine.button', lang)}
      </Button>
      {answer ? <QuarantineAnswerView lang={lang} answer={answer} /> : null}
    </Stack>
  );
}
