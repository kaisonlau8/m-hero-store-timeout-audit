let lastAuditResult = null;

export function getAuditCache() {
  return lastAuditResult;
}

export function setAuditCache(result) {
  lastAuditResult = result;
}
