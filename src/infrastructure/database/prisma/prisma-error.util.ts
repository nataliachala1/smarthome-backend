export function isPostgresAccessDeniedError(
  error: unknown,
): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('meta' in error)
  ) {
    return false;
  }

  const meta = error.meta;

  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('driverAdapterError' in meta)
  ) {
    return false;
  }

  const driverAdapterError = meta.driverAdapterError;

  if (
    typeof driverAdapterError !== 'object' ||
    driverAdapterError === null ||
    !('cause' in driverAdapterError)
  ) {
    return false;
  }

  const cause = driverAdapterError.cause;

  if (
    typeof cause !== 'object' ||
    cause === null
  ) {
    return false;
  }

  const originalCode =
    'originalCode' in cause
      ? cause.originalCode
      : undefined;

  return originalCode === '42501';
}