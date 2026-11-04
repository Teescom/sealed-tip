// Round-robin over relayer A/B function-call keys; submit to sealedtip (S-8.4).
export const submit = async (_method: string, _args: unknown): Promise<{ txHash: string }> => {
  throw new Error("not implemented: S-8.4");
};
