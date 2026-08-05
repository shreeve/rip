export const currentWorkerSocket = (calls, registration, exists) => {
  const candidates = [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call.method !== 'PUT' || !call.body?.upstreams?.length) continue;
    candidates.push(...call.body.upstreams);
  }
  candidates.push(...(registration?.upstreams ?? []));
  return candidates.find(upstream => !upstream.doorbell && upstream.path && exists(upstream.path))?.path ?? null;
};
