export type SmppDeliveryReceiptStatus =
  | "DELIVERED"
  | "FAILED";

export interface SmppDeliveryReceipt {

  connectorId: string;

  providerMessageId: string;

  status: SmppDeliveryReceiptStatus;

  submittedAt: Date;

  completedAt: Date;

  errorCode?: string;

  errorMessage?: string;

  rawData?: {

    sourceAddress?: string;

    destinationAddress?: string;

    shortMessage?: string;

  };

}