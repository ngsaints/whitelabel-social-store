export function paymentMethods(config) {
  return [
    ...(config.uvviEnabled !== false &&
    config.uvviClientId &&
    config.uvviClientSecret &&
    config.webhookRegistered
      ? ["uvvipay"]
      : []),
    ...(config.stripeEnabled && config.stripeKey && config.stripeWebhookSecret
      ? ["stripe"]
      : []),
  ];
}
