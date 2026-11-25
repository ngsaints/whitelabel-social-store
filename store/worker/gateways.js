export function paymentMethods(config) {
  return [
    ...(config.revantEnabled !== false &&
    config.revantApiKey &&
    config.webhookRegistered
      ? ["revantpay"]
      : []),
    ...(config.stripeEnabled && config.stripeKey && config.stripeWebhookSecret
      ? ["stripe"]
      : []),
  ];
}
