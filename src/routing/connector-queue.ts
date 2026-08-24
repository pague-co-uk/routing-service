export function getConnectorQueue(
  connectorCode: string,
): string {
  return `connector.${connectorCode}`;
}