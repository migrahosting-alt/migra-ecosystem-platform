export type BillingReadiness = {
  assistedCollectionReady: boolean;
  stripeSecretConfigured: boolean;
  stripeWebhookConfigured: boolean;
  terminalLocationConfigured: boolean;
  terminalReaderConfigured: boolean;
  motoFlagConfigured: boolean;
  fullMotoReady: boolean;
};

export const loadBillingReadiness = (): BillingReadiness => {
  const stripeSecretConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const stripeWebhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const terminalLocationConfigured = Boolean(process.env.STRIPE_TERMINAL_LOCATION_ID);
  const terminalReaderConfigured = Boolean(process.env.STRIPE_TERMINAL_READER_ID);
  const motoFlagConfigured = ["1", "true", "yes", "enabled"].includes(
    String(process.env.STRIPE_TERMINAL_MOTO_ENABLED || "").toLowerCase(),
  );

  return {
    assistedCollectionReady: stripeSecretConfigured,
    stripeSecretConfigured,
    stripeWebhookConfigured,
    terminalLocationConfigured,
    terminalReaderConfigured,
    motoFlagConfigured,
    fullMotoReady:
      stripeSecretConfigured &&
      stripeWebhookConfigured &&
      terminalLocationConfigured &&
      terminalReaderConfigured &&
      motoFlagConfigured,
  };
};
