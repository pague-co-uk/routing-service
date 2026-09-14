export type SmppDeliveryReceiptStatus =
  | "DELIVERED"
  | "FAILED";

export interface SmppDeliveryReceipt {
  connectorId: string;

  providerMessageId: string;

  status: SmppDeliveryReceiptStatus;

  errorCode?: string;

  errorMessage?: string;

  rawData?: {
    sourceAddress?: string;
    destinationAddress?: string;
    shortMessage?: string;
  };
}